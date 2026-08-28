/**
 * Lineup construction, driven by the matchup model.
 *
 * The one thing this project knows that a salary file does not is which units
 * are mismatched this week. So that is what buys the seats: every roster spot
 * goes to the best matchup grade the remaining salary can afford, and the
 * salary cap is the only thing pushing back.
 *
 * There is deliberately no points projection in this path. Ranking players by
 * projected fantasy points is a restatement of DraftKings' own pricing — they
 * priced the projection in already — and an optimizer fed that number rebuilds
 * the field's lineup while ignoring the model underneath it.
 *
 * The search itself lives in `@dfs/shared` and is pure. This file is the part
 * that knows about the database.
 */

import {
  type ContestType,
  type DkPosition,
  type GameScriptRead,
  type Lineup,
  type ScriptEdge,
  type ShowdownBuild,
  type StrategyKey,
  buildShowdownSet,
  matchupValue,
  optimizeClassic,
  readGameScript,
  stackCombinations,
  stackSize,
} from '@dfs/shared';
import { sql } from './db.ts';

/**
 * Which season a defense's takeaway rate comes from.
 *
 * The same rule the rest of the app uses: in week 1 this season has no snaps in
 * it, so last year's is the only real evidence.
 */
export function baselineSeason(season: number, week: number): number {
  return week <= 1 ? season - 1 : season;
}

// ---------------------------------------------------------------------------
// Team defense
// ---------------------------------------------------------------------------

interface DefenseRates {
  takeaways: number;
  sacks: number;
  tds: number;
  games: number;
}

/**
 * Share of forced fumbles a defense recovers.
 *
 * The weekly feed carries fumbles forced but not fumbles recovered, and a loose
 * ball is close to a coin flip. Stated as a constant because it is an
 * assumption, not a measurement.
 */
const FUMBLE_RECOVERY_RATE = 0.5;

/**
 * Per-game takeaway rates by team.
 *
 * Interceptions and recovered fumbles, because those are what a cheap defense
 * can do to win a slate. Points allowed is the other half of DST scoring and it
 * is deliberately not here: it tops out at ten points, it is bought by paying up
 * for a good defense against a bad offense, and everybody buys it. A pick-six
 * is eight points and is available at any price.
 */
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

/**
 * A defense's takeaway profile, expressed as a matchup grade.
 *
 * Put on the same 0-100 scale as every skill player's grade so the optimizer is
 * comparing like with like when it decides whether an extra six hundred dollars
 * belongs in the defense or the flex. Ranked within the slate rather than scored
 * against an absolute, because "the best takeaway defense available today" is
 * the only question the lineup actually asks.
 */
function gradeDefenses(rates: Map<string, DefenseRates>): Map<string, number> {
  const scored = [...rates.entries()].map(([team, r]) => ({
    team,
    // Defensive touchdowns are takeaways that already paid off, and sacks are
    // the pressure that produces both, at a fraction of the weight.
    raw: r.takeaways + r.tds * 2 + r.sacks * 0.15,
  }));
  scored.sort((a, b) => a.raw - b.raw);

  const out = new Map<string, number>();
  if (scored.length === 0) return out;
  scored.forEach((entry, index) => {
    // Percentile within the league, which is what a matchup grade means
    // everywhere else in this codebase.
    out.set(entry.team, scored.length === 1 ? 50 : (index / (scored.length - 1)) * 100);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

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
  /** The lane edge behind the grade, for skill players the model graded. */
  laneEdge: number | null;
  /** DraftKings' injury flag; only 'Q' or null survives into the pool. */
  status: string | null;
  /** Why this player is worth a seat, in a sentence. */
  note: string;
}

export interface PoolResult {
  season: number;
  week: number;
  contest: ContestType;
  strategy: StrategyKey;
  /** Season the defensive takeaway rates came from. */
  baselineSeason: number;
  players: PoolPlayer[];
  /** Salaried players the model never graded — filler only. */
  ungraded: number;
  /** Priced players dropped from the pool as out or on injured reserve. */
  unavailable: number;
}

export interface PoolOptions {
  season: number;
  week: number;
  contest: ContestType;
  /** Showdown only: the single game the slate covers. */
  gameId?: string;
}

/**
 * DraftKings injury flags that take a player out of the pool entirely.
 *
 * 'OUT' and 'IR' are facts rather than probabilities, and a lineup containing
 * one scores zero at that slot. 'Q' stays in: questionable is the ordinary
 * state of half a roster by December, and it is surfaced on the pick instead,
 * because whether to trust a Saturday practice report is a judgement the person
 * entering the contest is better placed to make than this file is.
 */
const UNAVAILABLE = new Set(['OUT', 'IR', 'D', 'NA', 'SUSP']);

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

  const [rates, graded] = await Promise.all([
    loadDefenseRates(statsSeason),
    sql<
      {
        gsis_id: string;
        matchup_score: number;
        lane_edge: number | null;
        volume_score: number | null;
        pos_rank: number | null;
      }[]
    >`
      SELECT gsis_id,
             matchup_score::float8 AS matchup_score,
             lane_edge::float8 AS lane_edge,
             volume_score::float8 AS volume_score,
             pos_rank
      FROM player_matchups
      WHERE season = ${season} AND week = ${week}
    `,
  ]);

  const byGsis = new Map(graded.map((g) => [g.gsis_id, g]));
  const defenseGrade = gradeDefenses(rates);

  let ungraded = 0;
  let unavailable = 0;
  const players: PoolPlayer[] = [];

  for (const row of salaries) {
    const position = row.position.toUpperCase() as DkPosition;

    if (row.status && UNAVAILABLE.has(row.status)) {
      unavailable++;
      continue;
    }

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
        status: row.status,
        note: rate
          ? `${rate.takeaways.toFixed(1)} takeaways and ${rate.sacks.toFixed(1)} sacks a game in ${statsSeason}`
          : `No ${statsSeason} defensive history`,
      });
      continue;
    }

    const grade = row.gsis_id ? byGsis.get(row.gsis_id) : undefined;
    if (!grade) ungraded++;

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
      status: row.status,
      note:
        (row.status === 'Q' ? 'Questionable · ' : '') +
        (grade
          ? `matchup ${grade.matchup_score.toFixed(0)}` +
            (grade.lane_edge != null
              ? ` · unit edge ${grade.lane_edge > 0 ? '+' : ''}${grade.lane_edge.toFixed(0)}`
              : '') +
            (grade.volume_score != null ? ` · volume ${grade.volume_score.toFixed(0)}` : '')
          : 'Not graded this week — salary filler only'),
    });
  }

  return {
    season, week, contest, strategy,
    baselineSeason: statsSeason,
    players,
    ungraded,
    unavailable,
  };
}

// ---------------------------------------------------------------------------
// Lineup
// ---------------------------------------------------------------------------

export interface LineupResult extends PoolResult {
  lineup: Lineup | null;
  /**
   * Showdown only: the model's read on which way the game goes.
   *
   * Advisory, and null whenever the lanes are too thin to support one. The
   * entry a person actually plays is their call — this only says where the
   * model would start.
   */
  read: GameScriptRead | null;
  /**
   * Showdown only: the four scenario builds.
   *
   * A showdown answer is a set rather than a lineup. One entry is a bet on a
   * game script, and the three together are the only honest way to hold an
   * opinion about a single game — so the API hands back all three and lets the
   * screen show them side by side.
   */
  builds: ShowdownBuild[] | null;
  /** Set when the pool exists but no legal lineup could be built from it. */
  problem: string | null;
  /** The stacked game. */
  stack: {
    gameId: string;
    label: string;
    mismatchScore: number | null;
    /** How many of the roster spots came from that game. */
    players: number;
  } | null;
}

/**
 * How many stacks to try before settling.
 *
 * Each is a separate run of the optimizer with three players locked, so this is
 * the strategy's whole cost. Twelve covers both quarterbacks against their three
 * best pass catchers and two bring-backs each.
 */
const MAX_STACKS = 12;

/**
 * A note on what this objective actually optimizes for.
 *
 * Maximizing the *mean* matchup grade across nine seats is a floor-maximizing
 * move, not a ceiling-maximizing one. Sixty percent of a matchup grade is
 * composite and volume — "this player is good and gets the ball a lot" — and
 * only the lane edge describes an exploitable spot. So the lineup this produces
 * is consistent by construction, and consistency is the wrong shape for a
 * tournament where finishing above average pays nothing.
 *
 * That makes it a plausible **cash game / 50-50 build** rather than a
 * Millionaire Maker one, and it is being evaluated as both against real
 * contest results before the strategy is changed on a hunch.
 *
 * Two things deliberately not addressed yet:
 *
 *   Kickoff spread. The lineup concentrates in whichever window holds the best
 *   grades, which in week 1 meant eight of nine at 1:00. Left alone on purpose:
 *   week 1 has too many unknowns for a scheduling constraint to be anything but
 *   noise, and the case for spreading windows is really a weather case, which
 *   does not start mattering until late in the season.
 *
 *   Matchup quality itself. The tendency and defensive profiles are carrying
 *   last season's trends into a new one. The first three weeks are when this
 *   season's trends become legible, and that is the point at which the model
 *   underneath these grades is worth revisiting.
 */
/**
 * The two sides of a showdown, in the order the matchup reads.
 *
 * Away first, taken from the schedule rather than from the salary file, so the
 * builds are listed the way the game is written — `NE @ SEA`. Falls back to the
 * pool's own teams if the game is not on the schedule, which only happens if a
 * salary export arrives before the week does.
 */
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

/**
 * The model's read on the game, from the matchup row it already computed.
 *
 * Null rather than a guess whenever the game has no prediction built, which is
 * the ordinary state of a week nobody has run `db:matchups` for yet.
 */
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

/** Build the lineup for one slate. */
export async function buildLineup(
  opts: PoolOptions & { locks?: string[]; excludes?: string[]; stackGame?: string },
): Promise<LineupResult> {
  const pool = await buildPool(opts);

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

  // Showdown is one game, which is what makes it a set of three lineups rather
  // than one. See `@dfs/shared/showdown` for why: the seats in a single game
  // are correlated, so a lineup is a bet on a game script, and there are three
  // scripts worth holding — each offense having the day, and neither.
  if (opts.contest === 'showdown') {
    const teams = await showdownTeams(pool.players, opts.gameId);
    const [builds, read] = await Promise.all([
      Promise.resolve(buildShowdownSet(pool.players, teams, opts)),
      scriptRead(teams, opts.gameId ?? pool.players[0]?.gameId),
    ]);
    const built = builds.filter((b) => b.lineup != null);
    return {
      ...pool,
      read,
      // The first build that exists, so a caller that only understands one
      // lineup still gets a legal one rather than nothing.
      lineup: built[0]?.lineup ?? null,
      builds,
      stack: null,
      problem:
        built.length > 0
          ? null
          : 'No legal lineup fits under the cap from the imported pool.',
    };
  }

  // The game to stack: whichever one this week's model rates most lopsided,
  // unless the caller named one. A mismatch score is a statement about how
  // exploitable a game is, which is exactly the question "what should I stack".
  const slateGames = [...new Set(pool.players.map((p) => p.gameId))];
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
    const lineup = optimizeClassic(pool.players, opts);
    return {
      ...pool,
      lineup,
      read: null,
      builds: null,
      stack: null,
      problem: 'No graded game on this slate to stack, so every seat was bought on its own grade.',
    };
  }

  const stacks = stackCombinations(pool.players, { gameId: target.game_id }).slice(0, MAX_STACKS);

  let best: Lineup | null = null;
  for (const stack of stacks) {
    const lineup = optimizeClassic(pool.players, {
      locks: [...stack, ...(opts.locks ?? [])],
      excludes: opts.excludes,
    });
    if (lineup && (!best || lineup.value > best.value)) best = lineup;
  }

  // A stack that cannot be afforded is not a reason to hand back nothing.
  const lineup = best ?? optimizeClassic(pool.players, opts);

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

// ---------------------------------------------------------------------------

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

  const show = (lineup: Lineup): void => {
    for (const pick of lineup.picks) {
      console.log(
        `  ${pick.slot.padEnd(5)} ${pick.name.slice(0, 22).padEnd(22)} ${pick.team.padEnd(4)} ` +
          `$${pick.cost.toString().padStart(5)}  grade ${(pick.matchupScore ?? 0).toFixed(0).padStart(3)}  ${(pick as unknown as { note?: string }).note ?? ''}`,
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
