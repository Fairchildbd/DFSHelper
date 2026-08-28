/**
 * Read-only HTTP API over the materialized rankings.
 *
 * Scoring happens in the ingest/rank pass, not per request — every endpoint
 * here is a straight read, so the app stays responsive and the engine's output
 * is identical for every client.
 */

import express, { type Request, type Response } from 'express';
import {
  COHORT_LABELS,
  COHORT_WEIGHTS,
  DEFENSE_TENDENCIES,
  DRILL_LABELS,
  DRILL_UNITS,
  EDGE_THRESHOLD,
  FACTOR_WEIGHTS,
  LANES,
  DEFENSE_EDGE_WEIGHT,
  LEAN_TOLERANCE,
  LIVE_GAME_FLOOR,
  SHOOTOUT_TOTAL_CEILING,
  SHOOTOUT_TOTAL_FLOOR,
  SHOOTOUT_WEIGHTS,
  WEAKER_OFFENSE_WEIGHT,
  MAX_USAGE_ADJUSTMENT,
  OFFENSE_TENDENCIES,
  PRODUCTION_METRICS,
  RANKABLE_COHORTS,
  STRATEGIES,
  TOP_EDGES,
} from '@dfs/shared';
import { sql } from './db.ts';
import { currentWeek, previousWeek } from './matchups.ts';
import { buildLineup } from './lineups.ts';

/**
 * Human name for a week. Postseason weeks continue the regular-season
 * numbering upstream, so week 22 is the Super Bowl rather than a 22nd Sunday.
 */
function weekLabel(week: number, gameType: string): string {
  switch (gameType) {
    case 'WC': return 'Wild Card';
    case 'DIV': return 'Divisional Round';
    case 'CON': return 'Conference Championships';
    case 'SB': return 'Super Bowl';
    default: return `Week ${week}`;
  }
}

/**
 * Adapt an async handler to Express 4's error plumbing.
 *
 * Express 4 ignores a promise returned by a handler, so a rejected one is
 * simply unhandled -- and under Node's default policy an unhandled rejection
 * terminates the process. Every route here reads from Postgres, so a single
 * bad query would take the whole server down instead of failing one request,
 * and the error middleware below would never see it. Forwarding to next()
 * gives that middleware the error and keeps the process alive.
 */
/**
 * The order the weekly list is grouped in: playable games first, and within
 * the quiet half, the ones with a reason last.
 *
 * Kept as SQL rather than sorted in the client because the sections are the
 * list's structure, not a rendering choice, and two endpoints serve it.
 */
const SHAPE_ORDER = ['shootout', 'one_sided', 'low_scoring', 'defensive'] as const;

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    handler(req, res).catch(next);
  };
}

/**
 * Reading order for a starting lineup.
 *
 * The upstream slot numbers run in the order ESPN draws its chart — receivers
 * first, quarterback ninth — which is not how anyone reads a lineup. Roles not
 * listed sort to the end of their unit in slot order.
 */
const ROLE_ORDER: Record<string, string[]> = {
  offense: ['QB', 'RB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'],
  defense: [
    'LDE', 'LDT', 'NT', 'RDT', 'RDE',
    'WLB', 'MLB', 'SLB', 'LILB', 'RILB',
    'LCB', 'RCB', 'NB', 'SS', 'FS',
  ],
  special: ['PK', 'P', 'LS', 'H', 'KR', 'PR'],
};

function roleOrder(unit: string | null, role: string | null): number {
  const order = ROLE_ORDER[unit ?? ''] ?? [];
  const at = order.indexOf(role ?? '');
  return at === -1 ? order.length : at;
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', route(async (_req: Request, res: Response) => {
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM rankings`;
    res.json({ ok: true, rankedPlayers: row?.count ?? 0 });
  }));

  /** Static description of the scoring model, so the app never hardcodes weights. */
  app.get('/meta', route(async (_req: Request, res: Response) => {
    const [run] = await sql<{ finished_at: Date | null; status: string; detail: unknown }[]>`
      SELECT finished_at, status, detail FROM ingest_runs
      ORDER BY id DESC LIMIT 1
    `;
    const positions = await sql<{ position: string; count: number }[]>`
      SELECT position, COUNT(*)::int AS count FROM rankings
      GROUP BY position ORDER BY position
    `;
    res.json({
      cohorts: RANKABLE_COHORTS.map((c) => ({
        key: c,
        label: COHORT_LABELS[c],
        weights: COHORT_WEIGHTS[c],
      })),
      drills: Object.entries(DRILL_LABELS).map(([key, label]) => ({
        key,
        label,
        unit: DRILL_UNITS[key as keyof typeof DRILL_UNITS],
      })),
      productionMetrics: PRODUCTION_METRICS,
      positions,
      lastIngest: run ?? null,
    });
  }));

  /**
   * Ranked players. Filterable by position or cohort, searchable by name.
   * Ranks are precomputed, so paging never reshuffles the list.
   */
  app.get('/rankings', route(async (req: Request, res: Response) => {
    const position = typeof req.query.position === 'string' ? req.query.position : null;
    const cohort = typeof req.query.cohort === 'string' ? req.query.cohort : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    const rows = await sql`
      SELECT gsis_id, display_name, position, cohort, team, age, years_experience,
             composite, athletic_score, athletic_confidence,
             production_score, production_confidence, production_weight,
             college_score, college_confidence,
             weight_athletic, weight_college, weight_nfl,
             opportunities, qualified, starts, rank_tier,
             position_rank, overall_rank
      FROM rankings
      WHERE TRUE
        ${position ? sql`AND position = ${position}` : sql``}
        ${cohort ? sql`AND cohort = ${cohort}` : sql``}
        ${search ? sql`AND display_name ILIKE ${'%' + search + '%'}` : sql``}
      -- gsis_id breaks ties into a total order. Without it, paging through the
      -- large block of players who share a composite is undefined between
      -- statements, so a row can land on two consecutive pages.
      -- Mirrors compareForRanking in the engine: graded before unmeasured,
      -- starters before backups where the job is the point, then score.
      ORDER BY qualified DESC NULLS LAST, COALESCE(rank_tier, 0) ASC, composite DESC, gsis_id
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM rankings
      WHERE TRUE
        ${position ? sql`AND position = ${position}` : sql``}
        ${cohort ? sql`AND cohort = ${cohort}` : sql``}
        ${search ? sql`AND display_name ILIKE ${'%' + search + '%'}` : sql``}
    `;

    res.json({ total: count, limit, offset, players: rows });
  }));

  // -------------------------------------------------------------------------
  // Matchups
  // -------------------------------------------------------------------------

  /**
   * Weeks available, and which one the app should open on.
   *
   * "Current" is the earliest week still holding an unplayed game, so in the
   * preseason it is week 1 and mid-season it is the week in progress rather
   * than the one just finished.
   */
  app.get('/weeks', route(async (_req: Request, res: Response) => {
    // Driven by the schedule, not by what has been predicted: the weekly job
    // only builds the week in play, so joining matchups here would leave the
    // best-ball selector showing a single chip and no way to see what is
    // missing. `built` reports coverage instead.
    const current = await currentWeek();
    const season = current?.season ?? null;

    const weeks = await sql<
      {
        season: number;
        week: number;
        games: number;
        played: number;
        built: number;
        kickoff: string | null;
      }[]
    >`
      SELECT g.season, g.week, COUNT(*)::int AS games,
             SUM(CASE WHEN g.home_score IS NOT NULL THEN 1 ELSE 0 END)::int AS played,
             COUNT(m.game_id)::int AS built,
             MIN(g.gameday)::text AS kickoff
      FROM games g
      LEFT JOIN matchups m ON m.game_id = g.game_id
      WHERE g.game_type = 'REG'
        ${season ? sql`AND g.season = ${season}` : sql``}
      GROUP BY g.season, g.week
      ORDER BY g.season, g.week
    `;
    res.json({
      weeks,
      current,
      // True before any game of the week has kicked off, which the list uses to
      // say that every number on screen comes from prior seasons.
      upcoming: weeks.find((w) => w.week === current?.week)?.played === 0,
    });
  }));

  /**
   * Static description of the matchup model, mirroring /meta for rankings.
   *
   * `model` exists so the About tab can explain the arithmetic without
   * restating it. Any constant quoted in prose on screen is served from here
   * rather than typed into the copy, because an explanation that drifts from
   * the code it describes is worse than no explanation at all.
   */
  app.get('/matchup-meta', route(async (_req: Request, res: Response) => {
    res.json({
      lanes: LANES.map((l) => ({ key: l.key, label: l.label, shortLabel: l.shortLabel })),
      offenseTendencies: OFFENSE_TENDENCIES,
      defenseTendencies: DEFENSE_TENDENCIES,
      edgeThreshold: EDGE_THRESHOLD,
      model: {
        edgeThreshold: EDGE_THRESHOLD,
        topEdges: TOP_EDGES,
        maxUsageAdjustment: MAX_USAGE_ADJUSTMENT,
        defenseEdgeWeight: DEFENSE_EDGE_WEIGHT,
        shootoutWeights: SHOOTOUT_WEIGHTS,
        shootoutTotalFloor: SHOOTOUT_TOTAL_FLOOR,
        shootoutTotalCeiling: SHOOTOUT_TOTAL_CEILING,
        weakerOffenseWeight: WEAKER_OFFENSE_WEIGHT,
        liveGameFloor: LIVE_GAME_FLOOR,
        leanTolerance: LEAN_TOLERANCE,
        factorWeights: FACTOR_WEIGHTS,
      },
    });
  }));

  /**
   * One week's slate, grouped by what kind of game each one is.
   *
   * `shapeOrder` rides along so a client renders the sections in the order the
   * query built them rather than reimplementing that order and drifting.
   */
  app.get('/matchups', route(async (req: Request, res: Response) => {
    const season = req.query.season ? Number(req.query.season) : null;
    const week = req.query.week ? Number(req.query.week) : null;

    const rows = await sql`
      SELECT game_id, season, week, gameday::text AS gameday, gametime, home_team, away_team,
             home_coach, away_coach, mismatch_score, edge_score, edge_count,
             total_line, spread_line,
             top_edge_label, top_edge_value,
             shootout_score, shootout_applied, lean_team, lean_margin, game_shape
      FROM matchups
      WHERE TRUE
        ${season ? sql`AND season = ${season}` : sql``}
        ${week ? sql`AND week = ${week}` : sql``}
      ORDER BY ARRAY_POSITION(${SHAPE_ORDER as unknown as string[]}::text[], game_shape),
               shootout_score DESC NULLS LAST, game_id
    `;
    res.json({ games: rows, shapeOrder: SHAPE_ORDER });
  }));


  /**
   * One matchup in full: both coaching fingerprints, every lane edge, the
   * graded players, and both starting lineups.
   */
  app.get('/matchups/:gameId', route(async (req: Request, res: Response) => {
    const gameId = req.params.gameId;

    // The trailing gameday::text shadows the one m.* brings in. gameday is a
    // DATE, and left alone the driver hands back a JS Date that serialises to a
    // full UTC instant — a calendar date the client would have to un-convert.
    const [game] = await sql`
      SELECT m.*, m.gameday::text AS gameday,
             g.home_score, g.away_score, g.roof, g.stadium, g.div_game
      FROM matchups m
      JOIN games g ON g.game_id = m.game_id
      WHERE m.game_id = ${gameId}
    `;
    if (!game) {
      res.status(404).json({ error: 'Matchup not found' });
      return;
    }

    const players = await sql`
      SELECT pm.gsis_id, pm.team, pm.opponent, pm.display_name, pm.position,
             pm.pos_rank, pm.lane, pm.matchup_score, pm.confidence, pm.composite,
             pm.lane_edge, pm.volume_score, pm.detail,
             pm.actual_points, pm.actual_rank, pm.predicted_rank, pm.actual_line,
             p.headshot_url
      FROM player_matchups pm
      LEFT JOIN players p ON p.gsis_id = pm.gsis_id
      WHERE pm.game_id = ${gameId}
      ORDER BY pm.matchup_score DESC, pm.gsis_id
    `;

    // The chart to read is the game's own season, falling back to the newest
    // one on file when a season was never published — a backfilled playoff
    // game must show the roster that played it, not next year's.
    const [chart] = await sql<{ season: number | null }[]>`
      SELECT MAX(season)::int AS season FROM depth_chart
      WHERE season <= ${game.season}
        AND team IN (${game.home_team}, ${game.away_team})
    `;

    // Starting lineups, one player per lineup slot.
    //
    // A slot is the unit of a starting lineup, not a position: three receivers
    // share pos_abb 'WR' and only their slot separates WR1 from WR3. DISTINCT
    // ON the slot takes whoever is highest on it and leaves every backup out.
    const starters = await sql`
      SELECT DISTINCT ON (d.team, d.unit, COALESCE(d.pos_slot::text, d.pos_abb))
             d.team, d.unit, d.pos_slot AS slot, d.pos_abb AS role,
             d.pos_name AS role_name, d.gsis_id, d.pos_rank, d.position,
             p.display_name, p.headshot_url,
             r.composite::float8 AS composite, r.position_rank
      FROM depth_chart d
      JOIN players p ON p.gsis_id = d.gsis_id
      LEFT JOIN rankings r ON r.gsis_id = d.gsis_id
      WHERE d.season = ${chart?.season ?? game.season}
        AND d.team IN (${game.home_team}, ${game.away_team})
      ORDER BY d.team, d.unit, COALESCE(d.pos_slot::text, d.pos_abb),
               d.pos_rank NULLS LAST, d.gsis_id
    `;

    starters.sort(
      (a, b) =>
        a.team.localeCompare(b.team) ||
        a.unit.localeCompare(b.unit) ||
        roleOrder(a.unit, a.role) - roleOrder(b.unit, b.role) ||
        (a.slot ?? 99) - (b.slot ?? 99),
    );

    res.json({ ...game, players, starters });
  }));

  /**
   * The product surface: the week now in play, plus the week just finished.
   *
   * Only one week of predictions is ever shown. The previous week is anchored
   * on kickoff dates rather than week numbers, so before week 1 of a new season
   * it correctly reaches back to the last game of the old one.
   */
  app.get('/this-week', route(async (_req: Request, res: Response) => {
    const [current, previous] = await Promise.all([currentWeek(), previousWeek()]);

    const load = async (period: { season: number; week: number } | null) => {
      if (!period) return null;
      const games = await sql`
        SELECT m.game_id, m.season, m.week, m.game_type, m.gameday::text AS gameday, m.gametime,
               m.home_team, m.away_team, m.home_coach, m.away_coach,
               m.mismatch_score, m.edge_score, m.edge_count,
               m.total_line, m.spread_line,
               m.top_edge_label, m.top_edge_value,
               m.shootout_score, m.shootout_applied, m.lean_team, m.lean_margin,
               m.game_shape,
               m.home_score, m.away_score, m.top10_hits, m.backfilled,
               m.locked, m.result_at
        FROM matchups m
        WHERE m.season = ${period.season} AND m.week = ${period.week}
        ORDER BY ARRAY_POSITION(${SHAPE_ORDER as unknown as string[]}::text[], m.game_shape),
                 m.shootout_score DESC NULLS LAST, m.game_id
      `;
      const [meta] = await sql<{ games: number; played: number; game_type: string }[]>`
        SELECT COUNT(*)::int AS games,
               SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END)::int AS played,
               MIN(game_type) AS game_type
        FROM games WHERE season = ${period.season} AND week = ${period.week}
      `;
      return {
        season: period.season,
        week: period.week,
        label: weekLabel(period.week, meta?.game_type ?? 'REG'),
        games,
        scheduled: meta?.games ?? 0,
        played: meta?.played ?? 0,
        /** True when nothing has kicked off, so every figure is a forecast. */
        upcoming: (meta?.played ?? 0) === 0,
        /** True when no prediction has been built for this week yet. */
        missing: games.length === 0,
      };
    };

    const [currentBlock, previousBlock] = await Promise.all([load(current), load(previous)]);
    res.json({ current: currentBlock, previous: previousBlock, shapeOrder: SHAPE_ORDER });
  }));

  /**
   * Which DraftKings slates have salaries imported for the current week.
   *
   * The app asks this before offering to build anything, because a lineup
   * without salaries is not a lineup — and the honest answer to "build me one"
   * on a week nobody has imported is a sentence telling you to import.
   */
  app.get('/slates', route(async (_req: Request, res: Response) => {
    // The strategies ride along with the slates because the app needs both to
    // draw the buttons, and one round trip is one fewer thing to get out of
    // sync when a strategy is added.
    const current = await currentWeek();
    if (!current) {
      res.json({ season: null, week: null, slates: [], strategies: STRATEGIES });
      return;
    }

    const slates = await sql<
      { contest: string; game_id: string | null; players: number; games: number; imported_at: string }[]
    >`
      SELECT contest,
             CASE WHEN COUNT(DISTINCT game_id) = 1 THEN MIN(game_id) ELSE NULL END AS game_id,
             COUNT(DISTINCT dk_id)::int AS players,
             COUNT(DISTINCT game_id)::int AS games,
             MAX(imported_at)::text AS imported_at
      FROM dk_salaries
      WHERE season = ${current.season} AND week = ${current.week}
        AND roster_position <> 'CPT'
      GROUP BY contest
      ORDER BY contest
    `;

    res.json({ season: current.season, week: current.week, slates, strategies: STRATEGIES });
  }));

  /**
   * The lineup itself: the point of the whole application.
   *
   * Computed per request rather than materialized, because it depends on locks
   * and excludes the user is still moving around, and because the search is
   * milliseconds once the pool is loaded.
   */
  app.get('/lineup', route(async (req: Request, res: Response) => {
    const current = await currentWeek();
    const season = req.query.season ? Number(req.query.season) : current?.season;
    const week = req.query.week ? Number(req.query.week) : current?.week;
    if (season == null || week == null) {
      res.status(400).json({ error: 'No current week, and no season/week given' });
      return;
    }

    const contest = req.query.contest === 'showdown' ? 'showdown' : 'classic';
    const list = (value: unknown): string[] =>
      typeof value === 'string' && value.length > 0 ? value.split(',') : [];

    const result = await buildLineup({
      season,
      week,
      contest,
      gameId: typeof req.query.gameId === 'string' ? req.query.gameId : undefined,
      stackGame: typeof req.query.stackGame === 'string' ? req.query.stackGame : undefined,
      locks: list(req.query.locks),
      excludes: list(req.query.excludes),
    });

    // The pool is large and the app only ever renders the lineup plus a short
    // list of near-misses, so the full pool stays on the server. A showdown
    // answer is three lineups, so a player seated in any of them is seated.
    const chosen = new Set(
      result.builds
        ? result.builds.flatMap((b) => b.lineup?.picks.map((p) => p.id) ?? [])
        : (result.lineup?.picks.map((p) => p.id) ?? []),
    );
    // Ranked by grade per dollar, which is the question the optimizer was
    // answering — these are the seats it nearly bought.
    const bench = result.players
      .filter((p) => !chosen.has(p.id))
      .sort((a, b) => b.value / Math.max(b.salary, 1) - a.value / Math.max(a.salary, 1))
      .slice(0, 12);

    res.json({
      season: result.season,
      week: result.week,
      contest: result.contest,
      strategy: result.strategy,
      stack: result.stack,
      baselineSeason: result.baselineSeason,
      poolSize: result.players.length,
      ungraded: result.ungraded,
      unavailable: result.unavailable,
      lineup: result.lineup,
      read: result.read,
      builds: result.builds,
      bench,
      problem: result.problem,
    });
  }));

  /**
   * One coaching staff's tendency fingerprint.
   *
   * Note on attribution: the schedule feed names only the head coach, so a
   * defensive profile here is the defense his team fielded, which is often
   * his coordinator's scheme rather than his own. The numbers describe the
   * unit accurately; the name on them is the head coach's.
   */
  app.get('/coaches/:name', route(async (req: Request, res: Response) => {
    const coach = req.params.name;
    const rows = await sql`
      SELECT side, metric, value::float8 AS value, n_plays, n_games, seasons
      FROM coach_tendencies WHERE coach = ${coach}
      ORDER BY side, metric
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: 'No tendency profile for that coach' });
      return;
    }

    const teams = await sql<{ team: string; season: number }[]>`
      SELECT DISTINCT team, season FROM (
        SELECT home_team AS team, season FROM games WHERE home_coach = ${coach}
        UNION ALL
        SELECT away_team, season FROM games WHERE away_coach = ${coach}
      ) x ORDER BY season DESC, team
    `;

    res.json({ coach, tendencies: rows, teams });
  }));

  /** Full scoring breakdown for one player, including every metric percentile. */
  app.get('/players/:id', route(async (req: Request, res: Response) => {
    const [row] = await sql`
      SELECT r.*, p.headshot_url, p.college, p.height_inches, p.weight_lbs,
             p.draft_year, p.draft_round, p.draft_pick, p.jersey_number
      FROM rankings r
      JOIN players p ON p.gsis_id = r.gsis_id
      WHERE r.gsis_id = ${req.params.id}
    `;
    if (!row) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const measurables = await sql`
      SELECT source, season, forty, bench, vertical, broad, cone, shuttle, school
      FROM measurables WHERE gsis_id = ${req.params.id}
      ORDER BY CASE source WHEN 'manual' THEN 0 WHEN 'combine' THEN 1 ELSE 2 END
    `;

    res.json({ ...row, measurables });
  }));

  app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app;
}
