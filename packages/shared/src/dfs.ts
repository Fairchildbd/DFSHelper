/**
 * DraftKings contest rules, scoring, and lineup construction.
 *
 * Everything above this file answers "where is the mismatch". This file answers
 * the only question a DFS player actually acts on: which nine names go in the
 * box, given that the good ones cost money and the box has a budget.
 *
 * Pure like the rest of the shared layer. Salaries, projections and player
 * identity arrive as plain numbers from the server; nothing here reaches for a
 * database or knows a season exists.
 */

import { clamp } from './stats.js';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * A player's stat line, in the shape the weekly feed already carries.
 *
 * Every field optional and treated as zero when absent: a quarterback has no
 * receptions, and a projection built from partial data should score what it
 * knows rather than refuse.
 */
export interface StatLine {
  passing_yards?: number | null;
  passing_tds?: number | null;
  passing_interceptions?: number | null;
  rushing_yards?: number | null;
  rushing_tds?: number | null;
  receptions?: number | null;
  receiving_yards?: number | null;
  receiving_tds?: number | null;
  fumbles_lost?: number | null;
  special_teams_tds?: number | null;
  two_point_conversions?: number | null;
}

const n = (v: number | null | undefined): number => (v == null || !Number.isFinite(v) ? 0 : v);

/**
 * DraftKings NFL scoring, which is full-PPR *plus bonuses*.
 *
 * The bonuses are the part that separates DK from every other format and the
 * part a naive PPR projection gets wrong: three points for 100 rushing or
 * receiving yards, three for 300 passing. They are worth about as much as a
 * touchdown-and-a-half of receiving yardage and they land on exactly the
 * players a mismatch model likes — high-volume receivers in good spots — so
 * scoring them separately is not a rounding detail.
 */
export const DK_SCORING = {
  passYard: 0.04,
  passTd: 4,
  passInt: -1,
  pass300Bonus: 3,
  rushYard: 0.1,
  rushTd: 6,
  rush100Bonus: 3,
  reception: 1,
  recYard: 0.1,
  recTd: 6,
  rec100Bonus: 3,
  returnTd: 6,
  fumbleLost: -1,
  twoPoint: 2,
} as const;

/** DK points for one offensive stat line. */
export function dkPoints(line: StatLine): number {
  const passYards = n(line.passing_yards);
  const rushYards = n(line.rushing_yards);
  const recYards = n(line.receiving_yards);

  let points =
    passYards * DK_SCORING.passYard +
    n(line.passing_tds) * DK_SCORING.passTd +
    n(line.passing_interceptions) * DK_SCORING.passInt +
    rushYards * DK_SCORING.rushYard +
    n(line.rushing_tds) * DK_SCORING.rushTd +
    n(line.receptions) * DK_SCORING.reception +
    recYards * DK_SCORING.recYard +
    n(line.receiving_tds) * DK_SCORING.recTd +
    n(line.special_teams_tds) * DK_SCORING.returnTd +
    n(line.fumbles_lost) * DK_SCORING.fumbleLost +
    n(line.two_point_conversions) * DK_SCORING.twoPoint;

  if (passYards >= 300) points += DK_SCORING.pass300Bonus;
  if (rushYards >= 100) points += DK_SCORING.rush100Bonus;
  if (recYards >= 100) points += DK_SCORING.rec100Bonus;

  return points;
}

/** What a team defense did in one game. */
export interface DstLine {
  points_allowed?: number | null;
  sacks?: number | null;
  interceptions?: number | null;
  fumble_recoveries?: number | null;
  defensive_tds?: number | null;
  special_teams_tds?: number | null;
  safeties?: number | null;
  blocked_kicks?: number | null;
}

/**
 * Points-allowed tiers, the dominant term in any DST score.
 *
 * Listed high-to-low and read as "the first tier this game falls into", which
 * keeps the boundaries in one place. A shutout is worth ten points — more than
 * most starting tight ends score — which is why DST selection is a real
 * decision rather than a leftover slot to fill with whatever money remains.
 */
export const DST_POINTS_ALLOWED_TIERS: Array<{ max: number; points: number }> = [
  { max: 0, points: 10 },
  { max: 6, points: 7 },
  { max: 13, points: 4 },
  { max: 20, points: 1 },
  { max: 27, points: 0 },
  { max: 34, points: -1 },
  { max: Infinity, points: -4 },
];

export function dstPointsAllowedScore(pointsAllowed: number): number {
  const tier = DST_POINTS_ALLOWED_TIERS.find((t) => pointsAllowed <= t.max);
  return tier ? tier.points : -4;
}

/**
 * DK points for a team defense.
 *
 * Points allowed is a step function, so a projection that feeds it an average
 * — 21.4 points allowed — lands on a tier boundary and systematically
 * understates the upside. The server projects the tiers probabilistically and
 * uses this for scoring games that actually happened.
 */
export function dstPoints(line: DstLine): number {
  return (
    dstPointsAllowedScore(n(line.points_allowed)) +
    n(line.sacks) * 1 +
    n(line.interceptions) * 2 +
    n(line.fumble_recoveries) * 2 +
    n(line.defensive_tds) * 6 +
    n(line.special_teams_tds) * 6 +
    n(line.safeties) * 2 +
    n(line.blocked_kicks) * 2
  );
}

// ---------------------------------------------------------------------------
// Contests
// ---------------------------------------------------------------------------

export type ContestType = 'classic' | 'showdown';

/** Positions DraftKings recognises. DST is a team, not a player. */
export type DkPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'DST' | 'K';

export interface RosterSlot {
  key: string;
  label: string;
  /** Positions that may fill it. */
  eligible: DkPosition[];
}

/**
 * The Sunday Million / Millionaire Maker roster.
 *
 * Nine slots, one flex, and a salary cap that is the whole game: the flex is
 * where a lineup is actually built, because it is the only slot whose position
 * is a decision rather than a requirement.
 */
export const CLASSIC_SLOTS: RosterSlot[] = [
  { key: 'QB', label: 'QB', eligible: ['QB'] },
  { key: 'RB1', label: 'RB', eligible: ['RB'] },
  { key: 'RB2', label: 'RB', eligible: ['RB'] },
  { key: 'WR1', label: 'WR', eligible: ['WR'] },
  { key: 'WR2', label: 'WR', eligible: ['WR'] },
  { key: 'WR3', label: 'WR', eligible: ['WR'] },
  { key: 'TE', label: 'TE', eligible: ['TE'] },
  { key: 'FLEX', label: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
  { key: 'DST', label: 'DST', eligible: ['DST'] },
];

/** Showdown Captain Mode: one captain at 1.5x, five flex, one game. */
export const SHOWDOWN_SLOTS: RosterSlot[] = [
  { key: 'CPT', label: 'CPT', eligible: ['QB', 'RB', 'WR', 'TE', 'DST', 'K'] },
  ...Array.from({ length: 5 }, (_, i) => ({
    key: `FLEX${i + 1}`,
    label: 'FLEX',
    eligible: ['QB', 'RB', 'WR', 'TE', 'DST', 'K'] as DkPosition[],
  })),
];

/** Every DraftKings contest is capped at fifty thousand. */
export const SALARY_CAP = 50000;

/** The captain slot costs half again as much and scores half again as much. */
export const CAPTAIN_MULTIPLIER = 1.5;

/**
 * Classic lineups must span at least two games.
 *
 * DraftKings enforces this to stop a lineup being a bet on one game script.
 * It almost never binds — nine players across the position requirements rarely
 * come from one game — but "almost never" is not a rule, and a lineup the site
 * rejects is worse than a slightly weaker one it accepts.
 */
export const MIN_CLASSIC_GAMES = 2;

/** Showdown lineups must include a player from each side. Same reasoning. */
export const MIN_SHOWDOWN_TEAMS = 2;

// ---------------------------------------------------------------------------
// Optimizer
// ---------------------------------------------------------------------------

export interface LineupCandidate {
  id: string;
  name: string;
  position: DkPosition;
  team: string;
  /** The game this player's team is in, for the multi-game rule. */
  gameId: string;
  salary: number;
  /** The matchup grade this seat is being bought for, 0-100. Null if ungraded. */
  matchupScore: number | null;
  /** What the search maximizes: `matchupValue` of the grade above. */
  value: number;
}

/** The number the search maximizes for one candidate. */
export function candidateValue(c: LineupCandidate): number {
  return c.value;
}

export interface LineupPick extends LineupCandidate {
  slot: string;
  /** 1.5 for a showdown captain, 1 otherwise. */
  multiplier: number;
  /** Seat value after the multiplier. */
  weight: number;
  /** Salary after the multiplier. */
  cost: number;
}

export interface Lineup {
  picks: LineupPick[];
  salary: number;
  /** Sum of seat values. Comparable between lineups, not to a points total. */
  value: number;
  /** Mean matchup grade across the nine seats, which is the headline number. */
  averageGrade: number;
  /** Cap minus salary. Money left unspent is matchup edge left unbought. */
  remaining: number;
}

/** Salaries are always multiples of 100, so the cap is 500 buckets wide. */
const BUCKET = 100;

interface Combo {
  salary: number;
  /** Objective total — what `place` compares. */
  value: number;
  ids: string[];
}

/**
 * Best combination found at each salary level, indexed by hundred-dollar bucket.
 *
 * Every step of the search compresses to this shape, which is what keeps an
 * exhaustive optimizer tractable: two hundred thousand WR quartets collapse to
 * at most five hundred entries, one per price point, and everything downstream
 * only ever sees the survivors.
 */
type Table = Array<Combo | null>;

function emptyTable(): Table {
  return new Array<Combo | null>(SALARY_CAP / BUCKET + 1).fill(null);
}

function place(table: Table, combo: Combo): void {
  if (combo.salary > SALARY_CAP) return;
  const bucket = Math.floor(combo.salary / BUCKET);
  const existing = table[bucket];
  if (!existing || combo.value > existing.value) table[bucket] = combo;
}

/** Every way to pick `count` players from `pool`, compressed by price. */
function combinationsTable(pool: LineupCandidate[], count: number): Table {
  const table = emptyTable();
  const chosen: LineupCandidate[] = [];

  const walk = (start: number, salary: number, value: number): void => {
    if (chosen.length === count) {
      place(table, { salary, value, ids: chosen.map((c) => c.id) });
      return;
    }
    for (let i = start; i < pool.length; i++) {
      // Cannot finish the group within the cap from here, and the pool is
      // sorted by salary ascending, so nothing later can either.
      const need = count - chosen.length;
      if (salary + pool[i]!.salary * need > SALARY_CAP) break;
      chosen.push(pool[i]!);
      walk(i + 1, salary + pool[i]!.salary, value + candidateValue(pool[i]!));
      chosen.pop();
    }
  };

  walk(0, 0, 0);
  return table;
}

/** Merge two independent groups, keeping the best lineup at each price. */
function merge(a: Table, b: Table): Table {
  const out = emptyTable();
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    if (!left) continue;
    for (let j = 0; j < b.length - i; j++) {
      const right = b[j];
      if (!right) continue;
      place(out, {
        salary: left.salary + right.salary,
        value: left.value + right.value,
        ids: [...left.ids, ...right.ids],
      });
    }
  }
  return out;
}

function bestOf(table: Table): Combo | null {
  let best: Combo | null = null;
  for (const combo of table) {
    if (combo && (!best || combo.value > best.value)) best = combo;
  }
  return best;
}

/**
 * How many players per position survive to the search.
 *
 * Pruning is what makes this exact-in-practice rather than merely fast: the
 * pool is cut by projection *and* by projection per dollar, because a cheap
 * player who is nobody's best play can still be the only way to afford the
 * three who are. Cutting on projection alone produces lineups that cannot fit
 * under the cap and then blames the cap.
 */
export const POOL_LIMITS: Record<string, number> = {
  QB: 14,
  RB: 26,
  WR: 32,
  TE: 14,
  DST: 12,
};

function prune(pool: LineupCandidate[], limit: number): LineupCandidate[] {
  if (pool.length <= limit) return [...pool].sort((a, b) => a.salary - b.salary);

  const byPoints = [...pool].sort((a, b) => candidateValue(b) - candidateValue(a));
  const byValue = [...pool].sort(
    (a, b) =>
      candidateValue(b) / Math.max(b.salary, 1) - candidateValue(a) / Math.max(a.salary, 1),
  );

  const keep = new Map<string, LineupCandidate>();
  const half = Math.ceil(limit / 2);
  for (const c of byPoints.slice(0, half)) keep.set(c.id, c);
  for (const c of byValue) {
    if (keep.size >= limit) break;
    keep.set(c.id, c);
  }

  return [...keep.values()].sort((a, b) => a.salary - b.salary);
}

/**
 * The three shapes a classic lineup can take.
 *
 * The flex is not searched as a slot. It is searched as three separate rosters
 * — an extra back, an extra receiver, an extra tight end — because that turns
 * one problem with an overlapping pool into three problems with disjoint pools,
 * and disjoint pools are what let each position be enumerated independently
 * without ever picking the same player twice.
 */
const FLEX_SHAPES: Array<Record<string, number>> = [
  { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 },
];

export interface OptimizeOptions {
  /** Players who must appear. Used by the multi-game repair pass. */
  locks?: string[];
  /** Players to leave out entirely — injured, or already used in another entry. */
  excludes?: string[];
}

/**
 * Build the highest-projecting legal classic lineup.
 *
 * Returns null when the pool cannot fill the roster under the cap, which is a
 * real state early in a week: a slate whose salaries have not been imported has
 * no pool at all, and saying so beats returning eight players and a hole.
 */
export function optimizeClassic(
  candidates: LineupCandidate[],
  options: OptimizeOptions = {},
): Lineup | null {
  const excluded = new Set(options.excludes ?? []);
  const locked = new Set(options.locks ?? []);
  const usable = candidates.filter((c) => !excluded.has(c.id) && c.salary > 0);

  const byPosition = (pos: DkPosition) => usable.filter((c) => c.position === pos);

  let best: { combo: Combo; shape: Record<string, number> } | null = null;

  for (const shape of FLEX_SHAPES) {
    let table: Table | null = null;

    for (const [pos, count] of Object.entries(shape)) {
      const pool = byPosition(pos as DkPosition);
      const lockedHere = pool.filter((c) => locked.has(c.id));
      // A locked player is not a candidate, he is a fixed cost: he takes one of
      // the slots and the rest of the group is chosen around him.
      const free = prune(
        pool.filter((c) => !locked.has(c.id)),
        POOL_LIMITS[pos] ?? 20,
      );
      const remaining = count - lockedHere.length;
      if (remaining < 0) { table = null; break; }

      const group = combinationsTable(free, remaining);
      if (lockedHere.length > 0) {
        const fixed: Combo = {
          salary: lockedHere.reduce((acc, c) => acc + c.salary, 0),
          value: lockedHere.reduce((acc, c) => acc + candidateValue(c), 0),
          ids: lockedHere.map((c) => c.id),
        };
        const shifted = emptyTable();
        for (const combo of group) {
          if (!combo) continue;
          place(shifted, {
            salary: combo.salary + fixed.salary,
            value: combo.value + fixed.value,
            ids: [...combo.ids, ...fixed.ids],
          });
        }
        table = table ? merge(table, shifted) : shifted;
      } else {
        table = table ? merge(table, group) : group;
      }
    }

    if (!table) continue;
    const combo = bestOf(table);
    if (combo && (!best || combo.value > best.combo.value)) {
      best = { combo, shape };
    }
  }

  if (!best) return null;

  const byId = new Map(usable.map((c) => [c.id, c]));
  const picked = best.combo.ids.map((id) => byId.get(id)!).filter(Boolean);
  return assign(picked, CLASSIC_SLOTS);
}

/**
 * Seat a set of players in roster slots.
 *
 * The optimizer works in position counts, which say nothing about which back is
 * RB1 and which is the flex. Filling the tightest slots first — the ones with
 * one eligible position — leaves the flex to whoever is left, which is exactly
 * what the flex is for.
 */
function assign(players: LineupCandidate[], slots: RosterSlot[]): Lineup | null {
  const remaining = [...players];
  const picks: LineupPick[] = [];
  const ordered = [...slots].sort((a, b) => a.eligible.length - b.eligible.length);

  for (const slot of ordered) {
    const index = remaining.findIndex((p) => slot.eligible.includes(p.position));
    if (index === -1) return null;
    const [player] = remaining.splice(index, 1);
    picks.push({
      ...player!,
      slot: slot.key,
      multiplier: 1,
      weight: player!.value,
      cost: player!.salary,
    });
  }

  if (remaining.length > 0) return null;

  const order = new Map(slots.map((s, i) => [s.key, i]));
  picks.sort((a, b) => (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));

  return summarizeLineup(picks);
}

/** Totals every lineup reports, computed one way so they cannot disagree. */
/** Roster into lineup: what it cost, what it is worth, what it grades. */
export function summarizeLineup(picks: LineupPick[]): Lineup {
  const salary = picks.reduce((acc, p) => acc + p.cost, 0);
  const graded = picks.filter((p) => p.matchupScore != null);
  return {
    picks,
    salary,
    value: picks.reduce((acc, p) => acc + p.weight, 0),
    averageGrade:
      graded.length === 0
        ? 0
        : graded.reduce((acc, p) => acc + (p.matchupScore ?? 0) * p.multiplier, 0) /
          graded.reduce((acc, p) => acc + p.multiplier, 0),
    remaining: SALARY_CAP - salary,
  };
}

/** How many distinct games a lineup draws from. */
export function gamesUsed(lineup: Lineup): number {
  return new Set(lineup.picks.map((p) => p.gameId)).size;
}

/**
 * Showdown Captain Mode, for one game.
 *
 * Searched as a captain choice crossed with a five-man knapsack rather than as
 * six free slots, because the captain is the whole decision: he costs 1.5x and
 * scores 1.5x, so he is worth locking to the player whose *projection* is most
 * worth multiplying, not the one with the best price. Enumerating captains
 * outright is cheap — a showdown pool is one game, forty players at most.
 */
export function optimizeShowdown(
  candidates: LineupCandidate[],
  options: OptimizeOptions = {},
): Lineup | null {
  const excluded = new Set(options.excludes ?? []);
  const pool = candidates.filter((c) => !excluded.has(c.id) && c.salary > 0);
  if (pool.length < SHOWDOWN_SLOTS.length) return null;

  let best: { captain: LineupCandidate; flex: LineupCandidate[]; value: number } | null = null;

  for (const captain of pool) {
    const captainCost = Math.round(captain.salary * CAPTAIN_MULTIPLIER);
    if (captainCost > SALARY_CAP) continue;
    const rest = pool.filter((c) => c.id !== captain.id);

    const flex = bestFlex(rest, 5, SALARY_CAP - captainCost);
    if (!flex) continue;

    // Both teams must be represented, and the captain counts toward that.
    const teams = new Set([captain.team, ...flex.map((f) => f.team)]);
    if (teams.size < MIN_SHOWDOWN_TEAMS) continue;

    const value =
      candidateValue(captain) * CAPTAIN_MULTIPLIER +
      flex.reduce((acc, f) => acc + candidateValue(f), 0);
    if (!best || value > best.value) best = { captain, flex, value };
  }

  if (!best) return null;

  const picks: LineupPick[] = [
    {
      ...best.captain,
      slot: 'CPT',
      multiplier: CAPTAIN_MULTIPLIER,
      weight: best.captain.value * CAPTAIN_MULTIPLIER,
      cost: Math.round(best.captain.salary * CAPTAIN_MULTIPLIER),
    },
    ...best.flex.map((f, i) => ({
      ...f,
      slot: `FLEX${i + 1}`,
      multiplier: 1,
      weight: f.value,
      cost: f.salary,
    })),
  ];

  return summarizeLineup(picks);
}

/**
 * Best `count` players within `budget`, by dynamic programming over price.
 *
 * Exact, and linear in the pool rather than combinatorial: the state is how
 * many players are seated and what has been spent, which is all that matters
 * about a partial showdown lineup.
 *
 * Each state carries its own roster rather than a back-pointer. Back-pointers
 * are the usual trick and they are wrong here: a predecessor state can be
 * improved by a later player after a pointer into it was written, so walking
 * the pointers can rebuild a roster worth less than the value the table claims.
 * Six slots against five hundred price points is three thousand states, so
 * carrying the rosters costs nothing worth the risk of reporting a projection
 * the lineup does not actually have.
 */
function bestFlex(
  pool: LineupCandidate[],
  count: number,
  budget: number,
): LineupCandidate[] | null {
  if (budget < 0) return null;
  const size = Math.floor(budget / BUCKET) + 1;

  type State = { value: number; picks: LineupCandidate[] } | null;
  const dp: State[][] = Array.from({ length: count + 1 }, () =>
    new Array<State>(size).fill(null),
  );
  dp[0]![0] = { value: 0, picks: [] };

  for (const player of pool) {
    const cost = Math.floor(player.salary / BUCKET);
    if (cost >= size) continue;
    // Descending in both dimensions so each player is seated at most once.
    for (let k = count - 1; k >= 0; k--) {
      for (let b = size - 1 - cost; b >= 0; b--) {
        const base = dp[k]![b];
        if (!base) continue;
        const value = base.value + candidateValue(player);
        const target = dp[k + 1]![b + cost];
        if (!target || value > target.value) {
          dp[k + 1]![b + cost] = { value, picks: [...base.picks, player] };
        }
      }
    }
  }

  let best: State = null;
  for (const state of dp[count]!) {
    if (state && (!best || state.value > best.value)) best = state;
  }
  return best ? best.picks : null;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export type StrategyKey = 'mismatch';

export interface StrategyDefinition {
  key: StrategyKey;
  label: string;
  /** One line under the button. */
  tagline: string;
  description: string;
}

/**
 * How a lineup gets built.
 *
 * One strategy, because there is only one thing this app knows that a salary
 * file does not: which units are mismatched this week. Ranking players by
 * projected points is what every optimizer on the internet already does, it is
 * a restatement of DraftKings' own pricing, and it produced lineups that
 * ignored the model underneath them. The matchup grade drives every seat.
 */
export const STRATEGIES: StrategyDefinition[] = [
  {
    key: 'mismatch',
    label: 'Build from the mismatches',
    tagline: 'Stack the best game, fill on matchup edge, hunt takeaways',
    description:
      'Starts from the game the model rates most lopsided and stacks it — the quarterback, ' +
      'a pass catcher he throws to, and a player from the other side to bring the game back. ' +
      'Every other seat goes to the best matchup grade the salary allows, and the defense is ' +
      'bought on takeaway rate rather than on points allowed.',
  },
];

/** Positions that can be stacked with a quarterback. */
const STACK_PARTNERS: DkPosition[] = ['WR', 'TE'];

/** Positions worth bringing back from the other side of a stacked game. */
const BRING_BACK: DkPosition[] = ['WR', 'TE', 'RB'];

export interface StackOptions {
  /** The game to stack. */
  gameId: string;
  /** Pass catchers per quarterback to try. */
  partners?: number;
  /** Opposing players to try as the bring-back. */
  bringBacks?: number;
}

/**
 * Every stack worth trying in one game, best first.
 *
 * A stack is three players: the quarterback, someone he throws to, and someone
 * on the other team. The first two are the correlation — a quarterback's
 * touchdown is his receiver's touchdown, so owning both doubles the payoff of
 * being right about the game. The third is the insurance: the games that go
 * over their total go over because *both* offenses moved, and a lineup holding
 * only one side of a shootout leaves half of it on the table.
 *
 * Returned as id triples rather than lineups because each one is then handed to
 * the optimizer as locks, which fills the other six slots around it.
 */
export function stackCombinations(
  candidates: LineupCandidate[],
  options: StackOptions,
): string[][] {
  const inGame = candidates.filter((c) => c.gameId === options.gameId);
  const quarterbacks = inGame
    .filter((c) => c.position === 'QB')
    .sort((a, b) => candidateValue(b) - candidateValue(a));

  const partnerCount = options.partners ?? 3;
  const bringBackCount = options.bringBacks ?? 3;
  const stacks: Array<{ ids: string[]; value: number }> = [];

  for (const qb of quarterbacks) {
    const partners = inGame
      .filter((c) => c.team === qb.team && STACK_PARTNERS.includes(c.position))
      .sort((a, b) => candidateValue(b) - candidateValue(a))
      .slice(0, partnerCount);

    const opponents = inGame
      .filter((c) => c.team !== qb.team && BRING_BACK.includes(c.position))
      .sort((a, b) => candidateValue(b) - candidateValue(a))
      .slice(0, bringBackCount);

    for (const partner of partners) {
      for (const opponent of opponents) {
        stacks.push({
          ids: [qb.id, partner.id, opponent.id],
          value: candidateValue(qb) + candidateValue(partner) + candidateValue(opponent),
        });
      }
    }
  }

  return stacks.sort((a, b) => b.value - a.value).map((s) => s.ids);
}

/** Players in a lineup who came from the stacked game. */
export function stackSize(lineup: Lineup, gameId: string): number {
  return lineup.picks.filter((p) => p.gameId === gameId).length;
}

// ---------------------------------------------------------------------------
// What a seat is worth
// ---------------------------------------------------------------------------

/**
 * How much a matchup grade is worth at each position.
 *
 * Not a points projection — a correction for the fact that the same grade buys
 * different scoring at different positions. A tight end graded 80 and a
 * receiver graded 80 are both in excellent spots, but the receiver's spot is
 * worth more fantasy points, and without this the flex fills with tight ends.
 */
export const POSITION_WEIGHT: Record<DkPosition, number> = {
  QB: 1,
  RB: 1,
  WR: 1,
  TE: 0.75,
  DST: 0.6,
  K: 0.4,
};

/**
 * Matchup grade below which a player is treated as filler.
 *
 * A player the model never graded — a fourth receiver, a name the roster could
 * not be matched to — is not average, he is unknown, and an optimizer that
 * treats unknown as average will fill a lineup with unknowns because they are
 * cheap. Scored below average on purpose, so he only gets a seat when the
 * salary genuinely has nowhere better to go.
 */
export const UNGRADED_SCORE = 35;

/**
 * Curve applied to a matchup grade before it is spent against salary.
 *
 * Convex, so the distance from 50 to 80 counts for more than the distance from
 * 20 to 50. A lineup is nine seats and the slate has hundreds of players in
 * ordinary spots; what wins a tournament is concentrating the cap in the few
 * genuinely lopsided ones rather than buying a roster of slightly-above-average
 * grades.
 */
export const GRADE_EXPONENT = 1.5;

/** What one seat is worth: the matchup grade, curved and position-weighted. */
export function matchupValue(position: DkPosition, score: number | null): number {
  const grade = score ?? UNGRADED_SCORE;
  return (POSITION_WEIGHT[position] ?? 1) * (Math.max(grade, 1) / 50) ** GRADE_EXPONENT;
}
