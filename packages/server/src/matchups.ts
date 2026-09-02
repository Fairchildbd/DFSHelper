
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
  defensiveLaneFor,
  normalizePosition,
  percentileOf,
  resolveTendencies,
  roleWeight,
  tendencyMetric,
  type Distribution,
  type Lane,
  type LaneEdge,
  SUPPORT_WEIGHT,
  QB_LANE_SOURCES,
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
  pos_abb: string | null;
  pos_rank: number | null;
  position: string;
  display_name: string;
  composite: number | null;
  ranked_position: string | null;
}

interface StrengthQuery {
  side: Side;
  season: number;
  team: string;
  lane: Lane;
}

const DVP_WEIGHT = 0.3;
const DVOA_WEIGHT = 0.25;
const SCHEME_WEIGHT = 0.2;
const DEFENSE_UNIT_WEIGHT = 0.25;
const BLITZ_WEIGHT = 0.15;

const VOLUME_ROLE_WEIGHT = 0.6;
const VOLUME_PACE_WEIGHT = 0.2;
const VOLUME_USAGE_WEIGHT = 0.2;

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

function tendencyPercentile(
  books: ProfileBooks,
  profile: ResolvedTendencies,
  side: Side,
  metric: string,
): number | null {
  const definition = tendencyMetric(side, metric);
  const lowerIsBetter = definition?.higherIsBetter === false;
  return percentileOf(profile.values[metric], books.dist[metric], lowerIsBetter);
}

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
  scope?: 'week' | 'season';
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
      SELECT d.season, d.team, d.gsis_id, d.pos_abb, d.pos_rank, d.position,
             COALESCE(r.display_name, p.display_name) AS display_name,
             r.composite::float8 AS composite,
             r.position AS ranked_position
      FROM depth_chart d
      JOIN players p ON p.gsis_id = d.gsis_id
      LEFT JOIN rankings r ON r.gsis_id = d.gsis_id
      -- A returner already sits on this chart under his real job, and his KR or
      -- PR line usually ranks first, so the dedupe below keeps the returner slot
      -- and hands a fourth receiver a starter's role weight. Filtering on unit
      -- catches them; filtering on position does not, because a returner
      -- carries the position he actually plays.
      WHERE d.position IS NOT NULL AND d.unit IS DISTINCT FROM 'special'
    `,
  ]);

  const targets = games.filter((g) => !lockedIds.has(g.game_id));
  const skippedLocked = games.length - targets.length;

  if (targets.length === 0) {
    console.log(`  nothing to build (${skippedLocked} already locked)`);
    return { season, week: current?.week ?? null, games: 0, players: 0, skippedLocked };
  }

  const books: Record<Side, ProfileBooks> = {
    offense: buildBooks(coachRows, teamRows, 'offense'),
    defense: buildBooks(coachRows, teamRows, 'defense'),
  };

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

  const dvoaByTeam = new Map<string, number>();
  for (const r of dvoaRows) dvoaByTeam.set(`${r.team}|${r.metric}`, r.value);
  const dvoaDist = buildDistributions(
    dvoaRows.map((r) => ({ metric: r.metric, value: r.value })),
  );

  const bestSlot = new Map<string, DepthRow>();
  for (const row of depth) {
    const key = `${row.season}|${row.team}|${row.gsis_id}`;
    const existing = bestSlot.get(key);
    if (existing && (existing.pos_rank ?? 99) <= (row.pos_rank ?? 99)) continue;
    bestSlot.set(key, row);
  }

  const depthByTeam = new Map<string, DepthRow[]>();
  for (const row of bestSlot.values()) {
    const key = `${row.season}|${row.team}`;
    const list = depthByTeam.get(key);
    if (list) list.push(row);
    else depthByTeam.set(key, [row]);
  }

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

  const rawStrength = new Map<string, number>();
  for (const [key, roster] of depthByTeam) {
    for (const lane of LANES) {
      const offense = offenseUnitStrength(roster, lane);
      if (offense != null) rawStrength.set(`offense|${key}|${lane.key}`, offense);
      const defense = defenseUnitStrength(roster, lane);
      if (defense != null) rawStrength.set(`defense|${key}|${lane.key}`, defense);
    }
  }

  const laneDist: Record<string, Distribution> = {};
  const bySeasonLane = new Map<string, number[]>();
  for (const [key, value] of rawStrength) {
    const [sidePart, seasonPart, , lanePart] = key.split('|');
    const bucket = `${sidePart}|${seasonPart}|${lanePart}`;
    const list = bySeasonLane.get(bucket);
    if (list) list.push(value);
    else bySeasonLane.set(bucket, [value]);
  }
  for (const [bucket, values] of bySeasonLane) {
    const built = buildDistributions(values.map((value) => ({ metric: bucket, value })));
    if (built[bucket]) laneDist[bucket] = built[bucket];
  }

  const strengthPercentile = ({ side, season, team, lane }: StrengthQuery): number | null => {
    const roster = rosterFor(season, team);
    const rosterSeason = roster[0]?.season ?? season;
    return percentileOf(
      rawStrength.get(`${side}|${rosterSeason}|${team}|${lane.key}`),
      laneDist[`${side}|${rosterSeason}|${lane.key}`],
    );
  };

  const matchupRows: Record<string, unknown>[] = [];
  const playerRows: Record<string, unknown>[] = [];

  for (const game of targets) {
    const home = sideContext(game.home_team, game.home_coach, books);
    const away = sideContext(game.away_team, game.away_coach, books);

    const edges: LaneEdge[] = [];
    const laneEdgeByTeamLane = new Map<string, number | null>();
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
          offenseStrength: strengthPercentile({
            side: 'offense',
            season: game.season,
            team: offense.team,
            lane,
          }),
          defenseUnit: strengthPercentile({
            side: 'defense',
            season: game.season,
            team: defense.team,
            lane,
          }),
          dvpByTeam,
          dvpDist,
          dvoaByTeam,
          dvoaDist,
          books,
        });
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

    for (const side of [home, away]) {
      let weighted = 0;
      let weight = 0;
      for (const source of QB_LANE_SOURCES) {
        const sourceEdge = laneEdgeByTeamLane.get(`${side.team}|${source.lane}`);
        if (sourceEdge == null) continue;
        weighted += sourceEdge * source.weight;
        weight += source.weight;
      }
      if (weight === 0) continue;

      const derived = clamp(weighted / weight, -100, 100);
      laneEdgeByTeamLane.set(`${side.team}|qb_pass`, derived);
      const entry = edges.find((e) => e.lane === 'qb_pass' && e.offense === side.team);
      if (entry) entry.edge = derived;
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
      computed_at: new Date(),
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

    for (const [team, opponent] of [
      [home, away],
      [away, home],
    ] as const) {
      const roster = rosterFor(game.season, team.team);
      const pace = percentileOf(
        team.offense.values.sec_per_play,
        books.offense.dist.sec_per_play,
        true,
      );

      for (const player of roster) {
        const position = normalizePosition(player.ranked_position ?? player.position);
        if (!position) continue;
        const offenseLaneKey = laneForPosition(position);
        const defenseLaneKey = offenseLaneKey ? null : defensiveLaneFor(player.pos_abb);
        let effectiveLane: Lane;
        let laneEdge: number | null;
        let usage: number | null;
        let roleMax: number;

        if (offenseLaneKey) {
          const lane = LANES_BY_KEY[offenseLaneKey];
          effectiveLane =
            position === 'RB' &&
            (tendencyPercentile(books.offense, team.offense, 'offense', 'rb_target_share') ?? 0) >= 65
              ? LANES_BY_KEY.rb_recv
              : lane;

          if (player.pos_rank != null && player.pos_rank > effectiveLane.maxRank) continue;
          roleMax = effectiveLane.maxRank;

          const unitEdge = laneEdgeByTeamLane.get(`${team.team}|${effectiveLane.key}`) ?? null;
          const rushAdjustment =
            position === 'QB'
              ? qbRushAdjustment(
                  qbCarries.get(player.gsis_id),
                  laneSuppression.get(`${opponent.team}|rb_rush`),
                )
              : 0;
          laneEdge = unitEdge == null ? null : clamp(unitEdge + rushAdjustment, -100, 100);
          usage = effectiveLane.usageMetric
            ? tendencyPercentile(books.offense, team.offense, 'offense', effectiveLane.usageMetric)
            : null;
        } else if (defenseLaneKey) {
          effectiveLane = LANES_BY_KEY[defenseLaneKey];
          if (player.pos_rank != null && player.pos_rank > effectiveLane.defenseMaxRank) continue;
          roleMax = effectiveLane.defenseMaxRank;

          const facedEdge = laneEdgeByTeamLane.get(`${opponent.team}|${effectiveLane.key}`) ?? null;
          laneEdge = facedEdge == null ? null : clamp(-facedEdge, -100, 100);
          usage = null;
        } else {
          continue;
        }

        const role = roleWeight(player.pos_rank, roleMax) * 100;
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

export async function currentWeek(): Promise<{ season: number; week: number } | null> {
  const [row] = await sql<{ season: number; week: number }[]>`
    SELECT season, week FROM games
    WHERE home_score IS NULL
    ORDER BY gameday NULLS LAST, game_id
    LIMIT 1
  `;
  return row ?? null;
}

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

const SKILL = ['QB', 'RB', 'WR', 'TE'];

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
  return percentileOf(mean, book.dist.sec_per_play, true);
}

function offenseUnitStrength(roster: DepthRow[], lane: Lane): number | null {
  let weighted = 0;
  let weight = 0;

  for (const player of roster) {
    const position = normalizePosition(player.ranked_position ?? player.position);
    if (!position) continue;
    const isPrimary = lane.offensePositions.includes(position);
    const isSupport = lane.supportPositions.includes(position);
    if (!isPrimary && !isSupport) continue;
    if (player.pos_rank != null && player.pos_rank > lane.maxRank) continue;
    if (player.composite == null) continue;

    const w = roleWeight(player.pos_rank, lane.maxRank) * (isPrimary ? 1 : SUPPORT_WEIGHT);
    weighted += player.composite * w;
    weight += w;
  }

  return weight > 0 ? weighted / weight : null;
}

function levelStrength(roster: DepthRow[], slots: string[], maxRank: number): number | null {
  let weighted = 0;
  let weight = 0;

  for (const player of roster) {
    if (!player.pos_abb || !slots.includes(player.pos_abb)) continue;
    if (player.pos_rank != null && player.pos_rank > maxRank) continue;
    if (player.composite == null) continue;

    const w = roleWeight(player.pos_rank, maxRank);
    weighted += player.composite * w;
    weight += w;
  }

  return weight > 0 ? weighted / weight : null;
}

function defenseUnitStrength(roster: DepthRow[], lane: Lane): number | null {
  let weighted = 0;
  let weight = 0;

  for (const level of lane.defenseLevels) {
    const strength = levelStrength(roster, level.slots, lane.defenseMaxRank);
    if (strength == null) continue;
    weighted += strength * level.weight;
    weight += level.weight;
  }

  return weight > 0 ? weighted / weight : null;
}

interface LaneEvaluation {
  lane: Lane;
  offense: SideContext;
  defense: SideContext;
  offenseStrength: number | null;
  defenseUnit: number | null;
  dvpByTeam: Map<string, number>;
  dvpDist: Record<string, Distribution>;
  dvoaByTeam: Map<string, number>;
  dvoaDist: Record<string, Distribution>;
  books: Record<Side, ProfileBooks>;
}

function evaluateLane(input: LaneEvaluation): LaneEdge {
  const {
    lane, offense, defense, offenseStrength, defenseUnit,
    dvpByTeam, dvpDist, dvoaByTeam, dvoaDist, books,
  } = input;

  let dvpPercentile: number | null = null;
  if (lane.dvpPosition) {
    const allowed = dvpByTeam.get(`${defense.team}|${lane.dvpPosition}`);
    dvpPercentile = percentileOf(allowed, dvpDist[lane.dvpPosition], true);
  }

  let dvoaPercentile: number | null = null;
  if (lane.dvoaMetric) {
    const allowed = dvoaByTeam.get(`${defense.team}|${lane.dvoaMetric}`);
    dvoaPercentile = percentileOf(allowed, dvoaDist[lane.dvoaMetric], true);
  }

  const blitzPercentile = lane.blitzMetric
    ? tendencyPercentile(books.defense, defense.defense, 'defense', lane.blitzMetric)
    : null;

  const schemeParts = lane.defenseMetrics
    .map((metric) => tendencyPercentile(books.defense, defense.defense, 'defense', metric))
    .filter((v): v is number => v != null);
  const schemePercentile =
    schemeParts.length > 0
      ? schemeParts.reduce((a, b) => a + b, 0) / schemeParts.length
      : null;

  const components: Array<[number | null, number]> = [
    [dvpPercentile, DVP_WEIGHT],
    [dvoaPercentile, DVOA_WEIGHT],
    [schemePercentile, SCHEME_WEIGHT],
    [defenseUnit, DEFENSE_UNIT_WEIGHT],
    [blitzPercentile, BLITZ_WEIGHT],
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
