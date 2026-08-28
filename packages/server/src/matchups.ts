/**
 * Weekly matchup materialization.
 *
 * Runs after `computeRankings`, because it consumes `rankings.composite` as the
 * "how good is this unit" input. The output is two tables: one row per game
 * carrying its mismatch score and lane breakdown, and one row per player
 * carrying his graded spot in that game.
 *
 * Like the ranking pass this is a full rebuild rather than an incremental
 * update — a week of new data moves every percentile underneath it, so a
 * partial refresh would leave the two halves of the table describing different
 * versions of the league.
 */

import {
  DVP_POSITIONS,
  LANES,
  LANES_BY_KEY,
  buildDistributions,
  computeLaneEdge,
  computeMismatch,
  clamp,
  gradePlayerMatchup,
  qbRushAdjustment,
  laneForPosition,
  normalizePosition,
  percentileOf,
  resolveTendencies,
  roleWeight,
  tendencyMetric,
  type Distribution,
  type Lane,
  type LaneEdge,
  type Position,
  type ResolvedTendencies,
  type Side,
} from '@dfs/shared';
import { insertBatched, sql } from './db.ts';

interface GameRow {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  home_score: number | null;
  away_score: number | null;
  gameday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_coach: string | null;
  away_coach: string | null;
  total_line: number | null;
  spread_line: number | null;
}

interface TendencyRow {
  key: string;
  side: Side;
  metric: string;
  value: number;
  n_games: number;
}

interface DvpRow {
  team: string;
  position: string;
  metric: string;
  value: number;
}

interface DepthRow {
  season: number;
  team: string;
  gsis_id: string;
  pos_rank: number | null;
  position: string;
  display_name: string;
  composite: number | null;
  ranked_position: string | null;
}

/**
 * How a lane's defensive grade is split between three readings of the same
 * defense.
 *
 *   DVP    — what it has surrendered to *this position*, per game, schedule-
 *            corrected. The most specific evidence available, and it leads.
 *   DVOA   — its opponent-adjusted efficiency allowed on this play type. Less
 *            specific than DVP but far better sampled: a season of plays rather
 *            than a season of games, so it is the steadier of the two.
 *   Scheme — how it chooses to play: pressure, blitz, box counts.
 *
 * Scheme used to carry 0.4 and to include the raw `epa_allowed_*` figures.
 * That was doing two jobs at once, and the comment here used to admit it — it
 * noted that a defense's results are partly a product of the offenses it
 * happened to face, and leaned on scheme to compensate for a bias nothing was
 * actually correcting. Now that the bias is corrected directly, scheme can go
 * back to meaning disposition and gives up weight to the results it was
 * standing in for.
 *
 * Weights are renormalized over whichever components resolve, so a lane with no
 * defense-versus-position profile — the offensive line — is graded on the other
 * two rather than being dragged toward the middle.
 */
const DVP_WEIGHT = 0.45;
const DVOA_WEIGHT = 0.3;
const SCHEME_WEIGHT = 0.25;

/** Blend weights inside a player's projected-volume figure. */
const VOLUME_ROLE_WEIGHT = 0.6;
const VOLUME_PACE_WEIGHT = 0.2;
const VOLUME_USAGE_WEIGHT = 0.2;

/**
 * Resolve which season to build matchups for.
 *
 * The next unplayed game decides it, so the table follows the calendar without
 * needing a configured season. In the preseason that is the coming year; in
 * January it is still the season in progress.
 */
async function targetSeason(): Promise<number> {
  const [row] = await sql<{ season: number | null }[]>`
    SELECT season FROM games
    WHERE home_score IS NULL AND game_type = 'REG'
    ORDER BY gameday NULLS LAST, game_id
    LIMIT 1
  `;
  if (row?.season != null) return row.season;

  const [fallback] = await sql<{ season: number | null }[]>`
    SELECT MAX(season)::int AS season FROM games
  `;
  return fallback?.season ?? new Date().getFullYear();
}

/** Tendency values for one side, keyed by metric. */
type Values = Record<string, number>;

interface ProfileBooks {
  coach: Map<string, { values: Values; nGames: number }>;
  team: Map<string, { values: Values; nGames: number }>;
  league: Values;
  dist: Record<string, Distribution>;
}

function indexTendencies(rows: TendencyRow[], side: Side): {
  byKey: Map<string, { values: Values; nGames: number }>;
} {
  const byKey = new Map<string, { values: Values; nGames: number }>();
  for (const r of rows) {
    if (r.side !== side) continue;
    let entry = byKey.get(r.key);
    if (!entry) {
      entry = { values: {}, nGames: 0 };
      byKey.set(r.key, entry);
    }
    entry.values[r.metric] = Number(r.value);
    entry.nGames = Math.max(entry.nGames, Number(r.n_games));
  }
  return { byKey };
}

/**
 * Look up a staff's profile, falling back through coach → team → league.
 *
 * The league entry is built from the distribution means rather than from a
 * stored row, so it is always available and always current.
 */
function profileFor(
  books: ProfileBooks,
  coach: string | null,
  team: string,
): ResolvedTendencies {
  const coachEntry = coach ? books.coach.get(coach) : undefined;
  const teamEntry = books.team.get(team);

  const resolved = resolveTendencies([
    ...(coachEntry
      ? [{ source: 'coach' as const, values: coachEntry.values, nGames: coachEntry.nGames }]
      : []),
    ...(teamEntry
      ? [{ source: 'team' as const, values: teamEntry.values, nGames: teamEntry.nGames }]
      : []),
    { source: 'league' as const, values: books.league, nGames: 0 },
  ]);

  return (
    resolved ?? { source: 'league', values: books.league, nGames: 0, confidence: 0 }
  );
}

/** Percentile of one tendency metric within the league distribution. */
function tendencyPercentile(
  books: ProfileBooks,
  profile: ResolvedTendencies,
  side: Side,
  metric: string,
): number | null {
  const definition = tendencyMetric(side, metric);
  // `higherIsBetter` is only set on metrics where good and bad are meaningful.
  // A stylistic metric is percentiled as-is: high means "more of this", not
  // "better at this".
  const lowerIsBetter = definition?.higherIsBetter === false;
  return percentileOf(profile.values[metric], books.dist[metric], lowerIsBetter);
}

/**
 * Where this staff sits among the league on one metric, as a plain rank.
 *
 * Ranked against the 32 team profiles, which are the same population the
 * percentile is measured against, so the rank and the bar can never disagree.
 * Direction follows the percentile: rank 1 is the top of the scale, meaning
 * the most of a stylistic metric and the best of a metric where good and bad
 * are meaningful.
 *
 * Ties share a rank — two staffs at an identical rate are both 7th — because
 * breaking a tie on nothing would invent an ordering the data does not have.
 */
function tendencyRank(
  books: ProfileBooks,
  profile: ResolvedTendencies,
  side: Side,
  metric: string,
): { rank: number; of: number } | null {
  const value = profile.values[metric];
  if (value == null || !Number.isFinite(value)) return null;

  const definition = tendencyMetric(side, metric);
  const lowerIsBetter = definition?.higherIsBetter === false;
  const orient = (v: number) => (lowerIsBetter ? -v : v);

  const peers: number[] = [];
  for (const entry of books.team.values()) {
    const v = entry.values[metric];
    if (v != null && Number.isFinite(v)) peers.push(orient(v));
  }
  if (peers.length === 0) return null;

  const mine = orient(value);
  const better = peers.filter((v) => v > mine).length;
  return { rank: better + 1, of: peers.length };
}

export interface MatchupOptions {
  /**
   * `week` predicts only the week now in play — the product surface. `season`
   * predicts every remaining game of the year, which is the best-ball view and
   * is far more expensive to keep honest.
   */
  scope?: 'week' | 'season';
  /**
   * Games to predict even though they have already been played, so the results
   * view has something real to render. Rows created this way are flagged
   * `backfilled`, because a forecast produced after the whistle is a
   * demonstration of the model rather than a forecast it ever made.
   */
  backfill?: string[];
}

export async function computeMatchups(opts: MatchupOptions = {}): Promise<{
  season: number;
  week: number | null;
  games: number;
  players: number;
  skippedLocked: number;
}> {
  const scope = opts.scope ?? 'week';
  const season = await targetSeason();
  const current = await currentWeek();
  const backfill = opts.backfill ?? [];

  if (scope === 'week' && !current && backfill.length === 0) {
    console.log('  no unplayed week to predict');
    return { season, week: null, games: 0, players: 0, skippedLocked: 0 };
  }

  console.log(
    scope === 'season'
      ? `Building best-ball matchups for all of ${season}`
      : `Building matchups for ${current?.season} week ${current?.week}` +
        (backfill.length ? ` (plus ${backfill.length} backfilled)` : ''),
  );

  // A locked row is a prediction that has already been measured against a
  // result. Rebuilding it would silently rewrite history with hindsight.
  const locked = await sql<{ game_id: string }[]>`
    SELECT game_id FROM matchups WHERE locked = TRUE
  `;
  const lockedIds = new Set(locked.map((r) => r.game_id));

  const [games, coachRows, teamRows, dvpRows, dvoaRows, depth] = await Promise.all([
    sql<GameRow[]>`
      SELECT game_id, season, week, game_type, gameday::text AS gameday, gametime,
             home_team, away_team, home_coach, away_coach, home_score, away_score,
             total_line::float8 AS total_line, spread_line::float8 AS spread_line
      FROM games
      WHERE (
        ${scope === 'season'
          ? sql`season = ${season} AND game_type = 'REG'`
          : sql`(season = ${current?.season ?? -1} AND week = ${current?.week ?? -1})`}
      )
        OR game_id = ANY(${backfill})
      ORDER BY season, week, gameday, game_id
    `,
    sql<TendencyRow[]>`
      SELECT coach AS key, side, metric, value::float8 AS value, n_games
      FROM coach_tendencies
    `,
    sql<TendencyRow[]>`
      SELECT team AS key, side, metric, value::float8 AS value, n_games
      FROM team_tendencies
    `,
    sql<DvpRow[]>`
      SELECT team, position, metric, value::float8 AS value FROM def_vs_position
    `,
    sql<{ team: string; metric: string; value: number }[]>`
      SELECT team, metric, value::float8 AS value
      FROM team_dvoa WHERE side = 'defense'
    `,
    sql<DepthRow[]>`
      SELECT d.season, d.team, d.gsis_id, d.pos_rank, d.position,
             COALESCE(r.display_name, p.display_name) AS display_name,
             r.composite::float8 AS composite,
             r.position AS ranked_position
      FROM depth_chart d
      JOIN players p ON p.gsis_id = d.gsis_id
      LEFT JOIN rankings r ON r.gsis_id = d.gsis_id
      -- Special-teams roles carry no position. A returner is already on this
      -- chart under his real job, and his KR line ranks first, so letting the
      -- rows through would replace a starting receiver with an unrankable
      -- duplicate in the pass below.
      WHERE d.position IS NOT NULL
    `,
  ]);

  const targets = games.filter((g) => !lockedIds.has(g.game_id));
  const skippedLocked = games.length - targets.length;

  if (targets.length === 0) {
    console.log(`  nothing to build (${skippedLocked} already locked)`);
    return { season, week: current?.week ?? null, games: 0, players: 0, skippedLocked };
  }

  // --- distributions ------------------------------------------------------
  //
  // The league population is the 32 team profiles, not the coach list: coaches
  // repeat across a multi-season window and vary wildly in sample, so using
  // them would let one heavily-sampled staff distort the very scale it is then
  // measured against.

  const books: Record<Side, ProfileBooks> = {
    offense: buildBooks(coachRows, teamRows, 'offense'),
    defense: buildBooks(coachRows, teamRows, 'defense'),
  };

  /*
   * Defense versus position, from the schedule-corrected figure.
   *
   * `fp_allowed_adj` is what this defense would concede to a league-average
   * offense; `fp_allowed` is what it happened to concede to the offenses on its
   * schedule. Grading on the raw number rewarded defenses for a soft slate, and
   * since this percentile carries the largest single share of every lane's
   * defensive grade, that bias reached the mismatches the app actually shows.
   *
   * The raw metric is still written and still shown — the gap between the two
   * is the strength of schedule. It is just no longer what anything is graded
   * on. The fallback exists for a database whose DVOA pass has not run yet.
   */
  const DVP_METRIC = 'fp_allowed_adj';
  const DVP_FALLBACK = 'fp_allowed';
  const dvpAdjusted = dvpRows.some((r) => r.metric === DVP_METRIC);
  const dvpMetric = dvpAdjusted ? DVP_METRIC : DVP_FALLBACK;
  if (!dvpAdjusted) {
    console.log('  def_vs_position carries no adjusted figure — grading on raw points allowed');
  }

  const dvpDist: Record<string, Distribution> = {};
  for (const position of DVP_POSITIONS) {
    const rows = dvpRows.filter((r) => r.position === position && r.metric === dvpMetric);
    const built = buildDistributions(rows.map((r) => ({ metric: position, value: r.value })));
    if (built[position]) dvpDist[position] = built[position];
  }
  const dvpByTeam = new Map<string, number>();
  for (const r of dvpRows) {
    if (r.metric === dvpMetric) dvpByTeam.set(`${r.team}|${r.position}`, r.value);
  }

  // Opponent-adjusted efficiency allowed, percentiled across the 32 defenses
  // the same way every other league-relative figure here is.
  const dvoaByTeam = new Map<string, number>();
  for (const r of dvoaRows) dvoaByTeam.set(`${r.team}|${r.metric}`, r.value);
  const dvoaDist = buildDistributions(
    dvoaRows.map((r) => ({ metric: r.metric, value: r.value })),
  );

  // --- depth charts by team ------------------------------------------------

  // A player can hold two slots on one chart — a swing lineman listed at both
  // guard spots, a nickel corner who is also the second safety. Keep the slot
  // he is highest on, which is the role he will actually play, so he is neither
  // counted twice in his unit's strength nor graded twice in the same game.
  const bestSlot = new Map<string, DepthRow>();
  for (const row of depth) {
    const key = `${row.season}|${row.team}|${row.gsis_id}`;
    const existing = bestSlot.get(key);
    if (existing && (existing.pos_rank ?? 99) <= (row.pos_rank ?? 99)) continue;
    bestSlot.set(key, row);
  }

  // Keyed by season too: a backfilled playoff game must be graded against the
  // roster that played it, not against next year's depth chart.
  const depthByTeam = new Map<string, DepthRow[]>();
  for (const row of bestSlot.values()) {
    const key = `${row.season}|${row.team}`;
    const list = depthByTeam.get(key);
    if (list) list.push(row);
    else depthByTeam.set(key, [row]);
  }

  /** Roster for a team in a season, falling back to the newest chart we hold. */
  /**
   * Carries per game for every quarterback, over the last two seasons.
   *
   * Two seasons rather than one because designed quarterback runs are a scheme
   * trait and change slowly, and because a single season of a backup's
   * spot starts is a thin sample to call someone a runner on.
   */
  const qbCarries = new Map<string, number>();
  {
    const rows = await sql<{ gsis_id: string; carries_per_game: number }[]>`
      SELECT gsis_id,
             (SUM(COALESCE(carries, 0))::numeric / COUNT(*))::float8 AS carries_per_game
      FROM player_week_offense
      WHERE season_type = 'REG'
        AND position = 'QB'
        AND season >= (SELECT MAX(season) - 1 FROM player_week_offense)
      GROUP BY gsis_id
      HAVING COUNT(*) >= 4
    `;
    for (const r of rows) qbCarries.set(r.gsis_id, r.carries_per_game);
  }

  const rosterFor = (targetSeason: number, team: string): DepthRow[] => {
    const exact = depthByTeam.get(`${targetSeason}|${team}`);
    if (exact && exact.length > 0) return exact;
    const seasons = [...depthByTeam.keys()]
      .filter((k) => k.endsWith(`|${team}`))
      .map((k) => Number(k.split('|')[0]))
      .sort((a, b) => b - a);
    return seasons.length > 0 ? (depthByTeam.get(`${seasons[0]}|${team}`) ?? []) : [];
  };

  // --- unit strength, as a percentile within its own lane ------------------
  //
  // A unit's raw strength is a role-weighted mean of ranking composites, and
  // composites of depth-chart starters sit well above the league mean by
  // construction — the population they were percentiled against includes every
  // fringe roster player. Subtracting a defensive *percentile* from that raw
  // number compared two different scales and handed the offense a systematic
  // ~17-point advantage in every lane. Percentiling unit strength against the
  // other 31 teams in the same lane puts both sides of the subtraction in the
  // same units, so an edge of zero means a genuinely even matchup.

  const rawStrength = new Map<string, number>();
  for (const [key, roster] of depthByTeam) {
    for (const lane of LANES) {
      const raw = unitStrength(roster, lane);
      if (raw != null) rawStrength.set(`${key}|${lane.key}`, raw);
    }
  }

  // One distribution per season and lane. A 2025 playoff roster belongs in the
  // 2025 league population, not pooled with 2026's.
  const laneDist: Record<string, Distribution> = {};
  const bySeasonLane = new Map<string, number[]>();
  for (const [key, value] of rawStrength) {
    const [seasonPart, , lanePart] = key.split('|');
    const bucket = `${seasonPart}|${lanePart}`;
    const list = bySeasonLane.get(bucket);
    if (list) list.push(value);
    else bySeasonLane.set(bucket, [value]);
  }
  for (const [bucket, values] of bySeasonLane) {
    const built = buildDistributions(values.map((value) => ({ metric: bucket, value })));
    if (built[bucket]) laneDist[bucket] = built[bucket];
  }

  const strengthPercentile = (
    gameSeason: number,
    team: string,
    lane: Lane,
  ): number | null => {
    const roster = rosterFor(gameSeason, team);
    const rosterSeason = roster[0]?.season ?? gameSeason;
    return percentileOf(
      rawStrength.get(`${rosterSeason}|${team}|${lane.key}`),
      laneDist[`${rosterSeason}|${lane.key}`],
    );
  };

  // --- per-game ------------------------------------------------------------

  const matchupRows: Record<string, unknown>[] = [];
  const playerRows: Record<string, unknown>[] = [];

  for (const game of targets) {
    const home = sideContext(game.home_team, game.home_coach, books);
    const away = sideContext(game.away_team, game.away_coach, books);

    const edges: LaneEdge[] = [];
    const laneEdgeByTeamLane = new Map<string, number | null>();
    // Keyed on the *defending* team, which is what a quarterback's legs are
    // matched against when the passing lane cannot express them.
    const laneSuppression = new Map<string, number | null>();

    for (const [offense, defense] of [
      [home, away],
      [away, home],
    ] as const) {
      for (const lane of LANES) {
        const edge = evaluateLane({
          lane,
          offense,
          defense,
          offenseStrength: strengthPercentile(game.season, offense.team, lane),
          dvpByTeam,
          dvpDist,
          dvoaByTeam,
          dvoaDist,
          books,
        });
        // Label the lane with its direction so a game's twelve edges stay
        // distinguishable once they are flattened into one list — and carry the
        // two teams as fields as well, since the game-script read groups edges
        // by offense and should not have to parse a sentence to do it.
        edges.push({
          ...edge,
          offense: offense.team,
          defense: defense.team,
          label: `${offense.team} ${lane.shortLabel} vs ${defense.team}`,
        });
        laneEdgeByTeamLane.set(`${offense.team}|${lane.key}`, edge.edge);
        laneSuppression.set(`${defense.team}|${lane.key}`, edge.defenseStrength);
      }
    }

    const pacePercentile = combinedPacePercentile(home, away, books.offense);
    const mismatch = computeMismatch({
      edges,
      totalLine: game.total_line,
      pacePercentile,
    });

    const alreadyPlayed = game.home_score != null;

    matchupRows.push({
      game_id: game.game_id,
      season: game.season,
      week: game.week,
      game_type: game.game_type,
      predicted_at: new Date(),
      // Set explicitly rather than left to the column default. `insertBatched`
      // upserts, and a DEFAULT only fires on insert — so a rebuilt row kept the
      // timestamp of the day it was first created and every freshness display
      // reading this column was days stale while the row underneath was current.
      computed_at: new Date(),
      // A prediction produced for a game that has already been played is a
      // demonstration, not a forecast. The flag rides along so the results
      // screen can label it rather than claim credit for it.
      backfilled: alreadyPlayed,
      locked: false,
      gameday: game.gameday,
      gametime: game.gametime,
      home_team: game.home_team,
      away_team: game.away_team,
      home_coach: game.home_coach,
      away_coach: game.away_coach,
      mismatch_score: round2(mismatch.mismatchScore),
      edge_score: round2(mismatch.edgeScore),
      edge_count: mismatch.edgeCount,
      // The second reading of the same game. `graded` guards it rather than
      // the score itself: with no gradeable lane the shootout score would be
      // built from the total alone, which is a number the market already
      // publishes and not something this model has a view on.
      shootout_score: mismatch.graded === 0 ? null : round2(mismatch.shootout.score),
      shootout_applied: mismatch.graded === 0 ? null : mismatch.shootout.applied,
      lean_team: mismatch.shootout.leanTeam,
      lean_margin: mismatch.graded === 0 ? null : round2(mismatch.shootout.lean),
      game_shape: mismatch.graded === 0 ? null : mismatch.shootout.shape,
      total_line: game.total_line,
      spread_line: game.spread_line,
      top_edge_label: mismatch.top?.label ?? null,
      top_edge_value: mismatch.top?.edge == null ? null : round2(mismatch.top.edge),
      detail: sql.json({
        edges,
        pacePercentile,
        home: describeSide(home, books),
        away: describeSide(away, books),
      } as never),
    });

    // --- players ---------------------------------------------------------

    for (const [team, opponent] of [
      [home, away],
      [away, home],
    ] as const) {
      const roster = rosterFor(game.season, team.team);
      const pace = percentileOf(
        team.offense.values.sec_per_play,
        books.offense.dist.sec_per_play,
        true, // faster is better for volume
      );

      for (const player of roster) {
        const position = normalizePosition(player.ranked_position ?? player.position);
        if (!position) continue;
        const laneKey = laneForPosition(position);
        if (!laneKey) continue;
        const lane = LANES_BY_KEY[laneKey];

        // A pass-catching back is graded in the receiving lane when his coach
        // actually throws to backs; otherwise the run lane is the honest one.
        const effectiveLane =
          position === 'RB' &&
          (tendencyPercentile(books.offense, team.offense, 'offense', 'rb_target_share') ?? 0) >= 65
            ? LANES_BY_KEY.rb_recv
            : lane;

        // Only players the lane actually counts are graded. A depth chart's
        // fourth quarterback is not a DFS decision, and listing him alongside
        // the starter — on the same lane edge, since the edge belongs to the
        // unit — makes the list read as though he were one.
        if (player.pos_rank != null && player.pos_rank > effectiveLane.maxRank) continue;

        const unitEdge = laneEdgeByTeamLane.get(`${team.team}|${effectiveLane.key}`) ?? null;

        // A quarterback's lane grades coverage, so a designed-run offense
        // against a soft front is invisible in it. This is the one place a
        // player's own trait modifies a unit-level edge, and it is bounded
        // hard enough to stay a modifier.
        const rushAdjustment =
          position === 'QB'
            ? qbRushAdjustment(
                qbCarries.get(player.gsis_id),
                laneSuppression.get(`${opponent.team}|rb_rush`),
              )
            : 0;
        const laneEdge =
          unitEdge == null ? null : clamp(unitEdge + rushAdjustment, -100, 100);
        const usage = effectiveLane.usageMetric
          ? tendencyPercentile(books.offense, team.offense, 'offense', effectiveLane.usageMetric)
          : null;

        const role = roleWeight(player.pos_rank, effectiveLane.maxRank) * 100;
        const volume =
          VOLUME_ROLE_WEIGHT * role +
          VOLUME_PACE_WEIGHT * (pace ?? 50) +
          VOLUME_USAGE_WEIGHT * (usage ?? 50);

        const graded = gradePlayerMatchup({
          composite: player.composite,
          laneEdge,
          volume,
        });

        playerRows.push({
          game_id: game.game_id,
          gsis_id: player.gsis_id,
          season: game.season,
          week: game.week,
          team: team.team,
          opponent: opponent.team,
          display_name: player.display_name,
          position,
          pos_rank: player.pos_rank,
          lane: effectiveLane.key,
          matchup_score: round2(graded.score),
          confidence: Number(graded.confidence.toFixed(3)),
          composite: player.composite == null ? null : round2(player.composite),
          lane_edge: laneEdge == null ? null : round2(laneEdge),
          volume_score: round2(volume),
          detail: sql.json({
            laneLabel: effectiveLane.label,
            factors: graded.factors,
            coach: team.coach,
            tendencySource: team.offense.source,
            tendencyConfidence: team.offense.confidence,
          } as never),
        });
      }
    }
  }

  // Replace only what we just rebuilt. Truncating would take locked rows with
  // it, and those are the record of what the model actually predicted.
  const rebuiltIds = targets.map((g) => g.game_id);
  await sql`DELETE FROM player_matchups WHERE game_id = ANY(${rebuiltIds})`;
  await insertBatched('matchups', matchupRows, '(game_id)');
  await insertBatched('player_matchups', playerRows, '(game_id, gsis_id)');

  return {
    season,
    week: current?.week ?? null,
    games: matchupRows.length,
    players: playerRows.length,
    skippedLocked,
  };
}

/**
 * The week now in play: the earliest one still holding an unplayed game.
 *
 * Ordered by kickoff rather than by week number so it stays correct across a
 * season boundary, where week 1 of the new year follows week 22 of the old.
 */
export async function currentWeek(): Promise<{ season: number; week: number } | null> {
  const [row] = await sql<{ season: number; week: number }[]>`
    SELECT season, week FROM games
    WHERE home_score IS NULL
    ORDER BY gameday NULLS LAST, game_id
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * The most recently completed week, wherever it falls.
 *
 * Deliberately not "current week minus one": before week 1 of a new season the
 * previous week of football is the last one of the old season, which right now
 * is the Super Bowl. Anchoring on kickoff dates rather than week numbers gets
 * that right without a special case.
 */
export async function previousWeek(): Promise<{ season: number; week: number } | null> {
  const [row] = await sql<{ season: number; week: number }[]>`
    SELECT season, week FROM games
    WHERE home_score IS NOT NULL
    GROUP BY season, week
    ORDER BY MAX(gameday) DESC
    LIMIT 1
  `;
  return row ?? null;
}

/** Skill positions, which are the ones a results comparison is about. */
const SKILL = ['QB', 'RB', 'WR', 'TE'];

/**
 * Attach real results to predictions whose games have finished, and lock them.
 *
 * Locking is the point. Once a prediction has been set beside the result it was
 * measuring, it must never be recomputed — otherwise the next refresh would
 * rebuild it from a tendency window that now contains the very game it was
 * predicting, and every accuracy figure on the screen would be the model
 * grading its own homework.
 */
export async function attachResults(): Promise<{ games: number; players: number }> {
  const pending = await sql<
    {
      game_id: string;
      season: number;
      week: number;
      game_type: string;
      home_score: number;
      away_score: number;
    }[]
  >`
    SELECT m.game_id, m.season, m.week, g.game_type, g.home_score, g.away_score
    FROM matchups m
    JOIN games g ON g.game_id = m.game_id
    WHERE g.home_score IS NOT NULL AND m.result_at IS NULL
    ORDER BY m.season, m.week
  `;

  let playerCount = 0;

  for (const game of pending) {
    // Postseason stats live under a different season_type at the same week
    // number, so the join has to know which kind of game this was.
    const seasonType = game.game_type === 'REG' ? 'REG' : 'POST';

    const actuals = await sql<
      {
        gsis_id: string;
        fantasy_points_ppr: number | null;
        receptions: number | null;
        targets: number | null;
        receiving_yards: number | null;
        rushing_yards: number | null;
        passing_yards: number | null;
        tds: number | null;
      }[]
    >`
      SELECT gsis_id,
             fantasy_points_ppr::float8 AS fantasy_points_ppr,
             receptions, targets,
             receiving_yards::float8 AS receiving_yards,
             rushing_yards::float8 AS rushing_yards,
             passing_yards::float8 AS passing_yards,
             (COALESCE(passing_tds,0) + COALESCE(rushing_tds,0)
              + COALESCE(receiving_tds,0))::int AS tds
      FROM player_week_offense
      WHERE season = ${game.season} AND week = ${game.week}
        AND season_type = ${seasonType}
    `;
    const actualById = new Map(actuals.map((a) => [a.gsis_id, a]));

    const predicted = await sql<
      { gsis_id: string; position: string; matchup_score: number }[]
    >`
      SELECT gsis_id, position, matchup_score::float8 AS matchup_score
      FROM player_matchups WHERE game_id = ${game.game_id}
      ORDER BY matchup_score DESC, gsis_id
    `;

    // Ranks are computed over skill players only: an offensive lineman has no
    // fantasy line to compare against, and including them would make the hit
    // rate a measure of how many linemen we listed.
    const skill = predicted.filter((p) => SKILL.includes(p.position));
    const predictedRank = new Map(skill.map((p, i) => [p.gsis_id, i + 1]));

    const scored = skill
      .map((p) => ({ ...p, points: actualById.get(p.gsis_id)?.fantasy_points_ppr ?? null }))
      .filter((p) => p.points != null)
      .sort((a, b) => b.points! - a.points!);
    const actualRank = new Map(scored.map((p, i) => [p.gsis_id, i + 1]));

    const topPredicted = new Set(
      skill.slice(0, 10).map((p) => p.gsis_id),
    );
    const topActual = new Set(scored.slice(0, 10).map((p) => p.gsis_id));
    const hits = [...topPredicted].filter((id) => topActual.has(id)).length;

    for (const p of predicted) {
      const actual = actualById.get(p.gsis_id);
      await sql`
        UPDATE player_matchups SET
          actual_points = ${actual?.fantasy_points_ppr ?? null},
          predicted_rank = ${predictedRank.get(p.gsis_id) ?? null},
          actual_rank = ${actualRank.get(p.gsis_id) ?? null},
          actual_line = ${
            actual
              ? sql.json({
                  receptions: actual.receptions,
                  targets: actual.targets,
                  receivingYards: actual.receiving_yards,
                  rushingYards: actual.rushing_yards,
                  passingYards: actual.passing_yards,
                  tds: actual.tds,
                } as never)
              : null
          }
        WHERE game_id = ${game.game_id} AND gsis_id = ${p.gsis_id}
      `;
      playerCount++;
    }

    await sql`
      UPDATE matchups SET
        home_score = ${game.home_score},
        away_score = ${game.away_score},
        top10_hits = ${topActual.size > 0 ? hits : null},
        result_at = now(),
        locked = TRUE
      WHERE game_id = ${game.game_id}
    `;
  }

  return { games: pending.length, players: playerCount };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildBooks(
  coachRows: TendencyRow[],
  teamRows: TendencyRow[],
  side: Side,
): ProfileBooks {
  const coach = indexTendencies(coachRows, side).byKey;
  const team = indexTendencies(teamRows, side).byKey;

  const observations: Array<{ metric: string; value: number }> = [];
  for (const entry of team.values()) {
    for (const [metric, value] of Object.entries(entry.values)) {
      observations.push({ metric, value });
    }
  }
  const dist = buildDistributions(observations);

  const league: Values = {};
  for (const [metric, d] of Object.entries(dist)) league[metric] = d.mean;

  return { coach, team, league, dist };
}

interface SideContext {
  team: string;
  coach: string | null;
  offense: ResolvedTendencies;
  defense: ResolvedTendencies;
}

function sideContext(
  team: string,
  coach: string | null,
  books: Record<Side, ProfileBooks>,
): SideContext {
  return {
    team,
    coach,
    offense: profileFor(books.offense, coach, team),
    defense: profileFor(books.defense, coach, team),
  };
}

/** Everything the app needs to render one staff's fingerprint. */
function describeSide(side: SideContext, books: Record<Side, ProfileBooks>) {
  const render = (s: Side, profile: ResolvedTendencies) => ({
    source: profile.source,
    confidence: profile.confidence,
    nGames: profile.nGames,
    metrics: Object.entries(profile.values).map(([metric, value]) => {
      const placing = tendencyRank(books[s], profile, s, metric);
      return {
        metric,
        value,
        percentile: tendencyPercentile(books[s], profile, s, metric),
        rank: placing?.rank ?? null,
        rankOf: placing?.of ?? null,
      };
    }),
  });

  return {
    team: side.team,
    coach: side.coach,
    offense: render('offense', side.offense),
    defense: render('defense', side.defense),
  };
}

/**
 * Combined pace of the two offenses, as a percentile.
 *
 * Two fast offenses mean more snaps for everyone, which is worth as much to a
 * DFS lineup as any single mismatch.
 */
function combinedPacePercentile(
  home: SideContext,
  away: SideContext,
  book: ProfileBooks,
): number | null {
  const values = [home.offense.values.sec_per_play, away.offense.values.sec_per_play].filter(
    (v): v is number => v != null,
  );
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // Lower seconds per play is a faster game, so invert.
  return percentileOf(mean, book.dist.sec_per_play, true);
}

/**
 * Role-weighted mean ranking composite for one team's unit in one lane.
 *
 * Raw and un-percentiled: the caller compares it against the same figure for
 * the other 31 teams before it means anything.
 */
function unitStrength(roster: DepthRow[], lane: Lane): number | null {
  let weighted = 0;
  let weight = 0;

  for (const player of roster) {
    const position = normalizePosition(player.ranked_position ?? player.position);
    if (!position || !lane.offensePositions.includes(position as Position)) continue;
    if (player.pos_rank != null && player.pos_rank > lane.maxRank) continue;
    if (player.composite == null) continue;

    const w = roleWeight(player.pos_rank, lane.maxRank);
    weighted += player.composite * w;
    weight += w;
  }

  return weight > 0 ? weighted / weight : null;
}

interface LaneEvaluation {
  lane: Lane;
  offense: SideContext;
  defense: SideContext;
  /** Already percentiled against the same lane across the league. */
  offenseStrength: number | null;
  dvpByTeam: Map<string, number>;
  dvpDist: Record<string, Distribution>;
  dvoaByTeam: Map<string, number>;
  dvoaDist: Record<string, Distribution>;
  books: Record<Side, ProfileBooks>;
}

function evaluateLane(input: LaneEvaluation): LaneEdge {
  const {
    lane, offense, defense, offenseStrength, dvpByTeam, dvpDist, dvoaByTeam, dvoaDist, books,
  } = input;

  // --- defensive suppression ---
  let dvpPercentile: number | null = null;
  if (lane.dvpPosition) {
    const allowed = dvpByTeam.get(`${defense.team}|${lane.dvpPosition}`);
    // Fewer points allowed is a better defense, so this is inverted.
    dvpPercentile = percentileOf(allowed, dvpDist[lane.dvpPosition], true);
  }

  let dvoaPercentile: number | null = null;
  if (lane.dvoaMetric) {
    const allowed = dvoaByTeam.get(`${defense.team}|${lane.dvoaMetric}`);
    // Less expected value surrendered per play is a better defense, so this is
    // inverted for the same reason the points-allowed percentile is.
    dvoaPercentile = percentileOf(allowed, dvoaDist[lane.dvoaMetric], true);
  }

  const schemeParts = lane.defenseMetrics
    .map((metric) => tendencyPercentile(books.defense, defense.defense, 'defense', metric))
    .filter((v): v is number => v != null);
  const schemePercentile =
    schemeParts.length > 0
      ? schemeParts.reduce((a, b) => a + b, 0) / schemeParts.length
      : null;

  /*
   * Blend whichever readings resolved, renormalized over their weights.
   *
   * Renormalizing rather than substituting a neutral value is the same rule the
   * ranking engine follows for a missing drill: a component nobody has evidence
   * for drops out and the rest speak for the whole, instead of a fabricated
   * fiftieth percentile pulling every grade toward the middle. The offensive
   * line lane has no defense-versus-position profile at all and is graded on
   * the other two — correctly, rather than at a permanent discount.
   */
  const components: Array<[number | null, number]> = [
    [dvpPercentile, DVP_WEIGHT],
    [dvoaPercentile, DVOA_WEIGHT],
    [schemePercentile, SCHEME_WEIGHT],
  ];
  let weighted = 0;
  let weight = 0;
  for (const [value, w] of components) {
    if (value == null) continue;
    weighted += value * w;
    weight += w;
  }
  const defenseStrength = weight > 0 ? weighted / weight : null;

  const usagePercentile = lane.usageMetric
    ? tendencyPercentile(books.offense, offense.offense, 'offense', lane.usageMetric)
    : null;

  return computeLaneEdge({ lane, offenseStrength, defenseStrength, usagePercentile });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    // --season builds every remaining game of the year (the best-ball view).
    // Default is the week now in play, which is the product surface.
    const scope = process.argv.includes('--season') ? 'season' : 'week';
    const backfillFlag = process.argv.indexOf('--backfill');
    const backfill =
      backfillFlag >= 0 ? process.argv.slice(backfillFlag + 1).filter((a) => !a.startsWith('--')) : [];

    const result = await computeMatchups({ scope, backfill });
    console.log(
      `Built ${result.games} matchups and ${result.players} player grades` +
        (result.skippedLocked ? ` (${result.skippedLocked} locked, left alone)` : ''),
    );

    const attached = await attachResults();
    if (attached.games > 0) {
      console.log(
        `Attached results to ${attached.games} finished game(s), ` +
          `${attached.players} player rows — now locked.`,
      );
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
