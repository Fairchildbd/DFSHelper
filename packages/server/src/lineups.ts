
import {
  type ContestType,
  type DkPosition,
  type GameScriptRead,
  type Lineup,
  type ScriptEdge,
  type ShowdownBuild,
  type StrategyKey,
  type Tiered,
  UNAVAILABLE_STATUS,
  UNAVAILABLE_TIER,
  assignTiers,
  buildShowdownSet,
  matchupValue,
  optimizeClassic,
  readGameScript,
  stackCombinations,
  stackSize,
} from '@dfs/shared';
import { sql } from './db.ts';

export function baselineSeason(season: number, week: number): number {
  return week <= 1 ? season - 1 : season;
}

interface DefenseRates {
  takeaways: number;
  sacks: number;
  tds: number;
  games: number;
}

const FUMBLE_RECOVERY_RATE = 0.5;

async function loadDefenseRates(season: number): Promise<Map<string, DefenseRates>> {
  const rows = await sql<
    { team: string; games: number; sacks: number; ints: number; ff: number; tds: number }[]
  >`
    SELECT team,
           COUNT(DISTINCT week)::int AS games,
           COALESCE(SUM(def_sacks), 0)::float8 AS sacks,
           COALESCE(SUM(def_interceptions), 0)::float8 AS ints,
           COALESCE(SUM(def_fumbles_forced), 0)::float8 AS ff,
           COALESCE(SUM(def_tds), 0)::float8 AS tds
    FROM player_week_defense
    WHERE season = ${season} AND season_type = 'REG' AND team IS NOT NULL
    GROUP BY team
  `;

  const out = new Map<string, DefenseRates>();
  for (const r of rows) {
    const games = Math.max(r.games, 1);
    out.set(r.team, {
      takeaways: (r.ints + r.ff * FUMBLE_RECOVERY_RATE) / games,
      sacks: r.sacks / games,
      tds: r.tds / games,
      games: r.games,
    });
  }
  return out;
}

function gradeDefenses(rates: Map<string, DefenseRates>): Map<string, number> {
  const scored = [...rates.entries()].map(([team, r]) => ({
    team,
    raw: r.takeaways + r.tds * 2 + r.sacks * 0.15,
  }));
  scored.sort((a, b) => a.raw - b.raw);

  const out = new Map<string, number>();
  if (scored.length === 0) return out;
  scored.forEach((entry, index) => {
    out.set(entry.team, scored.length === 1 ? 50 : (index / (scored.length - 1)) * 100);
  });
  return out;
}

interface MatchupGrade {
  gsis_id: string;
  matchup_score: number;
  lane_edge: number | null;
  volume_score: number | null;
  pos_rank: number | null;
}

function poolNote(status: string | null, grade: MatchupGrade | undefined): string {
  if (!grade) return 'Not graded this week — salary filler only';

  const edge =
    grade.lane_edge == null
      ? ''
      : ` · unit edge ${grade.lane_edge > 0 ? '+' : ''}${grade.lane_edge.toFixed(0)}`;
  const volume = grade.volume_score == null ? '' : ` · volume ${grade.volume_score.toFixed(0)}`;

  return (
    (status === 'Q' ? 'Questionable · ' : '') +
    `matchup ${grade.matchup_score.toFixed(0)}` +
    edge +
    volume
  );
}

interface Usage {
  targetsPerGame: number;
  touchesPerGame: number;
}

async function loadUsage(season: number, gsisIds: string[]): Promise<Map<string, Usage>> {
  if (gsisIds.length === 0) return new Map();

  const rows = await sql<
    { gsis_id: string; games: number; targets: number; touches: number }[]
  >`
    -- A tier is a claim about role, and role is opportunity: targets for a
    -- receiver, carries plus receptions for a back. Dividing by weeks the
    -- player actually appeared keeps a starter who missed time from reading as
    -- a reserve, which is the mistake that seats a fullback.
    SELECT gsis_id,
           COUNT(DISTINCT week)::int AS games,
           COALESCE(SUM(targets), 0)::float8 AS targets,
           (COALESCE(SUM(carries), 0) + COALESCE(SUM(receptions), 0))::float8 AS touches
    FROM player_week_offense
    WHERE season = ${season} AND season_type = 'REG' AND gsis_id = ANY(${gsisIds})
    GROUP BY gsis_id
  `;

  return new Map(
    rows.map((r) => {
      const games = Math.max(r.games, 1);
      return [r.gsis_id, { targetsPerGame: r.targets / games, touchesPerGame: r.touches / games }];
    }),
  );
}

export interface PoolPlayer {
  id: string;
  gsisId: string | null;
  name: string;
  position: DkPosition;
  team: string;
  gameId: string;
  salary: number;
  matchupScore: number | null;
  value: number;
  laneEdge: number | null;
  posRank: number | null;
  targetsPerGame: number | null;
  touchesPerGame: number | null;
  status: string | null;
  note: string;
}

export interface PoolResult {
  season: number;
  week: number;
  contest: ContestType;
  strategy: StrategyKey;
  baselineSeason: number;
  players: Tiered<PoolPlayer>[];
  ungraded: number;
  unavailable: number;
}

export interface PoolOptions {
  season: number;
  week: number;
  contest: ContestType;
  gameId?: string;
}

export async function buildPool(opts: PoolOptions): Promise<PoolResult> {
  const { season, week, contest } = opts;
  const statsSeason = baselineSeason(season, week);
  const strategy: StrategyKey = 'mismatch';

  const salaries = await sql<
    {
      dk_id: string;
      name: string;
      position: string;
      team: string;
      opponent: string | null;
      game_id: string | null;
      salary: number;
      status: string | null;
      gsis_id: string | null;
    }[]
  >`
    SELECT dk_id, name, position, team, opponent, game_id, salary, status, gsis_id
    FROM dk_salaries
    WHERE season = ${season} AND week = ${week} AND contest = ${contest}
      -- Showdown exports carry the same player twice; the captain row is the
      -- flex price times 1.5, which the optimizer applies itself.
      AND roster_position <> 'CPT'
      ${opts.gameId ? sql`AND game_id = ${opts.gameId}` : sql``}
  `;

  if (salaries.length === 0) {
    return {
      season, week, contest, strategy,
      baselineSeason: statsSeason,
      players: [],
      ungraded: 0,
      unavailable: 0,
    };
  }

  const gsisIds = [...new Set(salaries.map((r) => r.gsis_id).filter((id) => id != null))];

  const [rates, graded, usage] = await Promise.all([
    loadDefenseRates(statsSeason),
    sql<MatchupGrade[]>`
      SELECT gsis_id,
             matchup_score::float8 AS matchup_score,
             lane_edge::float8 AS lane_edge,
             volume_score::float8 AS volume_score,
             pos_rank
      FROM player_matchups
      WHERE season = ${season} AND week = ${week}
    `,
    loadUsage(statsSeason, gsisIds),
  ]);

  const byGsis = new Map(graded.map((g) => [g.gsis_id, g]));
  const defenseGrade = gradeDefenses(rates);

  let ungraded = 0;
  let unavailable = 0;
  const players: PoolPlayer[] = [];

  for (const row of salaries) {
    const position = row.position.toUpperCase() as DkPosition;
    const sidelined = row.status != null && UNAVAILABLE_STATUS.has(row.status.toUpperCase());
    if (sidelined) unavailable++;

    if (position === 'DST') {
      const rate = rates.get(row.team) ?? null;
      const score = defenseGrade.get(row.team) ?? null;
      if (score == null) ungraded++;
      players.push({
        id: row.dk_id,
        gsisId: null,
        name: row.name,
        position,
        team: row.team,
        gameId: row.game_id ?? `${row.team}-unknown`,
        salary: row.salary,
        matchupScore: score,
        value: matchupValue(position, score),
        laneEdge: null,
        posRank: null,
        targetsPerGame: null,
        touchesPerGame: null,
        status: row.status,
        note: rate
          ? `${rate.takeaways.toFixed(1)} takeaways and ${rate.sacks.toFixed(1)} sacks a game in ${statsSeason}`
          : `No ${statsSeason} defensive history`,
      });
      continue;
    }

    const grade = row.gsis_id ? byGsis.get(row.gsis_id) : undefined;
    if (!grade && !sidelined) ungraded++;

    const played = row.gsis_id ? usage.get(row.gsis_id) : undefined;
    const score = grade?.matchup_score ?? null;
    players.push({
      id: row.dk_id,
      gsisId: row.gsis_id,
      name: row.name,
      position,
      team: row.team,
      gameId: row.game_id ?? `${row.team}-unknown`,
      salary: row.salary,
      matchupScore: score,
      value: matchupValue(position, score),
      laneEdge: grade?.lane_edge ?? null,
      posRank: grade?.pos_rank ?? null,
      targetsPerGame: played?.targetsPerGame ?? null,
      touchesPerGame: played?.touchesPerGame ?? null,
      status: row.status,
      note: sidelined ? `${row.status} — off the board this week` : poolNote(row.status, grade),
    });
  }

  return {
    season, week, contest, strategy,
    baselineSeason: statsSeason,
    players: assignTiers(players),
    ungraded,
    unavailable,
  };
}

export interface LineupResult extends PoolResult {
  lineup: Lineup | null;
  read: GameScriptRead | null;
  builds: ShowdownBuild[] | null;
  problem: string | null;
  stack: {
    gameId: string;
    label: string;
    mismatchScore: number | null;
    players: number;
  } | null;
}

const MAX_STACKS = 12;

async function showdownTeams(
  players: PoolPlayer[],
  gameId?: string,
): Promise<[string, string]> {
  const teams = [...new Set(players.map((p) => p.team))].sort();
  const id = gameId ?? players[0]?.gameId;
  if (id) {
    const [game] = await sql<{ away_team: string; home_team: string }[]>`
      SELECT away_team, home_team FROM games WHERE game_id = ${id}
    `;
    if (game && teams.includes(game.away_team) && teams.includes(game.home_team)) {
      return [game.away_team, game.home_team];
    }
  }
  return [teams[0] ?? '', teams[1] ?? ''];
}

function leaningTeam(
  read: GameScriptRead | null,
  teams: readonly [string, string],
): string | null {
  if (read == null) return null;
  if (read.team != null) return read.team;

  const [home, away] = read.lanes;
  if (home === away) return null;
  return home > away ? teams[0] : teams[1];
}

async function scriptRead(
  teams: readonly [string, string],
  gameId?: string,
): Promise<GameScriptRead | null> {
  if (!gameId) return null;
  const [row] = await sql<
    {
      total_line: number | null;
      detail: { edges: ScriptEdge[]; pacePercentile: number | null };
    }[]
  >`
    SELECT total_line::float8 AS total_line, detail FROM matchups WHERE game_id = ${gameId}
  `;
  if (!row?.detail?.edges) return null;
  return readGameScript({
    teams,
    edges: row.detail.edges,
    totalLine: row.total_line,
    pacePercentile: row.detail.pacePercentile,
  });
}

export async function buildLineup(
  opts: PoolOptions & { locks?: string[]; excludes?: string[]; stackGame?: string },
): Promise<LineupResult> {
  const pool = await buildPool(opts);
  const selectable = pool.players.filter((player) => player.tier !== UNAVAILABLE_TIER);

  if (pool.players.length === 0) {
    return {
      ...pool,
      lineup: null,
      read: null,
      builds: null,
      stack: null,
      problem: `No DraftKings salaries imported for ${opts.season} week ${opts.week} (${opts.contest}).`,
    };
  }

  if (opts.contest === 'showdown') {
    const teams = await showdownTeams(selectable, opts.gameId);
    const read = await scriptRead(teams, opts.gameId ?? selectable[0]?.gameId);
    const builds = buildShowdownSet(selectable, teams, {
      ...opts,
      leaning: leaningTeam(read, teams),
      offenseLanes: read ? { [teams[0]]: read.lanes[0], [teams[1]]: read.lanes[1] } : undefined,
    });
    const built = builds.filter((b) => b.lineup != null);
    return {
      ...pool,
      read,
      lineup: built[0]?.lineup ?? null,
      builds,
      stack: null,
      problem:
        built.length > 0
          ? null
          : 'No legal lineup fits under the cap from the imported pool.',
    };
  }

  const slateGames = [...new Set(selectable.map((p) => p.gameId))];
  const games = await sql<
    { game_id: string; home_team: string; away_team: string; mismatch_score: number | null }[]
  >`
    SELECT game_id, home_team, away_team, mismatch_score::float8 AS mismatch_score
    FROM matchups
    WHERE season = ${opts.season} AND week = ${opts.week}
      AND game_id = ANY(${slateGames})
    ORDER BY mismatch_score DESC NULLS LAST
  `;

  const target = opts.stackGame ? games.find((g) => g.game_id === opts.stackGame) : games[0];

  if (!target) {
    const lineup = optimizeClassic(selectable, opts);
    return {
      ...pool,
      lineup,
      read: null,
      builds: null,
      stack: null,
      problem: 'No graded game on this slate to stack, so every seat was bought on its own grade.',
    };
  }

  const stacks = stackCombinations(selectable, { gameId: target.game_id }).slice(0, MAX_STACKS);

  let best: Lineup | null = null;
  for (const stack of stacks) {
    const lineup = optimizeClassic(selectable, {
      locks: [...stack, ...(opts.locks ?? [])],
      excludes: opts.excludes,
    });
    if (lineup && (!best || lineup.value > best.value)) best = lineup;
  }

  const lineup = best ?? optimizeClassic(selectable, opts);

  return {
    ...pool,
    lineup,
    read: null,
    builds: null,
    stack: lineup
      ? {
          gameId: target.game_id,
          label: `${target.away_team} @ ${target.home_team}`,
          mismatchScore: target.mismatch_score,
          players: stackSize(lineup, target.game_id),
        }
      : null,
    problem: lineup
      ? best
        ? null
        : 'No stack fit under the cap — every seat was bought on its own grade instead.'
      : 'No legal lineup fits under the cap from the imported pool.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };

  const [slate] = await sql<{ season: number; week: number; contest: ContestType }[]>`
    SELECT season, week, contest FROM dk_salaries ORDER BY imported_at DESC LIMIT 1
  `;
  if (!slate) {
    console.error('No salaries imported yet. Run: npm run ingest:dk -- --file <DKSalaries.csv>');
    process.exit(1);
  }

  const result = await buildLineup({
    season: Number(flag('season') ?? slate.season),
    week: Number(flag('week') ?? slate.week),
    contest: (flag('contest') as ContestType) ?? slate.contest,
    gameId: flag('game'),
    stackGame: flag('stack'),
  });

  if (!result.lineup) {
    console.error(result.problem);
    process.exit(1);
  }

  console.log(
    `${result.contest} — ${result.season} week ${result.week}` +
      (result.stack ? ` · stacking ${result.stack.label} (${result.stack.players} players)` : ''),
  );

  const notes = new Map(result.players.map((p) => [p.id, p.note]));

  const show = (lineup: Lineup): void => {
    for (const pick of lineup.picks) {
      console.log(
        `  ${pick.slot.padEnd(5)} ${pick.name.slice(0, 22).padEnd(22)} ${pick.team.padEnd(4)} ` +
          `$${pick.cost.toString().padStart(5)}  grade ${(pick.matchupScore ?? 0).toFixed(0).padStart(3)}  ${notes.get(pick.id) ?? ''}`,
      );
    }
    console.log(
      `  salary $${lineup.salary} of 50000 (${lineup.remaining} left), ` +
        `average grade ${lineup.averageGrade.toFixed(1)}`,
    );
  };

  if (result.builds) {
    for (const build of result.builds) {
      console.log(`\n${build.label}`);
      if (build.lineup) show(build.lineup);
      else console.log(`  ${build.problem}`);
    }
  } else {
    show(result.lineup);
  }
  await sql.end();
}
