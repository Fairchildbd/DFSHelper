
import {
  CAPTAIN_MULTIPLIER,
  type DkPosition,
  type Lineup,
  type LineupCandidate,
  type LineupPick,
  type OptimizeOptions,
  SALARY_CAP,
  summarizeLineup,
} from './dfs.js';
import { NEUTRAL_TOTAL, TOTAL_RANGE } from './matchups.js';

const BUCKET = 50;

const SEATS = 6;

export const SHOWDOWN_MAX_WR = 2;

export const SHOWDOWN_BRINGBACK_WR = 1;

export const LOW_SCORING_MAX_PER_TEAM = 3;

export const SHOOTOUT_MAX_PER_TEAM = 4;


export interface ShowdownRules {
  captainTeam?: string | null;
  captainPositions?: DkPosition[];
  requireQbTeams?: string[];
  bar?: DkPosition[];
  requireOneOf?: DkPosition[];
  maxPerTeam?: number;
  wrCapByTeam?: Record<string, number>;
}

export interface ShowdownShape {
  key: string;
  label: string;
  description: string;
  team: string | null;
  rules: ShowdownRules;
}

export function showdownShapes(teams: readonly [string, string]): ShowdownShape[] {
  const lean = (team: string, other: string): ShowdownShape => ({
    key: `lean-${team}`,
    label: `If ${team} has a good game`,
    description:
      `Betting on the ${team} offense: their quarterback, up to two of his receivers, ` +
      `and whatever else the salary buys — a back, a tight end, both. At least one ` +
      `${other} player brings the game back. No kicker and no defense: those seats pay ` +
      `when drives stall, which is the opposite of what this build needs.`,
    team,
    rules: {
      captainTeam: team,
      requireQbTeams: [team],
      bar: ['K', 'DST'],
      wrCapByTeam: { [other]: SHOWDOWN_BRINGBACK_WR },
    },
  });

  return [
    lean(teams[0], teams[1]),
    lean(teams[1], teams[0]),
    {
      key: 'shootout',
      label: 'If it is a shootout',
      description:
        'Both offenses producing rather than one, so both quarterbacks are rostered and ' +
        'the receivers around them are the ones their own quarterback throws to. No kicker ' +
        `and no defense, and no more than ${SHOOTOUT_MAX_PER_TEAM} from either side — a ` +
        'shootout that is really a bet on one team is already the entry above.',
      team: null,
      rules: {
        requireQbTeams: [teams[0], teams[1]],
        bar: ['K', 'DST'],
        maxPerTeam: SHOOTOUT_MAX_PER_TEAM,
      },
    },
    {
      key: 'low-scoring',
      label: 'If it stays low-scoring',
      description:
        'The entry for a game that never gets going. No quarterback, no more than ' +
        `${LOW_SCORING_MAX_PER_TEAM} from either side, and at least one of the kicker or a ` +
        'defense — the two seats that only pay when drives stall. The captain is a back, a ' +
        'tight end, the kicker or a defense, never a receiver: a receiver captain needs the ' +
        'passing day this build is the hedge against. This is what makes the kicker a ' +
        'structure rather than a guess.',
      team: null,
      rules: {
        bar: ['QB'],
        captainPositions: ['RB', 'TE', 'K', 'DST'],
        requireOneOf: ['K', 'DST'],
        maxPerTeam: LOW_SCORING_MAX_PER_TEAM,
      },
    },
  ];
}

function undominated(
  pool: LineupCandidate[],
  limitFor: (player: LineupCandidate) => number,
): LineupCandidate[] {
  const groups = new Map<string, LineupCandidate[]>();
  for (const p of pool) {
    const key = `${p.team}|${p.position}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }

  const kept: LineupCandidate[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) => a.salary - b.salary || b.value - a.value || a.id.localeCompare(b.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      const player = sorted[i]!;
      let dominators = 0;
      for (let j = 0; j < i; j++) {
        if (sorted[j]!.value >= player.value) dominators++;
      }
      if (dominators < limitFor(player)) kept.push(player);
    }
  }
  return kept.sort((a, b) => a.id.localeCompare(b.id));
}

interface StateSpec {
  wrCap: [number, number];
  trackQb: [boolean, boolean];
  oneOf: Set<DkPosition> | null;
  maxPerTeam: number;
  capped: boolean;
  radix: number[];
  stride: number[];
  size: number;
}

const WR0 = 0, WR1 = 1, QB0 = 2, QB1 = 3, COUNT0 = 4, TEAM1 = 5, ONE_OF = 6, CPT = 7;

function buildSpec(rules: ShowdownRules, teams: readonly [string, string]): StateSpec {
  const barred = new Set(rules.bar ?? []);
  const wrCapFor = (team: string): number => {
    const cap = rules.wrCapByTeam?.[team] ?? SHOWDOWN_MAX_WR;
    return barred.has('QB') ? Math.min(cap, 1) : cap;
  };

  const wrCap: [number, number] = [wrCapFor(teams[0]), wrCapFor(teams[1])];
  const needQb = new Set(rules.requireQbTeams ?? []);
  const trackQb: [boolean, boolean] = [
    wrCap[0] >= 2 || needQb.has(teams[0]),
    wrCap[1] >= 2 || needQb.has(teams[1]),
  ];
  const maxPerTeam = Math.min(rules.maxPerTeam ?? SEATS - 1, SEATS - 1);

  const capped = maxPerTeam < SEATS - 1;

  const radix = new Array<number>(8);
  radix[WR0] = wrCap[0] + 1;
  radix[WR1] = wrCap[1] + 1;
  radix[QB0] = trackQb[0] ? 2 : 1;
  radix[QB1] = trackQb[1] ? 2 : 1;
  radix[COUNT0] = capped ? maxPerTeam + 1 : 2;
  radix[TEAM1] = capped ? 1 : 2;
  radix[ONE_OF] = rules.requireOneOf?.length ? 2 : 1;
  radix[CPT] = 2;

  const stride = new Array<number>(radix.length);
  let size = 1;
  for (let d = 0; d < radix.length; d++) {
    stride[d] = size;
    size *= radix[d]!;
  }

  return {
    wrCap,
    trackQb,
    oneOf: rules.requireOneOf?.length ? new Set(rules.requireOneOf) : null,
    maxPerTeam,
    capped,
    radix,
    stride,
    size,
  };
}

function advance(
  spec: StateSpec,
  state: number,
  seats: number,
  team: number,
  position: DkPosition,
  asCaptain: boolean,
): number {
  const digit = (d: number): number => Math.floor(state / spec.stride[d]!) % spec.radix[d]!;

  let next = state;
  const set = (d: number, value: number): void => {
    next += (value - digit(d)) * spec.stride[d]!;
  };

  if (position === 'WR') {
    const dim = team === 0 ? WR0 : WR1;
    const count = digit(dim) + 1;
    if (count > spec.wrCap[team]!) return -1;
    set(dim, count);
  }

  if (position === 'QB') {
    const dim = team === 0 ? QB0 : QB1;
    if (spec.radix[dim]! > 1) set(dim, 1);
  }

  if (spec.oneOf?.has(position)) set(ONE_OF, 1);

  if (spec.capped) {
    if (team === 0) {
      const count = digit(COUNT0) + 1;
      if (count > spec.maxPerTeam) return -1;
      set(COUNT0, count);
    } else if (seats + 1 - digit(COUNT0) > spec.maxPerTeam) {
      return -1;
    }
  } else {
    set(team === 0 ? COUNT0 : TEAM1, 1);
  }

  if (asCaptain) {
    if (digit(CPT) === 1) return -1;
    set(CPT, 1);
  }

  return next;
}

function accepts(spec: StateSpec, rules: ShowdownRules, teams: readonly [string, string], state: number): boolean {
  const digit = (d: number): number => Math.floor(state / spec.stride[d]!) % spec.radix[d]!;

  if (digit(CPT) !== 1) return false;

  if (spec.capped) {
    const count0 = digit(COUNT0);
    if (count0 === 0 || SEATS - count0 === 0) return false;
  } else if (digit(COUNT0) !== 1 || digit(TEAM1) !== 1) {
    return false;
  }

  for (const t of [0, 1] as const) {
    const wr = digit(t === 0 ? WR0 : WR1);
    if (wr >= 2 && digit(t === 0 ? QB0 : QB1) !== 1) return false;
  }

  for (const team of rules.requireQbTeams ?? []) {
    const t = teams.indexOf(team);
    if (t < 0) return false;
    if (digit(t === 0 ? QB0 : QB1) !== 1) return false;
  }

  if (spec.oneOf && digit(ONE_OF) !== 1) return false;

  return true;
}

export function optimizeShowdownShape(
  candidates: LineupCandidate[],
  shape: ShowdownShape,
  options: OptimizeOptions = {},
): Lineup | null {
  const excluded = new Set(options.excludes ?? []);
  const barred = new Set(shape.rules.bar ?? []);
  const usable = candidates.filter(
    (c) => !excluded.has(c.id) && c.salary > 0 && !barred.has(c.position),
  );
  if (usable.length < SEATS) return null;

  const teamNames = [...new Set(usable.map((c) => c.team))].sort();
  if (teamNames.length !== 2) return null;
  const teams: readonly [string, string] =
    shape.team != null && teamNames[1] === shape.team
      ? [teamNames[1]!, teamNames[0]!]
      : [teamNames[0]!, teamNames[1]!];
  const teamIndex = (team: string): number => (team === teams[0] ? 0 : 1);

  const spec = buildSpec(shape.rules, teams);
  const captainTeam = shape.rules.captainTeam == null ? null : teamIndex(shape.rules.captainTeam);
  const captainPositions = shape.rules.captainPositions
    ? new Set(shape.rules.captainPositions)
    : null;

  const lockIds = new Set(options.locks ?? []);
  const locked = usable.filter((c) => lockIds.has(c.id));
  if (locked.length !== lockIds.size || locked.length > SEATS) return null;

  const limitFor = (player: LineupCandidate): number =>
    player.position === 'WR'
      ? spec.wrCap[teamIndex(player.team)]!
      : Math.min(spec.maxPerTeam, SEATS - 1);

  const free = undominated(usable.filter((c) => !lockIds.has(c.id)), limitFor);
  const pool = free.length > 64 ? [...free].sort((a, b) => b.value - a.value).slice(0, 64) : free;

  const buckets = SALARY_CAP / BUCKET + 1;
  const layer = buckets * spec.size;
  const cells = (SEATS + 1) * layer;

  const value = new Float64Array(cells).fill(-Infinity);
  const maskLo = new Int32Array(cells);
  const maskHi = new Int32Array(cells);
  const captain = new Int32Array(cells).fill(-1);

  const seed = (
    seats: number,
    spend: number,
    state: number,
    total: number,
    cpt: number,
  ): void => {
    const bucket = Math.ceil(spend / BUCKET);
    if (bucket >= buckets || state < 0) return;
    const at = seats * layer + bucket * spec.size + state;
    if (total > value[at]!) {
      value[at] = total;
      captain[at] = cpt;
    }
  };

  const seedLocked = (captainAt: number): void => {
    let state = 0;
    let spend = 0;
    let total = 0;
    for (let i = 0; i < locked.length && state >= 0; i++) {
      const p = locked[i]!;
      const isCaptain = i === captainAt;
      if (isCaptain && captainTeam != null && teamIndex(p.team) !== captainTeam) return;
      if (isCaptain && captainPositions && !captainPositions.has(p.position)) return;
      state = advance(spec, state, i, teamIndex(p.team), p.position, isCaptain);
      spend += isCaptain ? Math.round(p.salary * CAPTAIN_MULTIPLIER) : p.salary;
      total += isCaptain ? p.value * CAPTAIN_MULTIPLIER : p.value;
    }
    if (state < 0 || spend > SALARY_CAP) return;
    seed(locked.length, spend, state, total, captainAt);
  };

  seedLocked(-1);
  for (let i = 0; i < locked.length; i++) seedLocked(i);

  for (let index = 0; index < pool.length; index++) {
    const player = pool[index]!;
    const team = teamIndex(player.team);
    const flexBucket = Math.ceil(player.salary / BUCKET);
    const cptBucket = Math.ceil(Math.round(player.salary * CAPTAIN_MULTIPLIER) / BUCKET);
    const cptValue = player.value * CAPTAIN_MULTIPLIER;
    const bit = index < 32 ? 1 << index : 1 << (index - 32);
    const hi = index >= 32;
    const captainable =
      (captainTeam == null || team === captainTeam) &&
      (captainPositions == null || captainPositions.has(player.position));
    const variants = captainable ? 2 : 1;

    for (let seats = SEATS - 1; seats >= 0; seats--) {
      const from = seats * layer;
      const to = (seats + 1) * layer;
      for (let bucket = buckets - 1; bucket >= 0; bucket--) {
        const row = from + bucket * spec.size;
        for (let state = 0; state < spec.size; state++) {
          const at = row + state;
          const base = value[at]!;
          if (base === -Infinity) continue;

          for (let variant = 0; variant < variants; variant++) {
            const asCaptain = variant === 1;
            const cost = asCaptain ? cptBucket : flexBucket;
            const target = bucket + cost;
            if (target >= buckets) continue;
            const next = advance(spec, state, seats, team, player.position, asCaptain);
            if (next < 0) continue;

            const total = base + (asCaptain ? cptValue : player.value);
            const into = to + target * spec.size + next;
            if (total <= value[into]!) continue;

            value[into] = total;
            maskLo[into] = maskLo[at]! | (hi ? 0 : bit);
            maskHi[into] = maskHi[at]! | (hi ? bit : 0);
            captain[into] = asCaptain ? locked.length + index : captain[at]!;
          }
        }
      }
    }
  }

  let bestAt = -1;
  let bestValue = -Infinity;
  const finalLayer = SEATS * layer;
  for (let bucket = 0; bucket < buckets; bucket++) {
    const row = finalLayer + bucket * spec.size;
    for (let state = 0; state < spec.size; state++) {
      const at = row + state;
      if (value[at]! <= bestValue) continue;
      if (!accepts(spec, shape.rules, teams, state)) continue;
      bestValue = value[at]!;
      bestAt = at;
    }
  }
  if (bestAt < 0) return null;

  const roster = [...locked];
  const lo = maskLo[bestAt]!;
  const hi = maskHi[bestAt]!;
  for (let index = 0; index < pool.length; index++) {
    const bit = index < 32 ? lo & (1 << index) : hi & (1 << (index - 32));
    if (bit !== 0) roster.push(pool[index]!);
  }
  if (roster.length !== SEATS) return null;

  const captainId = [...locked, ...pool][captain[bestAt]!]?.id;
  const cpt = roster.find((p) => p.id === captainId);
  if (!cpt) return null;

  const picks: LineupPick[] = [
    {
      ...cpt,
      slot: 'CPT',
      multiplier: CAPTAIN_MULTIPLIER,
      weight: cpt.value * CAPTAIN_MULTIPLIER,
      cost: Math.round(cpt.salary * CAPTAIN_MULTIPLIER),
    },
    ...roster
      .filter((p) => p.id !== cpt.id)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
      .map((p, i) => ({ ...p, slot: `FLEX${i + 1}`, multiplier: 1, weight: p.value, cost: p.salary })),
  ];

  return summarizeLineup(picks);
}

export interface ShowdownBuild extends ShowdownShape {
  lineup: Lineup | null;
  problem: string | null;
}

export function buildShowdownSet(
  candidates: LineupCandidate[],
  teams: readonly [string, string],
  options: OptimizeOptions = {},
): ShowdownBuild[] {
  return showdownShapes(teams).map((shape) => {
    const lineup = optimizeShowdownShape(candidates, shape, options);
    return {
      ...shape,
      lineup,
      problem: lineup
        ? null
        : shape.team
          ? `Nothing legal here: the pool has no affordable ${shape.team} quarterback to ` +
            'build around.'
          : shape.key === 'shootout'
            ? 'Nothing legal here: both quarterbacks will not fit under the cap with four ' +
              'other seats.'
            : 'Nothing legal here: the pool has no kicker or defense priced under the cap.',
    };
  });
}

export const MIN_LANES_FOR_READ = 4;

export const LEAN_GAP = 40;

export const CLIMATE_BAR = 15;

const TOTAL_WEIGHT = 25;
const PACE_WEIGHT = 20;

export interface ScriptEdge {
  offense?: string | null;
  label: string;
  edge: number | null;
}

export interface GameScriptInput {
  teams: readonly [string, string];
  edges: ScriptEdge[];
  totalLine?: number | null;
  pacePercentile?: number | null;
}

export interface GameScriptRead {
  scenario: string;
  team: string | null;
  confidence: 'strong' | 'slight';
  why: string;
  lanes: [number, number];
}

export function readGameScript(input: GameScriptInput): GameScriptRead | null {
  const { teams } = input;
  const meanFor = (team: string): number | null => {
    const graded = input.edges.filter(
      (e) => e.edge != null && (e.offense ?? e.label.split(' ')[0]) === team,
    );
    if (graded.length < MIN_LANES_FOR_READ) return null;
    return graded.reduce((acc, e) => acc + e.edge!, 0) / graded.length;
  };

  const a = meanFor(teams[0]);
  const b = meanFor(teams[1]);
  if (a == null || b == null) return null;

  const gap = a - b;
  const lanes: [number, number] = [a, b];
  const round = (n: number): string => (n > 0 ? `+${n.toFixed(0)}` : n.toFixed(0));

  if (Math.abs(gap) >= LEAN_GAP) {
    const [team, other] = gap > 0 ? [teams[0], teams[1]] : [teams[1], teams[0]];
    const [own, opp] = gap > 0 ? [a, b] : [b, a];
    return {
      scenario: `lean-${team}`,
      team,
      confidence: Math.abs(gap) >= LEAN_GAP * 2 ? 'strong' : 'slight',
      why:
        `${team}'s units average ${round(own)} across their lanes against ` +
        `${other}'s ${round(opp)} — a ${Math.abs(gap).toFixed(0)}-point gap, ` +
        'which is a game with a side.',
      lanes,
    };
  }

  const totalTilt =
    input.totalLine == null
      ? 0
      : clampTo(((input.totalLine - NEUTRAL_TOTAL) / TOTAL_RANGE) * TOTAL_WEIGHT, TOTAL_WEIGHT);
  const paceTilt =
    input.pacePercentile == null
      ? 0
      : clampTo(((input.pacePercentile - 50) / 50) * PACE_WEIGHT, PACE_WEIGHT);
  const climate = (a + b) / 2 + totalTilt + paceTilt;

  const environment = [
    input.totalLine == null ? null : `a ${input.totalLine.toFixed(1)} total`,
    input.pacePercentile == null
      ? null
      : `pace in the ${ordinal(Math.round(input.pacePercentile))} percentile`,
  ]
    .filter((part) => part != null)
    .join(' and ');

  if (climate >= CLIMATE_BAR || climate <= -CLIMATE_BAR) {
    const hot = climate >= CLIMATE_BAR;
    return {
      scenario: hot ? 'shootout' : 'low-scoring',
      team: null,
      confidence: Math.abs(climate) >= CLIMATE_BAR * 2 ? 'strong' : 'slight',
      why:
        `Neither side owns the game — ${teams[0]} average ${round(a)} and ${teams[1]} ` +
        `${round(b)} — but ${hot ? 'both offenses are positioned well' : 'neither is'}` +
        (environment ? `, into ${environment}` : '') +
        `. That reads ${hot ? 'like points' : 'like a rock fight'}.`,
      lanes,
    };
  }

  return null;
}

function clampTo(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
