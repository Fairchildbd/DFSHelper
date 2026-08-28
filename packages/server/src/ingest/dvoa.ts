/**
 * Opponent-adjusted efficiency and success rate, from play-by-play.
 *
 * This is the DVOA layer. `pbp.ts` reads the same file to learn what a coach
 * *chooses* to do; this pass reads it to learn how well those choices worked
 * once the quality of the opponent is taken out.
 *
 * Why a second pass over the same file rather than folding into `loadTendencies`:
 * the two want different plays. Tendencies are measured in neutral game state,
 * because a team down three scores throws on every snap regardless of what its
 * coach believes in. An opponent adjustment wants every snap, because a defense
 * that surrendered points in the fourth quarter still surrendered them and
 * throwing away a third of the sample to protect a tendency measurement would
 * make every coefficient noisier. The files are cached on disk, so the cost of
 * reading twice is parse time and not another seventy megabytes.
 *
 * What comes out:
 *
 *   `team_dvoa`    — each team's efficiency and success rate on offense and
 *                    defense, as it would be against a league-average opponent,
 *                    plus the strength of schedule that was removed to get there.
 *   `player_dvoa`  — the same treatment per player per role, in the per-
 *                    opportunity units the ranking engine already percentiles.
 *
 * Both keep the raw figure alongside the adjusted one. The difference between
 * them is the schedule, and that is worth being able to show rather than
 * quietly folding away.
 */

import {
  blendSeasons,
  fitTwoWay,
  isSuccessfulPlay,
  type MatchupCell,
  type SeasonValue,
  type TwoWayFit,
} from '@dfs/shared';
import { insertBatched, sql } from '../db.ts';
import { MissingSeasonError, SOURCES, int, num, str, streamCsv } from '../nflverse.ts';

interface LoadOptions {
  force?: boolean;
  /**
   * Seasons a player's own rates are drawn from, when that is narrower than the
   * window the opponent adjustment is fitted over.
   *
   * These are deliberately allowed to differ. The defensive coefficients want
   * as much data as they can get, because a thin fit is a noisy correction
   * applied to everybody. A player's rate wants the production window and
   * nothing wider, because that is the window the rest of the ranking engine
   * scores him over and mixing three seasons of efficiency into a two-season
   * board would quietly reward players for years the rest of the pipeline has
   * already aged out.
   *
   * Defaults to every season in the fit.
   */
  playerSeasons?: number[];
}

/**
 * Plays behind a team coefficient before it is taken at full strength.
 *
 * A team runs roughly six hundred dropbacks in a season, so a completed season
 * sits at about two thirds strength here and a season in progress ramps up as
 * it accrues. That ramp is the point: in September the schedule has not
 * established itself, and an unshrunk correction at that stage mostly launders
 * noise into a player's grade.
 *
 * Lower than it was when this fitted one pooled three-season model, because it
 * now fits each season separately and a per-season sample is a third the size.
 * Holding the old value would have shrunk every coefficient toward zero by
 * exactly the amount the per-season split was meant to recover.
 */
const TEAM_SHRINKAGE = 150;

/**
 * Plays in a role before that role's rate is published at all.
 *
 * A receiver with three targets has no success rate worth recording, and
 * writing one would seed the positional baseline with a number that is a
 * coin-flip by construction.
 */
const MIN_ROLE_PLAYS = 10;

/** The three ways a skill player touches a scrimmage play. */
type Role = 'pass' | 'rush' | 'rec';

/** Play classes the opponent adjustment is fitted separately for. */
type PlayClass = 'pass' | 'rush';

/**
 * A defense good against the run is not thereby good against the pass, so the
 * two are fitted as separate leagues. Folding them together would hand a team
 * that cannot stop the run credit for a secondary it happens to also have.
 */
const PLAY_CLASSES: PlayClass[] = ['pass', 'rush'];

/** Which play class each role is graded inside. */
const CLASS_FOR_ROLE: Record<Role, PlayClass> = {
  pass: 'pass',
  rush: 'rush',
  rec: 'pass',
};

/** Running totals for one offense-versus-defense pairing in one season and play class. */
interface TeamCell {
  season: number;
  offense: string;
  defense: string;
  plays: number;
  epaSum: number;
  /** Plays whose success was determinable — a handful arrive with no down. */
  successPlays: number;
  successes: number;
}

/** Running totals for one player in one role. */
interface PlayerCell {
  plays: number;
  epaSum: number;
  successPlays: number;
  successes: number;
  /** Opponent exposure, so the fitted coefficients can be weighted back out. */
  byDefense: Map<string, { plays: number; successPlays: number }>;
}

function emptyPlayerCell(): PlayerCell {
  return { plays: 0, epaSum: 0, successPlays: 0, successes: 0, byDefense: new Map() };
}

export async function loadDvoa(
  seasons: number[],
  opts: LoadOptions = {},
): Promise<{ teams: number; players: number; plays: number }> {
  /*
   * Team cells, keyed season|offense|defense, one book per play class.
   *
   * Keyed by season because the fit is now per season, which is the whole point
   * of this pass. Pooling the window into one model produced a defensive
   * coefficient describing a three-year average of a team that never existed:
   * measured over 2023-2025 the median defense swung 0.096 EPA per play between
   * its best and worst year, against a pooled coefficient spread of only 0.051.
   * The averaging was quietly removing about half the signal the adjustment was
   * supposed to supply.
   */
  const teamBooks: Record<PlayClass, Map<string, TeamCell>> = {
    pass: new Map(),
    rush: new Map(),
  };
  // Player cells, keyed gsis|role.
  const playerBook = new Map<string, PlayerCell>();
  // Games a player appeared in, so the ranking layer's minimum-sample filter
  // for baselines has the same unit it uses everywhere else.
  const playerGames = new Map<string, Set<string>>();

  let plays = 0;
  const playerWindow = opts.playerSeasons ? new Set(opts.playerSeasons) : null;

  const teamCell = (
    cls: PlayClass,
    season: number,
    offense: string,
    defense: string,
  ): TeamCell => {
    const book = teamBooks[cls];
    const key = `${season}|${offense}|${defense}`;
    let cell = book.get(key);
    if (!cell) {
      cell = { season, offense, defense, plays: 0, epaSum: 0, successPlays: 0, successes: 0 };
      book.set(key, cell);
    }
    return cell;
  };

  const attribute = (
    gsisId: string,
    role: Role,
    season: number,
    defense: string,
    gameId: string,
    epa: number,
    success: boolean | null,
  ) => {
    const key = `${gsisId}|${role}`;
    let cell = playerBook.get(key);
    if (!cell) playerBook.set(key, (cell = emptyPlayerCell()));

    cell.plays++;
    cell.epaSum += epa;

    // Exposure is keyed by season as well as opponent, so a play is corrected
    // by the defense that team actually was that year rather than by its
    // average over the window.
    const exposureKey = `${season}|${defense}`;
    let exposure = cell.byDefense.get(exposureKey);
    if (!exposure) cell.byDefense.set(exposureKey, (exposure = { plays: 0, successPlays: 0 }));
    exposure.plays++;

    if (success != null) {
      cell.successPlays++;
      exposure.successPlays++;
      if (success) cell.successes++;
    }

    let games = playerGames.get(gsisId);
    if (!games) playerGames.set(gsisId, (games = new Set()));
    games.add(gameId);
  };

  for (const season of seasons) {
    let seasonPlays = 0;
    const attributable = playerWindow == null || playerWindow.has(season);
    try {
      for await (const r of streamCsv(SOURCES.pbp(season), opts)) {
        if (str(r.season_type) !== 'REG') continue;

        const playType = str(r.play_type);
        if (playType !== 'pass' && playType !== 'run') continue;
        // Kneels and spikes are clock management, and a deleted or aborted play
        // did not happen. None of them say anything about how good anyone is.
        if (int(r.qb_kneel) === 1 || int(r.qb_spike) === 1) continue;
        if (int(r.play_deleted) === 1 || int(r.aborted_play) === 1) continue;
        // Two-point tries have no down and sit outside the situational model.
        if (int(r.two_point_attempt) === 1) continue;

        const gameId = str(r.game_id);
        const posteam = str(r.posteam);
        const defteam = str(r.defteam);
        const epa = num(r.epa);
        if (!gameId || !posteam || !defteam || epa == null) continue;

        seasonPlays++;
        plays++;

        const cls: PlayClass = playType === 'pass' ? 'pass' : 'rush';
        const success = isSuccessfulPlay({
          down: int(r.down),
          yardsToGo: int(r.ydstogo),
          yardsGained: num(r.yards_gained),
          touchdown: int(r.touchdown) === 1,
          turnover: int(r.interception) === 1 || int(r.fumble_lost) === 1,
        });

        const cell = teamCell(cls, season, posteam, defteam);
        cell.plays++;
        cell.epaSum += epa;
        if (success != null) {
          cell.successPlays++;
          if (success) cell.successes++;
        }

        // Seasons outside the player window still shape the fit above; they
        // just do not land on anybody's record.
        if (!attributable) continue;

        /*
         * Attribution follows what the feed actually carries, which was
         * verified against a season of plays rather than assumed:
         *
         *   Every sack carries `passer_player_id` and no rusher, so sacks land
         *   on the quarterback — which is right, a sack is his play.
         *
         *   Scrambles are typed as runs and carry `rusher_player_id` only, so
         *   they land in the rushing bucket. That matches how the weekly table
         *   already splits a quarterback's passing and rushing EPA.
         *
         *   A pass with no receiver is a sack or a throwaway. It counts for the
         *   passer and for nobody else.
         */
        if (playType === 'pass') {
          const passer = str(r.passer_player_id);
          if (passer) attribute(passer, 'pass', season, defteam, gameId, epa, success);
          const receiver = str(r.receiver_player_id);
          if (receiver) attribute(receiver, 'rec', season, defteam, gameId, epa, success);
        } else {
          const rusher = str(r.rusher_player_id);
          if (rusher) attribute(rusher, 'rush', season, defteam, gameId, epa, success);
        }
      }
    } catch (err) {
      if (err instanceof MissingSeasonError) {
        console.log(`  play-by-play for ${season} not published yet — skipped`);
        continue;
      }
      throw err;
    }
    console.log(`  ${season}: ${seasonPlays.toLocaleString()} scrimmage plays`);
  }

  // --- fit the opponent adjustments ----------------------------------------

  /**
   * One fit per season per play class, for efficiency and for success rate.
   *
   * Success rate is a binary, so fitting an additive model to it is a linear
   * probability model rather than a logistic one. Over the range team success
   * rates actually occupy — roughly a third to a half — the two agree closely,
   * and staying additive is what lets a defense's coefficient be subtracted
   * back out of a player's rate in the same unit.
   */
  interface ClassFit {
    epa: TwoWayFit;
    success: TwoWayFit;
    /** Plays behind this season's fit, per defense, for the recency blend. */
    playsByDefense: Map<string, number>;
    playsByOffense: Map<string, number>;
    cells: TeamCell[];
  }

  const fits = new Map<string, ClassFit>();
  const fitKey = (season: number, cls: PlayClass) => `${season}|${cls}`;
  const fittedSeasons = new Set<number>();

  for (const cls of PLAY_CLASSES) {
    const bySeason = new Map<number, TeamCell[]>();
    for (const cell of teamBooks[cls].values()) {
      let list = bySeason.get(cell.season);
      if (!list) bySeason.set(cell.season, (list = []));
      list.push(cell);
    }

    for (const [season, cells] of bySeason) {
      const epaCells: MatchupCell[] = cells.map((c) => ({
        offense: c.offense,
        defense: c.defense,
        n: c.plays,
        sum: c.epaSum,
      }));
      const successCells: MatchupCell[] = cells.map((c) => ({
        offense: c.offense,
        defense: c.defense,
        n: c.successPlays,
        sum: c.successes,
      }));

      const playsByDefense = new Map<string, number>();
      const playsByOffense = new Map<string, number>();
      for (const c of cells) {
        playsByDefense.set(c.defense, (playsByDefense.get(c.defense) ?? 0) + c.plays);
        playsByOffense.set(c.offense, (playsByOffense.get(c.offense) ?? 0) + c.plays);
      }

      const epa = fitTwoWay(epaCells, { shrinkage: TEAM_SHRINKAGE });
      const success = fitTwoWay(successCells, { shrinkage: TEAM_SHRINKAGE });
      fits.set(fitKey(season, cls), { epa, success, playsByDefense, playsByOffense, cells });
      fittedSeasons.add(season);

      const spread = [...epa.defense.values()];
      const range =
        spread.length > 0
          ? `${Math.min(...spread).toFixed(3)} to ${Math.max(...spread).toFixed(3)}`
          : 'empty';
      console.log(
        `  ${season} ${cls}: ${epa.defense.size} defenses in ${epa.iterations} iterations ` +
          `(league ${epa.league.toFixed(4)} EPA/play, coefficients ${range})`,
      );
    }
  }

  const latestSeason = fittedSeasons.size > 0 ? Math.max(...fittedSeasons) : null;

  // --- team rows ------------------------------------------------------------

  const seasonLabel = seasons.join(',');
  const playerSeasonLabel = (opts.playerSeasons ?? seasons).join(',');
  const teamRows: Record<string, unknown>[] = [];

  const teamMetrics = new Map<string, Map<string, { value: number; plays: number }>>();
  const pushTeam = (
    team: string,
    side: 'offense' | 'defense',
    metric: string,
    value: number | null,
    playCount: number,
  ) => {
    if (value == null || !Number.isFinite(value)) return;
    const key = `${team}|${side}`;
    let metrics = teamMetrics.get(key);
    if (!metrics) teamMetrics.set(key, (metrics = new Map()));
    metrics.set(metric, { value, plays: playCount });
  };

  /**
   * Collapse a team's per-season coefficients into the one current-form figure
   * the matchup layer grades on, weighted by sample size and recency together.
   *
   * The per-season fits are the accurate ones, but a lane needs a single number
   * for the defense a player faces on Sunday. `blendSeasons` resolves that
   * without needing to know whether the newest season is complete, in progress,
   * or has not started: an empty season carries no sample weight, so in the
   * preseason last year's completed fit stands alone, and it hands over
   * gradually as the new one accrues plays.
   */
  const blendTeam = (
    team: string,
    cls: PlayClass,
    pick: (fit: ClassFit) => number | null,
    sample: (fit: ClassFit) => number,
  ): { value: number | null; plays: number } => {
    const values: SeasonValue[] = [];
    let plays = 0;
    for (const season of fittedSeasons) {
      const fit = fits.get(fitKey(season, cls));
      if (!fit) continue;
      const weight = sample(fit);
      if (weight <= 0) continue;
      const value = pick(fit);
      if (value == null || !Number.isFinite(value)) continue;
      values.push({ season, value, weight });
      plays += weight;
    }
    return {
      value: blendSeasons(values, { latestSeason: latestSeason ?? undefined }),
      plays,
    };
  };

  /** Play-weighted mean of the opposing side's fitted strength, within a season. */
  const strengthFaced = (
    cells: TeamCell[],
    coefficients: Map<string, number>,
    key: (cell: TeamCell) => string,
  ): number | null => {
    let weighted = 0;
    let total = 0;
    for (const cell of cells) {
      weighted += (coefficients.get(key(cell)) ?? 0) * cell.plays;
      total += cell.plays;
    }
    return total > 0 ? weighted / total : null;
  };

  const teamsSeen = new Set<string>();
  for (const fit of fits.values()) {
    for (const t of fit.playsByDefense.keys()) teamsSeen.add(t);
    for (const t of fit.playsByOffense.keys()) teamsSeen.add(t);
  }

  for (const cls of PLAY_CLASSES) {
    for (const team of teamsSeen) {
      const defPlays = (f: ClassFit) => f.playsByDefense.get(team) ?? 0;
      const offPlays = (f: ClassFit) => f.playsByOffense.get(team) ?? 0;

      // --- defense ---
      const epaAllowed = blendTeam(
        team, cls,
        (f) => (f.playsByDefense.has(team) ? f.epa.league + (f.epa.defense.get(team) ?? 0) : null),
        defPlays,
      );
      pushTeam(team, 'defense', `epa_allowed_${cls}_adj`, epaAllowed.value, epaAllowed.plays);

      const successAllowed = blendTeam(
        team, cls,
        (f) =>
          f.playsByDefense.has(team)
            ? (f.success.league + (f.success.defense.get(team) ?? 0)) * 100
            : null,
        defPlays,
      );
      pushTeam(team, 'defense', `success_allowed_${cls}_adj`, successAllowed.value, successAllowed.plays);

      // Positive means this defense faced better offenses than average, so its
      // raw numbers flattered it less than they appear to.
      const offenseFaced = blendTeam(
        team, cls,
        (f) =>
          strengthFaced(
            f.cells.filter((c) => c.defense === team),
            f.epa.offense,
            (c) => c.offense,
          ),
        defPlays,
      );
      pushTeam(team, 'defense', `${cls}_offense_faced`, offenseFaced.value, offenseFaced.plays);

      // --- offense ---
      const epaOffense = blendTeam(
        team, cls,
        (f) => (f.playsByOffense.has(team) ? f.epa.league + (f.epa.offense.get(team) ?? 0) : null),
        offPlays,
      );
      pushTeam(team, 'offense', `epa_${cls}_adj`, epaOffense.value, epaOffense.plays);

      const successOffense = blendTeam(
        team, cls,
        (f) =>
          f.playsByOffense.has(team)
            ? (f.success.league + (f.success.offense.get(team) ?? 0)) * 100
            : null,
        offPlays,
      );
      pushTeam(team, 'offense', `success_${cls}_adj`, successOffense.value, successOffense.plays);

      const defenseFaced = blendTeam(
        team, cls,
        (f) =>
          strengthFaced(
            f.cells.filter((c) => c.offense === team),
            f.epa.defense,
            (c) => c.defense,
          ),
        offPlays,
      );
      pushTeam(team, 'offense', `${cls}_defense_faced`, defenseFaced.value, defenseFaced.plays);
    }
  }

  for (const [key, metrics] of teamMetrics) {
    const [team, side] = key.split('|');
    for (const [metric, { value, plays: n }] of metrics) {
      teamRows.push({ team, side, metric, value, n_plays: n, seasons: seasonLabel });
    }
  }

  // --- player rows ----------------------------------------------------------

  /**
   * Take the defense back out of a player's own numbers.
   *
   * Each play is corrected by the coefficient for the defense it was actually
   * run against *in the season it was run*, which is the substance of the
   * per-season refit. A 2024 snap against the Jets is adjusted by the 2024
   * Jets; pooling the window would have used a three-year average that in their
   * case spans 0.242 EPA per play between best and worst year and therefore
   * describes neither.
   *
   * A play whose season has no fit — a season that failed to download — is left
   * uncorrected rather than dropped. It still happened, and discarding it would
   * quietly change which players clear the publication floor.
   */
  const adjustRole = (cell: PlayerCell, cls: PlayClass) => {
    let epaExposure = 0;
    let successExposure = 0;
    for (const [key, exposure] of cell.byDefense) {
      const sep = key.indexOf('|');
      const season = Number(key.slice(0, sep));
      const defense = key.slice(sep + 1);
      const fit = fits.get(fitKey(season, cls));
      if (!fit) continue;
      epaExposure += (fit.epa.defense.get(defense) ?? 0) * exposure.plays;
      successExposure += (fit.success.defense.get(defense) ?? 0) * exposure.successPlays;
    }

    const rawEpa = cell.plays > 0 ? cell.epaSum / cell.plays : null;
    const adjEpa = cell.plays > 0 ? (cell.epaSum - epaExposure) / cell.plays : null;
    const rawSuccess =
      cell.successPlays > 0 ? (cell.successes / cell.successPlays) * 100 : null;
    const adjSuccess =
      cell.successPlays > 0
        ? ((cell.successes - successExposure) / cell.successPlays) * 100
        : null;
    // Positive means a harder schedule than average faced.
    const faced = cell.plays > 0 ? epaExposure / cell.plays : null;

    return { rawEpa, adjEpa, rawSuccess, adjSuccess, faced };
  };

  /** Column names per role, so the wide row stays readable at the call site. */
  const COLUMNS: Record<Role, { adjEpa: string; rawEpa: string; adjSuccess: string; rawSuccess: string; plays: string; faced: string }> = {
    pass: {
      adjEpa: 'adj_passing_epa_per_dropback', rawEpa: 'raw_passing_epa_per_dropback',
      adjSuccess: 'adj_passing_success_rate', rawSuccess: 'raw_passing_success_rate',
      plays: 'pass_plays', faced: 'pass_defense_faced',
    },
    rush: {
      adjEpa: 'adj_rushing_epa_per_carry', rawEpa: 'raw_rushing_epa_per_carry',
      adjSuccess: 'adj_rushing_success_rate', rawSuccess: 'raw_rushing_success_rate',
      plays: 'rush_plays', faced: 'rush_defense_faced',
    },
    rec: {
      adjEpa: 'adj_receiving_epa_per_tgt', rawEpa: 'raw_receiving_epa_per_tgt',
      adjSuccess: 'adj_receiving_success_rate', rawSuccess: 'raw_receiving_success_rate',
      plays: 'rec_plays', faced: 'rec_defense_faced',
    },
  };

  const playerRows = new Map<string, Record<string, unknown>>();
  const blankRow = (gsisId: string): Record<string, unknown> => {
    const row: Record<string, unknown> = {
      gsis_id: gsisId,
      games: playerGames.get(gsisId)?.size ?? 0,
      seasons: playerSeasonLabel,
    };
    for (const cols of Object.values(COLUMNS)) {
      row[cols.plays] = 0;
      row[cols.adjEpa] = null;
      row[cols.rawEpa] = null;
      row[cols.adjSuccess] = null;
      row[cols.rawSuccess] = null;
      row[cols.faced] = null;
    }
    return row;
  };

  for (const [key, cell] of playerBook) {
    const [gsisId, role] = key.split('|') as [string, Role];
    let row = playerRows.get(gsisId);
    if (!row) playerRows.set(gsisId, (row = blankRow(gsisId)));

    const cols = COLUMNS[role];
    row[cols.plays] = cell.plays;

    // Below the floor the play count is still recorded — it is real, and the
    // ranking layer uses it for confidence — but no rate is published from it.
    if (cell.plays < MIN_ROLE_PLAYS) continue;

    const adjusted = adjustRole(cell, CLASS_FOR_ROLE[role]);
    row[cols.adjEpa] = adjusted.adjEpa;
    row[cols.rawEpa] = adjusted.rawEpa;
    row[cols.adjSuccess] = adjusted.adjSuccess;
    row[cols.rawSuccess] = adjusted.rawSuccess;
    row[cols.faced] = adjusted.faced;
  }

  await sql`TRUNCATE team_dvoa`;
  await sql`TRUNCATE player_dvoa`;
  await insertBatched('team_dvoa', teamRows, '(team, side, metric)');
  await insertBatched('player_dvoa', [...playerRows.values()], '(gsis_id)');

  return { teams: teamRows.length, players: playerRows.size, plays };
}
