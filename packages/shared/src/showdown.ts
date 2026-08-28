/**
 * Showdown Captain Mode construction.
 *
 * A showdown lineup is six players from one game, and that makes it a
 * different problem from a classic slate rather than a smaller one. On a full
 * slate the seats are independent enough that buying each one on its own grade
 * is defensible. In a single game they are not independent at all: the players
 * share a ball, a game script, and a final score, so a lineup is really a bet
 * on one story about how the game goes.
 *
 * Which is why the unconstrained optimizer produced four Seattle receivers.
 * Every one of them graded well against the same defense, and nothing in the
 * objective knew they were competing with each other for the same targets. That
 * lineup needs a fifty-point passing day *and* needs it split four ways, which
 * is close to the least likely way for a good passing day to happen.
 *
 * Three rules fix the correlation, and they apply to every build here:
 *
 *   **Two receivers from a team, at most.** Past two, the ball is being divided
 *   more ways than a good day divides.
 *
 *   **A second receiver requires his quarterback.** Two receivers from one team
 *   is a bet on that passing game, and the quarterback is the only player who
 *   is paid on all of it. Without him the pair is a bet against itself: the
 *   throws that pay one of them are throws the other did not get.
 *
 * Backs are deliberately *not* a third rule. Touchdowns decide showdown and
 * backs score them as often as receivers do, so a back has to be genuinely
 * available for a seat — which he is, since nothing here discounts him. But
 * requiring one is a different claim, and a wrong one: there are games where
 * the right six do not include a running back at all, and a rule that forces
 * one spends a seat on whoever is cheapest at the position, which is how a
 * fullback ends up in a lineup.
 *
 * On top of that the four builds themselves, which exist because the honest
 * answer to "which way does this game go" is that nobody knows:
 *
 *   **One per team**, betting that offense has the day; **one for a shootout**,
 *   where both of them do; and **one for a game that never gets going**.
 *
 * The last one is the reason the kicker and the defense are not a judgement
 * call. Those two seats pay when drives stall, so they belong in the low-scoring
 * build and nowhere else — a lineup betting on points should not spend a seat on
 * the outcome that points prevent. Structuring it this way means never having to
 * guess whether this is a kicker week; one of the four entries is already the
 * kicker entry.
 *
 * Which of the four to enter is the user's call, not this file's. `readGameScript`
 * offers the model's own read where the lanes support one, and it is offered as a
 * starting point rather than as an answer.
 *
 * The search is exact. Each build is a constrained knapsack over the pool,
 * solved by dynamic programming across seats, salary and a small composition
 * state, so "the best lineup that obeys these rules" is what comes back rather
 * than the best one a greedy pass happened to find.
 */

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

/**
 * The price grid the search runs on.
 *
 * Fifty rather than a hundred, even though DraftKings prices every player in
 * hundreds: the captain costs one and a half times his salary, and half of a
 * hundred is fifty. On a hundred-dollar grid a captain at $7,650 has no square
 * to stand on, and the table is read at a fractional index — which is not a
 * wrong answer, it is no answer at all.
 */
const BUCKET = 50;

/** Seats in a showdown lineup: one captain and five flex. */
const SEATS = 6;

/** Most receivers from one team, ever. */
export const SHOWDOWN_MAX_WR = 2;

/**
 * Receivers allowed from the team a build is *not* betting on.
 *
 * One, because the opposite side's seat is a bring-back — the player who scores
 * if the game turns into a shootout — and not a second stack. Two of them would
 * make the build a bet on both offenses, which is a different lineup and one
 * this set already contains.
 */
export const SHOWDOWN_BRINGBACK_WR = 1;

/** Most players from either team in the low-scoring build. */
export const LOW_SCORING_MAX_PER_TEAM = 3;

/**
 * Most players from either team in the shootout build.
 *
 * Four rather than three: a shootout is both offenses producing, not both
 * producing equally, and a five-one would stop being a two-sided bet.
 */
export const SHOOTOUT_MAX_PER_TEAM = 4;


// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * The composition a build must satisfy.
 *
 * Everything here is a hard constraint on the search rather than a preference
 * expressed through the objective. A weight would let a big enough grade buy
 * its way past the rule, and these rules exist precisely for the cases where
 * the grades say yes and the correlation says no.
 */
export interface ShowdownRules {
  /** The captain must come from this team. */
  captainTeam?: string | null;
  /** The captain must play one of these positions. */
  captainPositions?: DkPosition[];
  /** These teams' quarterbacks must each be rostered. */
  requireQbTeams?: string[];
  /** Positions barred from the build outright. */
  bar?: DkPosition[];
  /** At least one player from one of these positions. */
  requireOneOf?: DkPosition[];
  /** Most players from any one team. */
  maxPerTeam?: number;
  /** Receiver cap for a named team, overriding the default of two. */
  wrCapByTeam?: Record<string, number>;
}

/** One of the three builds: what it is betting on, and what shape that takes. */
export interface ShowdownShape {
  key: string;
  /** Short enough for a card header. */
  label: string;
  /** Why this build exists, in a sentence. */
  description: string;
  /** The team it is betting on, or null for the slow-game build. */
  team: string | null;
  rules: ShowdownRules;
}

/**
 * The four builds, for a game between `teams`.
 *
 * Ordered as the matchup reads — away side first — rather than by which one the
 * model likes best. These are scenarios rather than recommendations, and
 * ranking them would imply a confidence about the game script that the whole
 * point of building four of them is to admit nobody has.
 */
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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Players who can never be worth a seat, dropped before the search.
 *
 * A player is dominated when someone in his own team and position is no more
 * expensive and no worse graded. That is only enough to drop him if the
 * dominator is guaranteed to be available to take his place, though, which is
 * where the obvious version of this pass is wrong: a lineup may hold two
 * Seattle receivers, and the cheaper better one being *already in the lineup*
 * is exactly the case where the expensive one is needed.
 *
 * So a player is dropped only once at least `limit` players dominate him, where
 * `limit` is the most of his own team and position any legal lineup can hold.
 * Then even a lineup using the full allowance has a dominator left over to swap
 * him for, and the swap costs no salary and loses no grade.
 *
 * Worth doing because the search is linear in the pool, and a showdown export
 * is sixty players deep with a long tail of third-string names priced at the
 * minimum.
 */
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
    // Cheapest first, and better-graded first within a price: everyone earlier
    // in this order costs no more, so domination is just a count of how many of
    // them also grade at least as well.
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
  // Sorted for determinism: the DP's answer must not depend on Map iteration.
  return kept.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The composition state a partial lineup has to carry.
 *
 * Kept as narrow as each build allows, because it multiplies the size of the
 * table: a dimension only exists when a rule actually reads it. The slow-game
 * build bars quarterbacks, for instance, which drops both quarterback flags and
 * halves both receiver dimensions, since without a quarterback a team can never
 * hold a second receiver anyway.
 */
interface StateSpec {
  /** Receiver cap per team index. */
  wrCap: [number, number];
  /** Whether a team's quarterback flag is tracked at all. */
  trackQb: [boolean, boolean];
  /** Positions that satisfy `requireOneOf`, if any. */
  oneOf: Set<DkPosition> | null;
  maxPerTeam: number;
  /**
   * Whether the per-team cap actually binds.
   *
   * When it does, the first team's players have to be counted. When it does
   * not, the only thing any rule asks about a team is whether it is on the
   * roster at all, and two flags are a quarter the size of two counters.
   */
  capped: boolean;
  radix: number[];
  stride: number[];
  size: number;
}

/** Dimension order, fixed so the encoding is readable when debugging. */
const WR0 = 0, WR1 = 1, QB0 = 2, QB1 = 3, COUNT0 = 4, TEAM1 = 5, ONE_OF = 6, CPT = 7;

function buildSpec(rules: ShowdownRules, teams: readonly [string, string]): StateSpec {
  const barred = new Set(rules.bar ?? []);
  const wrCapFor = (team: string): number => {
    const cap = rules.wrCapByTeam?.[team] ?? SHOWDOWN_MAX_WR;
    // Two receivers require the quarterback, so barring quarterbacks caps every
    // team at one receiver by arithmetic rather than by a second rule.
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

/** Fold one player into a state, or return -1 when he breaks a rule. */
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
      // The second team's count is whatever is not the first team's, so it
      // needs no dimension of its own — only this check as the seats fill.
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

/** Whether a full six-seat state is a lineup DraftKings and these rules accept. */
function accepts(spec: StateSpec, rules: ShowdownRules, teams: readonly [string, string], state: number): boolean {
  const digit = (d: number): number => Math.floor(state / spec.stride[d]!) % spec.radix[d]!;

  if (digit(CPT) !== 1) return false;

  // Both sides must be represented, which DraftKings enforces itself.
  if (spec.capped) {
    const count0 = digit(COUNT0);
    if (count0 === 0 || SEATS - count0 === 0) return false;
  } else if (digit(COUNT0) !== 1 || digit(TEAM1) !== 1) {
    return false;
  }

  // The rule the whole file exists for: a second receiver only alongside the
  // quarterback throwing to him. Checked at the end rather than on the way in,
  // because the quarterback may well be seated after the receivers are.
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

/**
 * The best lineup of this shape, or null when the pool cannot produce one.
 *
 * Exact: a table over (seats, salary, composition) that carries the roster it
 * represents as a bitmask rather than a back-pointer, because a predecessor
 * state can be improved after a pointer into it is written and walking the
 * pointers would then rebuild a roster the table never actually costed.
 */
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

  // Locked players are seated before the search rather than searched for: they
  // are a statement about the roster, not a candidate for it.
  const lockIds = new Set(options.locks ?? []);
  const locked = usable.filter((c) => lockIds.has(c.id));
  if (locked.length !== lockIds.size || locked.length > SEATS) return null;

  // How many of one team and position a legal lineup of this shape could hold,
  // which is what makes a dominated player safe to drop.
  const limitFor = (player: LineupCandidate): number =>
    player.position === 'WR'
      ? spec.wrCap[teamIndex(player.team)]!
      : Math.min(spec.maxPerTeam, SEATS - 1);

  const free = undominated(usable.filter((c) => !lockIds.has(c.id)), limitFor);
  // Two 32-bit words hold the roster mask, which is what caps the pool. A
  // showdown pool is sixty players before the dominance pass and half that
  // after it, so this bound is never the thing that binds.
  const pool = free.length > 64 ? [...free].sort((a, b) => b.value - a.value).slice(0, 64) : free;

  const buckets = SALARY_CAP / BUCKET + 1;
  const layer = buckets * spec.size;
  const cells = (SEATS + 1) * layer;

  const value = new Float64Array(cells).fill(-Infinity);
  const maskLo = new Int32Array(cells);
  const maskHi = new Int32Array(cells);
  // Which of `locked` and `pool` wears the C, indexed into the two lists as one.
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

  /**
   * Seeds: the locked players seated, once for each of them wearing the C and
   * once with the captaincy left for the search. A lock that contradicts the
   * shape simply produces no seed, and the build reports that it cannot be made.
   */
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
    // Ceiling rather than division: DraftKings prices land on the grid exactly,
    // and rounding a stray price up spends a few dollars that do not exist
    // rather than indexing the table at a square that does not.
    const flexBucket = Math.ceil(player.salary / BUCKET);
    const cptBucket = Math.ceil(Math.round(player.salary * CAPTAIN_MULTIPLIER) / BUCKET);
    const cptValue = player.value * CAPTAIN_MULTIPLIER;
    const bit = index < 32 ? 1 << index : 1 << (index - 32);
    const hi = index >= 32;
    // Hoisted out of the state loop: this runs tens of millions of times.
    const captainable =
      (captainTeam == null || team === captainTeam) &&
      (captainPositions == null || captainPositions.has(player.position));
    const variants = captainable ? 2 : 1;

    // Seats descending, so a player is never seated twice in one lineup.
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
    // Flex seats read best-first, which is also how they are drafted.
    ...roster
      .filter((p) => p.id !== cpt.id)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
      .map((p, i) => ({ ...p, slot: `FLEX${i + 1}`, multiplier: 1, weight: p.value, cost: p.salary })),
  ];

  return summarizeLineup(picks);
}

// ---------------------------------------------------------------------------
// The set of three
// ---------------------------------------------------------------------------

export interface ShowdownBuild extends ShowdownShape {
  lineup: Lineup | null;
  /** Why this one could not be built, when it could not. */
  problem: string | null;
}

/**
 * All three builds for one game.
 *
 * A build that cannot be made is reported rather than dropped: "no legal
 * lineup fits" is information about the pool — a team missing its quarterback
 * to injury, a slate with no kicker priced — and silently returning two entries
 * where three were asked for hides it.
 */
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

// ---------------------------------------------------------------------------
// The model's read on how the game goes
// ---------------------------------------------------------------------------

/**
 * Lanes a side needs graded before the model will say anything.
 *
 * Four of six. Below that the mean is being taken over whichever units happened
 * to have data, and a read built on two lanes is a read about two lanes.
 */
export const MIN_LANES_FOR_READ = 4;

/**
 * How far apart two sides' lanes must average before the game reads as one
 * team's, in percentile points.
 *
 * Calibrated against a real slate rather than chosen: in 2026 week 1, Phila-
 * delphia's units averaged 53 against Washington's -36, a gap of 88, and that
 * is a game with a side. Tampa Bay and Cincinnati averaged 50 and 35 — a gap of
 * 15 — and that is a game with no side, which is exactly the game a lean build
 * gets wrong. Forty sits between them with room on both sides.
 */
export const LEAN_GAP = 40;

/**
 * How hot or cold the game has to read before it is a shootout or a rock fight.
 *
 * The same units as a lane edge, since that is most of what goes into it.
 */
export const CLIMATE_BAR = 15;

/** Percentile points the betting total may move the read, at the extremes. */
const TOTAL_WEIGHT = 25;
/** Percentile points combined pace may move it. */
const PACE_WEIGHT = 20;

export interface ScriptEdge {
  /** The offense whose lane this is. Falls back to the label's first word. */
  offense?: string | null;
  label: string;
  edge: number | null;
}

export interface GameScriptInput {
  teams: readonly [string, string];
  edges: ScriptEdge[];
  /** The betting total, when one is published. */
  totalLine?: number | null;
  /** Combined pace percentile for the two offenses. */
  pacePercentile?: number | null;
}

export interface GameScriptRead {
  /** The build this points at, by `ShowdownShape.key`. */
  scenario: string;
  team: string | null;
  confidence: 'strong' | 'slight';
  /** The read in one sentence, with the numbers that produced it. */
  why: string;
  /** Mean lane edge per team, in the order the teams were given. */
  lanes: [number, number];
}

/**
 * Which way the model thinks this game goes, or null when it has no business
 * saying.
 *
 * Two questions in order. First, does one side hold the game: the difference
 * between what each offense's lanes average is the only thing that separates a
 * game with a favourite from a game between two teams who are both fine. Then,
 * failing that, is the game hot or cold — both offenses well-positioned into a
 * high total and a fast pace is a shootout; neither of them into a low total and
 * a slow pace is a rock fight.
 *
 * Returning null is a real answer and the most common one on a thin week. A read
 * of "no read" is worth more than a coin flip dressed as a recommendation, since
 * the entry it would point at is the one that loses when the game goes the other
 * way.
 */
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

  // Neither side owns the game, so the question becomes how much scoring there
  // is to go round. Lane climate carries it; the total and the pace tilt it.
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

/** Symmetric clamp, so a tilt cannot outweigh the lanes it is adjusting. */
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
