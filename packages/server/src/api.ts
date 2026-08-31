
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
import {
  bearerToken,
  createSession,
  findUserById,
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  requireAuth,
  requireEntitlement,
  revokeSession,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
  type AuthUser,
} from './auth.ts';
import { sql } from './db.ts';
import { PURCHASE_URL, SHOW_EXTERNAL_PURCHASE_LINK } from './env.ts';
import { currentWeek, previousWeek } from './matchups.ts';
import { buildLineup } from './lineups.ts';
import { clearFailures, isThrottled, recordFailure } from './throttle.ts';

function weekLabel(week: number, gameType: string): string {
  switch (gameType) {
    case 'WC': return 'Wild Card';
    case 'DIV': return 'Divisional Round';
    case 'CON': return 'Conference Championships';
    case 'SB': return 'Super Bowl';
    default: return `Week ${week}`;
  }
}

const SHAPE_ORDER = ['shootout', 'one_sided', 'low_scoring', 'defensive'] as const;

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    handler(req, res).catch(next);
  };
}

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
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', route(async (_req: Request, res: Response) => {
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM rankings`;
    res.json({ ok: true, rankedPlayers: row?.count ?? 0 });
  }));

  function session(res: Response, user: AuthUser, token: string, expiresAt: Date) {
    res.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email, entitled: user.entitled },
    });
  }

  app.post('/auth/register', route(async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }
    if (!isValidPassword(password)) {
      res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
      return;
    }

    // ON CONFLICT DO NOTHING rather than a SELECT then an INSERT: the check and
    // the write are one statement, so two simultaneous signups for the same
    // address cannot both pass the check.
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${await hashPassword(password)})
      ON CONFLICT (email) DO NOTHING
      RETURNING id::text AS id
    `;
    if (!row) {
      res.status(409).json({ error: 'An account with that email already exists' });
      return;
    }

    const { token, expiresAt } = await createSession(row.id);
    const user = await findUserById(row.id);
    if (!user) {
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    session(res, user, token, expiresAt);
  }));

  app.post('/auth/login', route(async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const throttleKey = `${req.ip ?? 'unknown'}:${email}`;
    if (isThrottled(throttleKey)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const [row] = await sql<{ id: string; password_hash: string }[]>`
      SELECT id::text AS id, password_hash FROM users WHERE email = ${email}
    `;

    // One message and one code for both "no such account" and "wrong password".
    // Telling them apart is an account-existence oracle, which is how a list of
    // addresses gets confirmed against a service.
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!row || !ok) {
      recordFailure(throttleKey);
      res.status(401).json({ error: 'Email or password is incorrect' });
      return;
    }

    clearFailures(throttleKey);
    await sql`UPDATE users SET last_login_at = now() WHERE id = ${row.id}`;

    const { token, expiresAt } = await createSession(row.id);
    const user = await findUserById(row.id);
    if (!user) {
      res.status(500).json({ error: 'Internal error' });
      return;
    }
    session(res, user, token, expiresAt);
  }));

  app.post('/auth/logout', requireAuth, route(async (req: Request, res: Response) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);

    res.json({ ok: true });
  }));

  app.get('/auth/me', requireAuth, route(async (req: Request, res: Response) => {
    res.json({
      user: req.user,
      purchase: {
        showExternalLink: SHOW_EXTERNAL_PURCHASE_LINK,
        url: SHOW_EXTERNAL_PURCHASE_LINK ? PURCHASE_URL : null,
      },
    });
  }));

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

  app.get('/weeks', route(async (_req: Request, res: Response) => {
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
      upcoming: weeks.find((w) => w.week === current?.week)?.played === 0,
    });
  }));

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
      ORDER BY ARRAY_POSITION(${[...SHAPE_ORDER]}::text[], game_shape),
               shootout_score DESC NULLS LAST, game_id
    `;
    res.json({ games: rows, shapeOrder: SHAPE_ORDER });
  }));


  app.get('/matchups/:gameId', route(async (req: Request, res: Response) => {
    const gameId = req.params.gameId;

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

    const [chart] = await sql<{ season: number | null }[]>`
      SELECT MAX(season)::int AS season FROM depth_chart
      WHERE season <= ${game.season}
        AND team IN (${game.home_team}, ${game.away_team})
    `;

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
        ORDER BY ARRAY_POSITION(${[...SHAPE_ORDER]}::text[], m.game_shape),
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
        upcoming: (meta?.played ?? 0) === 0,
        missing: games.length === 0,
      };
    };

    const [currentBlock, previousBlock] = await Promise.all([load(current), load(previous)]);
    res.json({ current: currentBlock, previous: previousBlock, shapeOrder: SHAPE_ORDER });
  }));

  app.get('/slates', route(async (_req: Request, res: Response) => {
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

  // Reads are open so a guest can browse without an account. Lineup building
  // is the one thing that is not: today it needs a session, and turning
  // PAYWALL_ENABLED on is what makes requireEntitlement narrow that to payers.
  app.get('/lineup', requireAuth, requireEntitlement, route(async (req: Request, res: Response) => {
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

    const chosen = new Set(
      result.builds
        ? result.builds.flatMap((b) => b.lineup?.picks.map((p) => p.id) ?? [])
        : (result.lineup?.picks.map((p) => p.id) ?? []),
    );
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
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
