/**
 * Per-defender coverage and pass-rush production, from PFR advanced stats.
 *
 * This is the only free source that says what happened when a specific
 * defender was thrown at: targets, completions and yards allowed, and the
 * passer rating quarterbacks posted against him. It is what lets the matchup
 * view name the corners a receiver will see instead of only grading the
 * defense as a block.
 *
 * Weekly rows are folded to a season total. Rates are always recomputed from
 * the summed counts rather than averaged across weeks — averaging a rate over
 * games weights a one-target afternoon the same as a ten-target one.
 */

import { blendSeasons, fitTwoWay, type MatchupCell, type SeasonValue } from '@dfs/shared';
import { insertBatched, sql } from '../db.ts';
import { MissingSeasonError, SOURCES, num, str, streamCsv } from '../nflverse.ts';

interface LoadOptions {
  force?: boolean;
}

interface Totals {
  pfr_id: string;
  season: number;
  player_name: string | null;
  team: string | null;
  games: number;
  targets: number;
  completions: number;
  yards: number;
  tds: number;
  ints: number;
  /** Weighted by targets, so it can be divided back out into a mean. */
  ratingTargetSum: number;
  adotTargetSum: number;
  pressures: number;
  sacks: number;
  missedTackles: number;
  tackles: number;
}

export async function loadDefenderCoverage(
  seasons: number[],
  opts: LoadOptions = {},
): Promise<number> {
  const byKey = new Map<string, Totals>();

  for (const season of seasons) {
    try {
      for await (const r of streamCsv(SOURCES.advstatsDef(season), opts)) {
        if (str(r.game_type) !== 'REG') continue;
        const pfrId = str(r.pfr_player_id);
        if (!pfrId) continue;

        const key = `${pfrId}|${season}`;
        let t = byKey.get(key);
        if (!t) {
          t = {
            pfr_id: pfrId,
            season,
            player_name: str(r.pfr_player_name),
            team: str(r.team),
            games: 0, targets: 0, completions: 0, yards: 0, tds: 0, ints: 0,
            ratingTargetSum: 0, adotTargetSum: 0,
            pressures: 0, sacks: 0, missedTackles: 0, tackles: 0,
          };
          byKey.set(key, t);
        }

        const targets = num(r.def_targets) ?? 0;
        t.games++;
        // The team on the most recent row wins, so a midseason move lands the
        // defender on the team he finished with.
        t.team = str(r.team) ?? t.team;
        t.targets += targets;
        t.completions += num(r.def_completions_allowed) ?? 0;
        t.yards += num(r.def_yards_allowed) ?? 0;
        t.tds += num(r.def_receiving_td_allowed) ?? 0;
        t.ints += num(r.def_ints) ?? 0;
        t.pressures += num(r.def_pressures) ?? 0;
        t.sacks += num(r.def_sacks) ?? 0;
        t.missedTackles += num(r.def_missed_tackles) ?? 0;
        t.tackles += num(r.def_tackles_combined) ?? 0;

        // Rating and depth of target are per-target measures; weight them by
        // the targets they were computed over before summing.
        const rating = num(r.def_passer_rating_allowed);
        if (rating != null && targets > 0) t.ratingTargetSum += rating * targets;
        const adot = num(r.def_adot);
        if (adot != null && targets > 0) t.adotTargetSum += adot * targets;
      }
    } catch (err) {
      if (err instanceof MissingSeasonError) {
        console.log(`  advanced defensive stats for ${season} not published yet — skipped`);
        continue;
      }
      throw err;
    }
  }

  const rows = [...byKey.values()].map((t) => ({
    pfr_id: t.pfr_id,
    season: t.season,
    gsis_id: null, // linked below, once players is known to be loaded
    player_name: t.player_name,
    team: t.team,
    games: t.games,
    targets: t.targets,
    completions_allowed: t.completions,
    yards_allowed: t.yards,
    yards_per_target: t.targets > 0 ? t.yards / t.targets : null,
    passer_rating_allowed: t.targets > 0 ? t.ratingTargetSum / t.targets : null,
    adot: t.targets > 0 ? t.adotTargetSum / t.targets : null,
    tds_allowed: t.tds,
    interceptions: t.ints,
    tackles: t.tackles,
    missed_tackles: t.missedTackles,
    missed_tackle_pct:
      t.tackles + t.missedTackles > 0
        ? (t.missedTackles / (t.tackles + t.missedTackles)) * 100
        : null,
    pressures: t.pressures,
    sacks: t.sacks,
  }));

  const count = await insertBatched('defender_coverage', rows, '(pfr_id, season)');

  // Same guard as the combine link in ingest/index.ts: nflverse reuses some
  // pfr_ids across different people, and handing one defender's coverage
  // numbers to another is worse than leaving him unlinked.
  const linked = await sql`
    WITH unambiguous AS (
      SELECT pfr_id FROM players
      WHERE pfr_id IS NOT NULL
      GROUP BY pfr_id HAVING COUNT(*) = 1
    )
    UPDATE defender_coverage d
    SET gsis_id = p.gsis_id
    FROM players p
    WHERE d.pfr_id = p.pfr_id
      AND d.pfr_id IN (SELECT pfr_id FROM unambiguous)
      AND d.gsis_id IS DISTINCT FROM p.gsis_id
  `;
  console.log(`  ${linked.count} defender rows linked to league ids`);

  return count;
}

/**
 * Games behind a defense-versus-position coefficient before it is trusted in
 * full.
 *
 * Lower than it was when this fitted one pooled model across the window,
 * because it now fits each season separately and a season is seventeen games
 * rather than fifty. Holding the old value would have shrunk every coefficient
 * toward zero by roughly the amount the per-season split was meant to recover.
 */
const DVP_SHRINKAGE = 4;

/**
 * Defense versus position: how many fantasy points each defense surrendered to
 * each offensive position, per game.
 *
 * Computed from the weekly offensive table already in the database — every row
 * there carries the opponent, so the defense's concession is just the same data
 * read from the other side. Position comes from `players` rather than the
 * weekly row so it agrees with the rest of the pipeline.
 *
 * Two numbers come out of this, and the difference between them matters.
 *
 * `fp_allowed` is the raw average, and it is the number every DFS site
 * publishes. It is also biased, for a reason that has nothing to do with how
 * good the defense is: a team that happened to draw the league's weakest
 * offenses gave up fewer points to every position and grades as elite.
 *
 * `fp_allowed_adj` is the corrected version — what this defense would concede
 * to a league-average offense — fitted per season and then blended by sample
 * size and recency into the current-form figure the matchup layer grades on.
 * `offense_faced` reports the schedule that was removed, so the correction can
 * be shown rather than only applied.
 *
 * Fitted per season for the same reason the play-by-play pass is: a defense is
 * not a stable object across a three-year window, and a pooled fit describes an
 * average roster that never took the field. This is also where the correction
 * bites hardest — a game's fantasy concession carries far more schedule
 * variance than a single play's expected-points swing does.
 *
 * The unit is a game rather than a play, which is the right granularity:
 * fantasy points are conceded by a defense to a position group over a game, and
 * there is no per-play attribution of a position's fantasy scoring to reach for.
 */
export async function computeDefenseVsPosition(seasons: number[]): Promise<number> {
  await sql`TRUNCATE def_vs_position`;

  const games = await sql<
    {
      season: number;
      offense: string;
      defense: string;
      position: string;
      fp: number;
      yards: number;
      tds: number;
      targets: number;
    }[]
  >`
    SELECT
      o.season,
      o.team     AS offense,
      o.opponent AS defense,
      p.position,
      SUM(COALESCE(o.fantasy_points_ppr, 0))::float8                           AS fp,
      SUM(COALESCE(o.receiving_yards, 0) + COALESCE(o.rushing_yards, 0)
          + COALESCE(o.passing_yards, 0))::float8                              AS yards,
      SUM(COALESCE(o.receiving_tds, 0) + COALESCE(o.rushing_tds, 0)
          + COALESCE(o.passing_tds, 0))::float8                                AS tds,
      SUM(COALESCE(o.targets, 0))::float8                                      AS targets
    FROM player_week_offense o
    JOIN players p ON p.gsis_id = o.gsis_id
    WHERE o.season = ANY(${seasons})
      AND o.season_type = 'REG'
      AND o.team IS NOT NULL
      AND o.opponent IS NOT NULL
      AND p.position IN ('QB', 'RB', 'WR', 'TE')
    GROUP BY o.season, o.team, o.opponent, p.position, o.week
  `;

  interface Totals {
    fp: number;
    yards: number;
    tds: number;
    targets: number;
    n: number;
  }
  /** Raw per-game totals for a defense against a position, across the window. */
  const rawByDefense = new Map<string, Totals>();
  /** Offense-versus-defense cells, keyed position then season. */
  const books = new Map<string, Map<number, Map<string, MatchupCell>>>();
  const seasonsSeen = new Set<number>();

  for (const g of games) {
    seasonsSeen.add(g.season);

    const rawKey = `${g.defense}|${g.position}`;
    let totals = rawByDefense.get(rawKey);
    if (!totals) {
      rawByDefense.set(rawKey, (totals = { fp: 0, yards: 0, tds: 0, targets: 0, n: 0 }));
    }
    totals.fp += g.fp;
    totals.yards += g.yards;
    totals.tds += g.tds;
    totals.targets += g.targets;
    totals.n++;

    let byPosition = books.get(g.position);
    if (!byPosition) books.set(g.position, (byPosition = new Map()));
    let bySeason = byPosition.get(g.season);
    if (!bySeason) byPosition.set(g.season, (bySeason = new Map()));
    const cellKey = `${g.offense}|${g.defense}`;
    let cell = bySeason.get(cellKey);
    if (!cell) {
      bySeason.set(cellKey, (cell = { offense: g.offense, defense: g.defense, n: 0, sum: 0 }));
    }
    cell.n++;
    cell.sum += g.fp;
  }

  const latestSeason = seasonsSeen.size > 0 ? Math.max(...seasonsSeen) : undefined;
  const rows: Record<string, unknown>[] = [];

  for (const [position, byPosition] of books) {
    // Per-season fits, plus the games each defense played in that season, which
    // is what weights the blend below.
    interface SeasonFit {
      season: number;
      fit: ReturnType<typeof fitTwoWay>;
      cells: MatchupCell[];
      gamesByDefense: Map<string, number>;
    }
    const seasonFits: SeasonFit[] = [];
    for (const [season, bySeason] of byPosition) {
      const cells = [...bySeason.values()];
      const gamesByDefense = new Map<string, number>();
      for (const c of cells) {
        gamesByDefense.set(c.defense, (gamesByDefense.get(c.defense) ?? 0) + c.n);
      }
      seasonFits.push({
        season,
        fit: fitTwoWay(cells, { shrinkage: DVP_SHRINKAGE }),
        cells,
        gamesByDefense,
      });
    }
    seasonFits.sort((a, b) => a.season - b.season);

    const defenses = new Set<string>();
    for (const sf of seasonFits) for (const d of sf.gamesByDefense.keys()) defenses.add(d);

    for (const defense of defenses) {
      const totals = rawByDefense.get(`${defense}|${position}`);
      if (!totals || totals.n === 0) continue;

      const allowed: SeasonValue[] = [];
      const faced: SeasonValue[] = [];
      for (const sf of seasonFits) {
        const n = sf.gamesByDefense.get(defense) ?? 0;
        if (n <= 0) continue;
        allowed.push({
          season: sf.season,
          value: sf.fit.league + (sf.fit.defense.get(defense) ?? 0),
          weight: n,
        });
        // Schedule strength faced that season, game-weighted, in fantasy points.
        let weighted = 0;
        let total = 0;
        for (const cell of sf.cells) {
          if (cell.defense !== defense) continue;
          weighted += (sf.fit.offense.get(cell.offense) ?? 0) * cell.n;
          total += cell.n;
        }
        if (total > 0) faced.push({ season: sf.season, value: weighted / total, weight: n });
      }

      const push = (metric: string, value: number | null) => {
        if (value == null || !Number.isFinite(value)) return;
        rows.push({ team: defense, position, metric, value, n_games: totals.n });
      };

      push('fp_allowed', totals.fp / totals.n);
      push('yards_allowed', totals.yards / totals.n);
      push('tds_allowed', totals.tds / totals.n);
      push('targets_allowed', totals.targets / totals.n);
      push('fp_allowed_adj', blendSeasons(allowed, { latestSeason }));
      push('offense_faced', blendSeasons(faced, { latestSeason }));
    }

    const spread = seasonFits.flatMap((sf) => [...sf.fit.defense.values()]);
    console.log(
      `  ${position}: ${defenses.size} defenses over ${seasonFits.length} seasons ` +
        `(coefficients ${Math.min(...spread).toFixed(1)} to ${Math.max(...spread).toFixed(1)} PPR/game)`,
    );
  }

  return insertBatched('def_vs_position', rows, '(team, position, metric)');
}
