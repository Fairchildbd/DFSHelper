
import {
  ALL_DRILLS,
  buildBaselines,
  cohortFor,
  compareForRanking,
  isRankable,
  normalizePosition,
  scorePlayer,
  type BaselineTable,
  type PlayerInput,
  type Position,
  type ProductionRates,
} from '@dfs/shared';
import { insertBatched, sql } from './db.ts';
import { ACTIVE_SINCE_SEASON, PRODUCTION_WINDOW_SEASONS } from './env.ts';

const MIN_BASELINE_GAMES = 4;

const OPPORTUNITY_COLUMNS = new Set(['pass_attempts', 'touches', 'targets', 'starts']);

const NON_METRIC_COLUMNS = new Set(['gsis_id', 'games', 'seasons', ...OPPORTUNITY_COLUMNS]);

function opportunitiesFor(
  position: Position,
  rates: { games: number; counts: Record<string, number> } | undefined,
): number {
  if (!rates) return 0;
  switch (position) {
    case 'QB':
      return rates.counts.pass_attempts ?? 0;
    case 'RB':
    case 'FB':
      return rates.counts.touches ?? 0;
    case 'WR':
    case 'TE':
      return rates.counts.targets ?? 0;
    default:
      return rates.games;
  }
}

interface MeasurableRow {
  gsis_id: string | null;
  position: string | null;
  forty: number | null;
  bench: number | null;
  vertical: number | null;
  broad: number | null;
  cone: number | null;
  shuttle: number | null;
  source: string;
}

interface ProductionRow {
  gsis_id: string;
  games: number;
  [metric: string]: number | string;
}

const MEASURABLE_SELECT = sql`
  SELECT DISTINCT ON (COALESCE(m.gsis_id, m.measurable_key))
    m.gsis_id, m.position, m.source,
    m.forty::float8 AS forty,
    m.bench::float8 AS bench,
    m.vertical::float8 AS vertical,
    m.broad::float8 AS broad,
    m.cone::float8 AS cone,
    m.shuttle::float8 AS shuttle
  FROM measurables m
  WHERE m.position IS NOT NULL
  ORDER BY COALESCE(m.gsis_id, m.measurable_key),
           CASE m.source WHEN 'manual' THEN 0 WHEN 'combine' THEN 1 ELSE 2 END,
           m.season DESC NULLS LAST
`;

function offenseRates(seasonFrom: number) {
  return sql<ProductionRow[]>`
    SELECT gsis_id,
      COUNT(*)::int AS games,
      SUM(COALESCE(attempts, 0))::int AS pass_attempts,
      SUM(COALESCE(carries, 0) + COALESCE(receptions, 0))::int AS touches,
      SUM(COALESCE(targets, 0))::int AS targets,
      -- A start, approximated by a real workload. The weekly feed carries no
      -- started flag, and 15 attempts cleanly separates the two populations:
      -- full-time starters bottom out around 212 attempts for the window while
      -- players who never cleared 15 in a game top out around 17.
      COUNT(*) FILTER (WHERE COALESCE(attempts, 0) >= 15)::int AS starts,
      (SUM(COALESCE(fantasy_points_ppr, 0)) / COUNT(*))::float8 AS fantasy_points_ppr,
      (SUM(COALESCE(passing_first_downs, 0)) / COUNT(*))::float8 AS passing_first_downs,
      (SUM(COALESCE(rushing_yards, 0)) / COUNT(*))::float8 AS rushing_yards,
      -- Rushing expressed in fantasy points rather than yards, so a goal-line
      -- quarterback and a scrambler are not scored as the same player: six
      -- points a touchdown is most of the difference between them.
      ((SUM(COALESCE(rushing_yards, 0)) * 0.1 + SUM(COALESCE(rushing_tds, 0)) * 6)
        / COUNT(*))::float8 AS rushing_points,
      (SUM(COALESCE(receiving_yards, 0)) / COUNT(*))::float8 AS receiving_yards,
      -- Interceptions per attempt, not per game: see the note on the metric.
      (SUM(COALESCE(interceptions, 0))::numeric / NULLIF(SUM(attempts), 0))::float8
        AS interception_rate,
      (SUM(COALESCE(receptions, 0))::numeric / COUNT(*))::float8 AS receptions,
      AVG(target_share)::float8 AS target_share,
      -- Per-opportunity efficiency. NULL when the player had no opportunities,
      -- so the metric drops out rather than reading as a zero.
      --
      -- No longer scored: the metric lists in production.ts moved to the
      -- opponent-adjusted equivalents from player_dvoa, which are the same
      -- quantity with the strength of the defenses faced taken out. These are
      -- kept because they are the uncorrected comparison — the gap between the
      -- two is the schedule — and because they are cheap enough that dropping
      -- them buys nothing.
      (SUM(COALESCE(passing_epa, 0)) / NULLIF(SUM(attempts), 0))::float8   AS passing_epa_per_att,
      (SUM(COALESCE(rushing_epa, 0)) / NULLIF(SUM(carries), 0))::float8    AS rushing_epa_per_carry,
      (SUM(COALESCE(receiving_epa, 0)) / NULLIF(SUM(targets), 0))::float8  AS receiving_epa_per_tgt
    FROM player_week_offense
    WHERE season >= ${seasonFrom} AND season_type = 'REG'
    GROUP BY gsis_id
  `;
}

function defenseRates(seasonFrom: number) {
  return sql<ProductionRow[]>`
    SELECT gsis_id,
      COUNT(*)::int AS games,
      (SUM(COALESCE(def_tackles, 0)) / COUNT(*))::float8 AS def_tackles,
      (SUM(COALESCE(def_sacks, 0)) / COUNT(*))::float8 AS def_sacks,
      (SUM(COALESCE(def_qb_hits, 0)) / COUNT(*))::float8 AS def_qb_hits,
      (SUM(COALESCE(def_tackles_for_loss, 0)) / COUNT(*))::float8 AS def_tackles_for_loss,
      (SUM(COALESCE(def_pass_defended, 0)) / COUNT(*))::float8 AS def_pass_defended,
      (SUM(COALESCE(def_interceptions, 0)) / COUNT(*))::float8 AS def_interceptions
    FROM player_week_defense
    WHERE season >= ${seasonFrom} AND season_type = 'REG'
    GROUP BY gsis_id
  `;
}

function collegeRates() {
  return sql<ProductionRow[]>`
    SELECT gsis_id,
      SUM(COALESCE(games, 0))::int AS games,
      COUNT(*)::int AS seasons,
      MAX(passing_yards)::float8            AS cfb_passing_yards,
      MAX(passing_tds)::float8              AS cfb_passing_tds,
      MAX(rushing_yards)::float8            AS cfb_rushing_yards,
      MAX(rushing_tds)::float8              AS cfb_rushing_tds,
      MAX(receiving_yards)::float8          AS cfb_receiving_yards,
      MAX(receiving_tds)::float8            AS cfb_receiving_tds,
      MAX(receptions)::float8               AS cfb_receptions,
      MAX(tackles)::float8                  AS cfb_tackles,
      MAX(tackles_for_loss)::float8         AS cfb_tackles_for_loss,
      MAX(sacks)::float8                    AS cfb_sacks,
      MAX(pass_defended)::float8            AS cfb_pass_defended,
      MAX(interceptions_def)::float8        AS cfb_interceptions_def,
      -- Ratio stats from career totals.
      (SUM(completions) / NULLIF(SUM(attempts), 0))::float8            AS cfb_completion_pct,
      (SUM(passing_interceptions) / NULLIF(SUM(attempts), 0))::float8  AS cfb_interceptions,
      (SUM(rushing_yards) / NULLIF(SUM(carries), 0))::float8           AS cfb_yards_per_carry,
      (SUM(receiving_yards) / NULLIF(SUM(receptions), 0))::float8      AS cfb_yards_per_reception
    FROM college_player_season
    WHERE gsis_id IS NOT NULL
    GROUP BY gsis_id
  `;
}

function dvoaRates() {
  return sql<ProductionRow[]>`
    SELECT gsis_id,
      games,
      adj_passing_epa_per_dropback::float8   AS adj_passing_epa_per_dropback,
      adj_rushing_epa_per_carry::float8      AS adj_rushing_epa_per_carry,
      adj_receiving_epa_per_tgt::float8      AS adj_receiving_epa_per_tgt,
      adj_passing_success_rate::float8       AS adj_passing_success_rate,
      adj_rushing_success_rate::float8       AS adj_rushing_success_rate,
      adj_receiving_success_rate::float8     AS adj_receiving_success_rate
    FROM player_dvoa
  `;
}

function snapRates(seasonFrom: number) {
  return sql<ProductionRow[]>`
    SELECT p.gsis_id,
      COUNT(*)::int AS games,
      AVG(GREATEST(COALESCE(s.offense_pct, 0), COALESCE(s.defense_pct, 0)))::float8 AS snap_pct
    FROM snap_counts s
    JOIN players p ON p.pfr_id = s.pfr_id
    WHERE s.season >= ${seasonFrom} AND s.game_type = 'REG'
    GROUP BY p.gsis_id
  `;
}

interface ActivePlayer {
  gsis_id: string;
  display_name: string;
  position: string;
  team: string | null;
  years_experience: number | null;
  age: number | null;
}

export async function computeRankings(): Promise<{ ranked: number; baselines: number }> {
  const [{ max_season }] = await sql<{ max_season: number | null }[]>`
    SELECT MAX(season)::int AS max_season FROM player_week_offense
  `;
  const latestSeason = max_season ?? new Date().getFullYear();
  const seasonFrom = latestSeason - (PRODUCTION_WINDOW_SEASONS - 1);

  console.log(`Production window: ${seasonFrom}–${latestSeason}`);

  const [measurables, offense, defense, snaps, college, dvoa, players] = await Promise.all([
    // postgres.js types a query as PendingQuery, which is thenable but not a
    // Promise, so Promise.all cannot infer its row type.
    MEASURABLE_SELECT as unknown as Promise<MeasurableRow[]>,
    offenseRates(seasonFrom),
    defenseRates(seasonFrom),
    snapRates(seasonFrom),
    collegeRates(),
    dvoaRates(),
    sql<ActivePlayer[]>`
      SELECT gsis_id, display_name, position, team,
        years_experience,
        CASE WHEN birth_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (now() - birth_date)) / 31557600.0
        END::float8 AS age
      FROM players
      WHERE position IS NOT NULL
        AND last_season >= ${ACTIVE_SINCE_SEASON}
    `,
  ]);

  const baselineRows: Array<{ position: Position; metric: string; value: number }> = [];

  for (const m of measurables) {
    const position = normalizePosition(m.position);
    if (!position || !isRankable(position)) continue;
    for (const drill of ALL_DRILLS) {
      const value = m[drill];
      if (value != null && Number.isFinite(value)) {
        baselineRows.push({ position, metric: drill, value });
      }
    }
  }

  const positionById = new Map<string, Position>();
  for (const p of players) {
    const position = normalizePosition(p.position);
    if (position && isRankable(position)) positionById.set(p.gsis_id, position);
  }

  const addProductionBaselines = (rows: ProductionRow[]) => {
    for (const row of rows) {
      const position = positionById.get(row.gsis_id);
      if (!position) continue;
      if (Number(row.games) < MIN_BASELINE_GAMES) continue;
      for (const [metric, value] of Object.entries(row)) {
        if (NON_METRIC_COLUMNS.has(metric)) continue;
        if (typeof value === 'number' && Number.isFinite(value)) {
          baselineRows.push({ position, metric, value });
        }
      }
    }
  };
  addProductionBaselines(offense);
  addProductionBaselines(defense);
  addProductionBaselines(snaps);
  addProductionBaselines(college);
  addProductionBaselines(dvoa);

  const table: BaselineTable = buildBaselines(baselineRows);

  const baselinePayload = Object.entries(table).flatMap(([scope, metrics]) =>
    Object.entries(metrics).map(([metric, b]) => ({
      scope,
      metric,
      mean: b.mean,
      sd: b.sd,
      n: b.n,
      computed_at: new Date(),
    })),
  );
  await sql`TRUNCATE baselines`;
  await insertBatched('baselines', baselinePayload, '(scope, metric)');

  const measurablesById = new Map<string, MeasurableRow>();
  for (const m of measurables) {
    if (m.gsis_id) measurablesById.set(m.gsis_id, m);
  }

  const rateIndex = new Map<
    string,
    { rates: ProductionRates; games: number; counts: Record<string, number> }
  >();
  const mergeRates = (rows: ProductionRow[]) => {
    for (const row of rows) {
      const entry = rateIndex.get(row.gsis_id) ?? { rates: {}, games: 0, counts: {} };
      for (const [metric, value] of Object.entries(row)) {
        if (metric === 'gsis_id') continue;
        const n = Number(value);
        if (metric === 'games') {
          entry.games = Math.max(entry.games, n);
          continue;
        }
        if (OPPORTUNITY_COLUMNS.has(metric)) {
          if (Number.isFinite(n)) entry.counts[metric] = Math.max(entry.counts[metric] ?? 0, n);
          continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) entry.rates[metric] = value;
      }
      rateIndex.set(row.gsis_id, entry);
    }
  };
  mergeRates(offense);
  mergeRates(defense);
  mergeRates(snaps);
  mergeRates(dvoa);

  const collegeIndex = new Map<string, { rates: ProductionRates; seasons: number }>();
  for (const row of college) {
    const rates: ProductionRates = {};
    for (const [metric, value] of Object.entries(row)) {
      if (metric === 'gsis_id' || metric === 'games' || metric === 'seasons') continue;
      if (typeof value === 'number' && Number.isFinite(value)) rates[metric] = value;
    }
    collegeIndex.set(row.gsis_id, { rates, seasons: Number(row.seasons ?? 0) });
  }

  const inputs: PlayerInput[] = [];
  for (const p of players) {
    const position = normalizePosition(p.position);
    if (!position || !isRankable(position)) continue;

    const m = measurablesById.get(p.gsis_id);
    const rates = rateIndex.get(p.gsis_id);
    const cfb = collegeIndex.get(p.gsis_id);

    inputs.push({
      playerId: p.gsis_id,
      name: p.display_name,
      position,
      team: p.team,
      age: p.age == null ? null : Math.round(p.age * 10) / 10,
      yearsExperience: p.years_experience ?? 0,
      measurables: m
        ? {
            forty: m.forty ?? undefined,
            bench: m.bench ?? undefined,
            vertical: m.vertical ?? undefined,
            broad: m.broad ?? undefined,
            cone: m.cone ?? undefined,
            shuttle: m.shuttle ?? undefined,
          }
        : {},
      measurableSource: (m?.source as PlayerInput['measurableSource']) ?? null,
      production: rates?.rates ?? {},
      gamesPlayed: rates?.games ?? 0,
      opportunities: opportunitiesFor(position, rates),
      starts: rates?.counts.starts ?? 0,
      collegeProduction: cfb?.rates ?? {},
      collegeSeasons: cfb?.seasons ?? 0,
    });
  }

  const scores = inputs.map((input) => scorePlayer(input, table));

  scores.sort(compareForRanking);

  const positionCounters = new Map<string, number>();
  const rankingRows = scores.map((s, index) => {
    const nextRank = (positionCounters.get(s.position) ?? 0) + 1;
    positionCounters.set(s.position, nextRank);
    return {
      gsis_id: s.playerId,
      display_name: s.name,
      position: s.position,
      cohort: s.cohort,
      team: s.team,
      age: s.age,
      years_experience: s.yearsExperience,
      composite: s.composite,
      athletic_score: s.athletic.score,
      athletic_confidence: s.athletic.confidence,
      college_score: s.college.score,
      college_confidence: s.college.confidence,
      production_score: s.production.score,
      production_confidence: s.production.confidence,
      production_weight: s.productionWeight,
      opportunities: s.opportunities,
      qualified: s.qualified,
      starts: s.starts,
      rank_tier: s.rankTier,
      weight_athletic: s.weights.athletic,
      weight_college: s.weights.college,
      weight_nfl: s.weights.nfl,
      position_rank: nextRank,
      overall_rank: index + 1,
      detail: sql.json(s as never),
      computed_at: new Date(),
    };
  });

  await sql`TRUNCATE rankings`;
  await insertBatched('rankings', rankingRows, '(gsis_id)');

  return { ranked: rankingRows.length, baselines: baselinePayload.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await computeRankings();
    console.log(`Ranked ${result.ranked} players from ${result.baselines} baselines.`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
