
import { clamp } from './stats.js';

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

export type ContestType = 'classic' | 'showdown';

export type DkPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'DST' | 'K';

export interface RosterSlot {
  key: string;
  label: string;
  eligible: DkPosition[];
}

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

export const SHOWDOWN_SLOTS: RosterSlot[] = [
  { key: 'CPT', label: 'CPT', eligible: ['QB', 'RB', 'WR', 'TE', 'DST', 'K'] },
  ...Array.from({ length: 5 }, (_, i) => ({
    key: `FLEX${i + 1}`,
    label: 'FLEX',
    eligible: ['QB', 'RB', 'WR', 'TE', 'DST', 'K'] as DkPosition[],
  })),
];

export const SALARY_CAP = 50000;

export const CAPTAIN_MULTIPLIER = 1.5;

export const MIN_CLASSIC_GAMES = 2;

export const MIN_SHOWDOWN_TEAMS = 2;

export interface LineupCandidate {
  id: string;
  name: string;
  position: DkPosition;
  team: string;
  gameId: string;
  salary: number;
  matchupScore: number | null;
  value: number;
}

export function candidateValue(c: LineupCandidate): number {
  return c.value;
}

export interface LineupPick extends LineupCandidate {
  slot: string;
  multiplier: number;
  weight: number;
  cost: number;
}

export interface Lineup {
  picks: LineupPick[];
  salary: number;
  value: number;
  averageGrade: number;
  remaining: number;
}

const BUCKET = 100;

interface Combo {
  salary: number;
  value: number;
  ids: string[];
}

const SPANS_TWO_GAMES = '*';
const NO_PLAYERS = '';

type GameSpread = string;
type Bucket = Map<GameSpread, Combo>;
type Table = Bucket[];

function spreadOfBoth(a: GameSpread, b: GameSpread): GameSpread {
  if (a === NO_PLAYERS) return b;
  if (b === NO_PLAYERS) return a;
  if (a === SPANS_TWO_GAMES || b === SPANS_TWO_GAMES) return SPANS_TWO_GAMES;
  return a === b ? a : SPANS_TWO_GAMES;
}

function emptyTable(): Table {
  return Array.from({ length: SALARY_CAP / BUCKET + 1 }, () => new Map<string, Combo>());
}

function place(table: Table, combo: Combo, key: string): void {
  if (combo.salary > SALARY_CAP) return;
  const bucket = table[Math.floor(combo.salary / BUCKET)]!;
  const existing = bucket.get(key);
  if (!existing || combo.value > existing.value) bucket.set(key, combo);
}

function combinationsTable(pool: LineupCandidate[], count: number): Table {
  const table = emptyTable();
  const chosen: LineupCandidate[] = [];

  const walk = (start: number, salary: number, value: number, key: string): void => {
    if (chosen.length === count) {
      place(table, { salary, value, ids: chosen.map((c) => c.id) }, key);
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const need = count - chosen.length;
      if (salary + pool[i]!.salary * need > SALARY_CAP) break;
      chosen.push(pool[i]!);
      walk(i + 1, salary + pool[i]!.salary, value + candidateValue(pool[i]!), spreadOfBoth(key, pool[i]!.gameId));
      chosen.pop();
    }
  };

  walk(0, 0, 0, NO_PLAYERS);
  return table;
}

function merge(a: Table, b: Table): Table {
  const out = emptyTable();
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.size === 0) continue;
    for (let j = 0; j < b.length - i; j++) {
      if (b[j]!.size === 0) continue;
      for (const [ka, left] of a[i]!) {
        for (const [kb, right] of b[j]!) {
          place(
            out,
            {
              salary: left.salary + right.salary,
              value: left.value + right.value,
              ids: [...left.ids, ...right.ids],
            },
            spreadOfBoth(ka, kb),
          );
        }
      }
    }
  }
  return out;
}

function bestLegalOf(table: Table): Combo | null {
  if (MIN_CLASSIC_GAMES !== 2) {
    throw new Error(
      'bestLegalOf reads the SPANS_TWO_GAMES spread, which only models MIN_CLASSIC_GAMES === 2',
    );
  }
  let best: Combo | null = null;
  for (const bucket of table) {
    const combo = bucket.get(SPANS_TWO_GAMES);
    if (combo && (!best || combo.value > best.value)) best = combo;
  }
  return best;
}

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

const FLEX_SHAPES: Array<Record<string, number>> = [
  { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 },
];

export interface OptimizeOptions {
  locks?: string[];
  excludes?: string[];
}

export function optimizeClassic(
  candidates: LineupCandidate[],
  options: OptimizeOptions = {},
): Lineup | null {
  const excluded = new Set(options.excludes ?? []);
  const locked = new Set(options.locks ?? []);
  const usable = candidates.filter((c) => !excluded.has(c.id) && c.salary > 0);

  const byPosition = (pos: DkPosition) => usable.filter((c) => c.position === pos);
  const byId = new Map(usable.map((c) => [c.id, c]));

  let best: { combo: Combo; shape: Record<string, number> } | null = null;

  for (const shape of FLEX_SHAPES) {
    let table: Table | null = null;

    for (const [pos, count] of Object.entries(shape)) {
      const pool = byPosition(pos as DkPosition);
      const lockedHere = pool.filter((c) => locked.has(c.id));
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
        const fixedKey = lockedHere.reduce((k, c) => spreadOfBoth(k, c.gameId), NO_PLAYERS);
        const shifted = emptyTable();
        for (const bucket of group) {
          for (const [key, combo] of bucket) {
            place(
              shifted,
              {
                salary: combo.salary + fixed.salary,
                value: combo.value + fixed.value,
                ids: [...combo.ids, ...fixed.ids],
              },
              spreadOfBoth(key, fixedKey),
            );
          }
        }
        table = table ? merge(table, shifted) : shifted;
      } else {
        table = table ? merge(table, group) : group;
      }
    }

    if (!table) continue;
    const combo = bestLegalOf(table);
    if (combo && (!best || combo.value > best.combo.value)) {
      best = { combo, shape };
    }
  }

  if (!best) return null;

  const picked = best.combo.ids.map((id) => byId.get(id)!).filter(Boolean);
  return assign(picked, CLASSIC_SLOTS);
}

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

export function gamesUsed(lineup: Lineup): number {
  return new Set(lineup.picks.map((p) => p.gameId)).size;
}

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

export type StrategyKey = 'mismatch';

export interface StrategyDefinition {
  key: StrategyKey;
  label: string;
  tagline: string;
  description: string;
}

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

const STACK_PARTNERS: DkPosition[] = ['WR', 'TE'];

const BRING_BACK: DkPosition[] = ['WR', 'TE', 'RB'];

export interface StackOptions {
  gameId: string;
  partners?: number;
  bringBacks?: number;
}

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

export function stackSize(lineup: Lineup, gameId: string): number {
  return lineup.picks.filter((p) => p.gameId === gameId).length;
}

export const POSITION_WEIGHT: Record<DkPosition, number> = {
  QB: 1,
  RB: 1,
  WR: 1,
  TE: 0.75,
  DST: 0.6,
  K: 0.4,
};

export const UNGRADED_SCORE = 35;

export const GRADE_EXPONENT = 1.5;

export function matchupValue(position: DkPosition, score: number | null): number {
  const grade = score ?? UNGRADED_SCORE;
  return (POSITION_WEIGHT[position] ?? 1) * (Math.max(grade, 1) / 50) ** GRADE_EXPONENT;
}
