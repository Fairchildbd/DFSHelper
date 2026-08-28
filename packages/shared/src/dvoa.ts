/**
 * Opponent adjustment and situational success — the two ideas worth importing
 * from DVOA.
 *
 * DVOA stacks four ideas, and only two of them are missing here.
 *
 * Its situational baseline — what a play was worth given down, distance, field
 * position, score and time — is already in the data as nflverse `epa`, fit from
 * a real model rather than Football Outsiders' hand-tuned success-point table.
 * Its rate-versus-cumulative split (DVOA against DYAR) is already how
 * production.ts blends per-opportunity efficiency with per-game fantasy points.
 * Rebuilding either would be a step backwards.
 *
 * What is genuinely absent is the letter the metric is named for. Every
 * efficiency number in this codebase — a passer's EPA per attempt, a defense's
 * fantasy points allowed — is raw. Two quarterbacks at identical EPA per
 * attempt are scored identically even when one spent the window against the
 * league's best secondaries, and a defense that drew a soft slate of offenses
 * grades as elite. That is the bias opponent adjustment exists to remove.
 *
 * The second absence is success rate. EPA is a mean, and a mean over a
 * fat-tailed distribution says little about the floor: a receiver whose EPA
 * comes from one seventy-yard touchdown and a receiver who moved the chains
 * twelve times can post the same number. Success rate is the median-shaped
 * companion — it counts how often a play did its job — and the gap between the
 * two is the most direct read available on whether a player's production is
 * repeatable or a handful of explosives.
 *
 * Everything here is pure arithmetic over plain numbers, so it is unit-testable
 * and runs identically on the server and on device, like the rest of shared.
 */

/**
 * Share of the yards needed that makes a play a success, by down.
 *
 * These are Football Outsiders' thresholds and they encode a real football
 * idea: on first down you need only to stay ahead of the sticks, by second down
 * you need to be most of the way there, and on third or fourth down nothing
 * short of the conversion has done the job. It is why five yards on third-and-4
 * counts and five yards on third-and-12 does not, which raw yardage cannot say.
 */
export const SUCCESS_THRESHOLD_BY_DOWN: Record<number, number> = {
  1: 0.45,
  2: 0.6,
  3: 1,
  4: 1,
};

export interface PlayOutcome {
  down: number | null;
  yardsToGo: number | null;
  yardsGained: number | null;
  touchdown?: boolean;
  /** Interception or lost fumble. */
  turnover?: boolean;
}

/**
 * Whether a play succeeded, in the DVOA sense.
 *
 * Returns null rather than false when the situation is unknown. A play with no
 * down recorded is not a failed play, and folding the two together would score
 * every two-point conversion and untimed down as a stop.
 *
 * Touchdowns and turnovers short-circuit the yardage test: a one-yard
 * touchdown on third-and-goal from the two gains half the yards to go and is
 * unambiguously a success, and a completion past the sticks that is fumbled
 * away is not.
 */
export function isSuccessfulPlay(play: PlayOutcome): boolean | null {
  if (play.turnover) return false;
  if (play.touchdown) return true;

  const { down, yardsToGo, yardsGained } = play;
  if (down == null || yardsGained == null) return null;
  const threshold = SUCCESS_THRESHOLD_BY_DOWN[down];
  if (threshold == null) return null;

  // A goal-to-go snap from inside the one can report zero yards to go. Treat
  // any non-positive distance as needing a yard, so the test stays defined.
  const needed = yardsToGo != null && yardsToGo > 0 ? yardsToGo : 1;
  return yardsGained >= needed * threshold;
}

/**
 * One offense-versus-defense cell: every observation of a given offense facing
 * a given defense, already folded to a count and a sum.
 *
 * The fit is expressed over cells rather than plays because both callers
 * naturally produce them and there are at most 32x32 of them. Fitting over a
 * hundred and fifty thousand individual plays would compute the same answer
 * several orders of magnitude more slowly.
 */
export interface MatchupCell {
  offense: string;
  defense: string;
  n: number;
  sum: number;
}

export interface TwoWayFit {
  /** Grand mean across every observation — the league-average play. */
  league: number;
  /**
   * Offensive strength, as a signed departure from league average in the unit
   * of the input. Positive is a better offense.
   */
  offense: Map<string, number>;
  /**
   * Defensive strength, in the same unit and the same sign convention as the
   * input. A defense measured in EPA allowed or points conceded is therefore
   * *better* when this is negative, which is the same orientation DVOA uses
   * for defensive numbers.
   */
  defense: Map<string, number>;
  /** Largest coefficient movement on the final iteration. */
  delta: number;
  iterations: number;
}

export interface TwoWayOptions {
  /**
   * Observations before a unit's estimate is taken at full strength. Below it
   * the coefficient is pulled toward zero in proportion to what is missing.
   */
  shrinkage?: number;
  maxIterations?: number;
  /** Stop early once no coefficient moves more than this. */
  tolerance?: number;
}

const DEFAULT_SHRINKAGE = 200;
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_TOLERANCE = 1e-6;

/**
 * Fit an additive two-way model, `value ~ league + offense + defense`, by
 * alternating conditional means.
 *
 * This is the piece that makes an opponent adjustment honest. The naive
 * correction — subtract each defense's raw average allowed — is circular: a
 * defense's raw average is itself a product of the offenses it faced, so
 * subtracting it imports exactly the schedule bias it was meant to remove.
 * Football Outsiders resolve this by iterating, and so does this: estimate
 * offenses holding defenses fixed, re-estimate defenses holding those offenses
 * fixed, and repeat until the two stop arguing. It is Gauss-Seidel on a two-way
 * fixed-effects model, and on a schedule as connected as the NFL's it settles
 * in a handful of passes.
 *
 * Two details matter for correctness.
 *
 * **Centering.** The model is only identified up to a constant — adding one to
 * every offense and subtracting it from every defense fits equally well — so
 * both coefficient sets are recentred to a play-weighted mean of zero after
 * each half-step. Without it the two sides drift in opposite directions and
 * "above league average" stops meaning anything.
 *
 * **Shrinkage.** Early in a season a team has a few hundred plays and a raw
 * cell mean is mostly noise. An unshrunk coefficient then over-corrects: a
 * player is credited for a brutal schedule that has not actually been
 * established yet. Pulling each estimate toward zero by its own sample size
 * makes the adjustment arrive gradually, which is the honest behaviour when the
 * evidence for it is still thin.
 */
export function fitTwoWay(cells: MatchupCell[], opts: TwoWayOptions = {}): TwoWayFit {
  const shrinkage = opts.shrinkage ?? DEFAULT_SHRINKAGE;
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;

  const usable = cells.filter((c) => c.n > 0);
  const totalN = usable.reduce((sum, c) => sum + c.n, 0);
  if (totalN === 0) {
    return { league: 0, offense: new Map(), defense: new Map(), delta: 0, iterations: 0 };
  }

  const league = usable.reduce((sum, c) => sum + c.sum, 0) / totalN;

  // Cells grouped both ways, so each half-step is a linear scan rather than a
  // filter over the whole set per unit.
  const byOffense = new Map<string, MatchupCell[]>();
  const byDefense = new Map<string, MatchupCell[]>();
  for (const cell of usable) {
    let off = byOffense.get(cell.offense);
    if (!off) byOffense.set(cell.offense, (off = []));
    off.push(cell);
    let def = byDefense.get(cell.defense);
    if (!def) byDefense.set(cell.defense, (def = []));
    def.push(cell);
  }

  const offense = new Map<string, number>();
  const defense = new Map<string, number>();
  for (const key of byOffense.keys()) offense.set(key, 0);
  for (const key of byDefense.keys()) defense.set(key, 0);

  /** Recentre coefficients to a play-weighted mean of zero. */
  const centre = (coef: Map<string, number>, groups: Map<string, MatchupCell[]>) => {
    let weighted = 0;
    let total = 0;
    for (const [key, cellList] of groups) {
      const n = cellList.reduce((sum, c) => sum + c.n, 0);
      weighted += (coef.get(key) ?? 0) * n;
      total += n;
    }
    if (total === 0) return;
    const offset = weighted / total;
    for (const key of coef.keys()) coef.set(key, (coef.get(key) ?? 0) - offset);
  };

  /**
   * One half-step: re-estimate `coef` from the residual left once the league
   * mean and the *other* side's current coefficients are taken out.
   */
  const step = (
    coef: Map<string, number>,
    groups: Map<string, MatchupCell[]>,
    other: Map<string, number>,
    otherKey: (cell: MatchupCell) => string,
  ) => {
    for (const [key, cellList] of groups) {
      let residual = 0;
      let n = 0;
      for (const cell of cellList) {
        residual += cell.sum - cell.n * (league + (other.get(otherKey(cell)) ?? 0));
        n += cell.n;
      }
      const raw = n > 0 ? residual / n : 0;
      coef.set(key, raw * (n / (n + shrinkage)));
    }
  };

  /**
   * Largest coefficient movement across a whole iteration.
   *
   * Measured against a snapshot taken before the step and *after* centering,
   * which is the only comparison that actually goes to zero. Measuring inside
   * the step instead — comparing each new uncentered estimate against the
   * centered value it replaces — leaves the centering offset in the difference
   * forever: on real data that figure settled at 1.3e-3 and stayed there while
   * the coefficients themselves were converging to machine precision, so the
   * tolerance never fired and every fit silently ran its full iteration budget.
   */
  const movement = (before: Map<string, number>, after: Map<string, number>): number => {
    let moved = 0;
    for (const [key, value] of after) {
      moved = Math.max(moved, Math.abs(value - (before.get(key) ?? 0)));
    }
    return moved;
  };

  let delta = 0;
  let iterations = 0;
  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const offBefore = new Map(offense);
    const defBefore = new Map(defense);

    step(offense, byOffense, defense, (c) => c.defense);
    centre(offense, byOffense);
    step(defense, byDefense, offense, (c) => c.offense);
    centre(defense, byDefense);

    delta = Math.max(movement(offBefore, offense), movement(defBefore, defense));
    if (delta < tolerance) break;
  }

  return { league, offense, defense, delta, iterations };
}

/**
 * How much less a season counts for every year further back it sits.
 *
 * Halving is deliberately aggressive. A defense is not a stable object: over
 * 2023-2025 the median team's pass defense swung 0.096 EPA per play between its
 * best and worst year, which is nearly twice the entire spread of a pooled
 * three-season fit. Treating a three-year-old roster as half the evidence of
 * last year's is closer to the truth than treating them alike.
 */
export const SEASON_DECAY = 0.5;

export interface SeasonValue {
  season: number;
  value: number;
  /** Observations behind this season's value — plays, games, whatever the unit. */
  weight: number;
}

/**
 * Combine per-season estimates into the single current-form number the matchup
 * layer needs, weighting each season by both its sample size and its recency.
 *
 * Both terms are load-bearing, and together they handle the two situations that
 * would otherwise need separate code paths.
 *
 * In the preseason the newest season has no plays at all, so its sample weight
 * is zero and last year's completed season carries the estimate by itself. In
 * October the new season has a few hundred plays and starts to take over, and by
 * December it dominates on sample size alone with recency amplifying it. Nothing
 * has to know which of those situations it is in.
 *
 * Returns null when nothing has any weight, rather than a fabricated zero — a
 * team with no plays on record is unknown, not league average.
 */
export function blendSeasons(
  values: SeasonValue[],
  opts: { latestSeason?: number; decay?: number } = {},
): number | null {
  const usable = values.filter((v) => v.weight > 0 && Number.isFinite(v.value));
  if (usable.length === 0) return null;

  const decay = opts.decay ?? SEASON_DECAY;
  const latest = opts.latestSeason ?? Math.max(...usable.map((v) => v.season));

  let weighted = 0;
  let total = 0;
  for (const v of usable) {
    // A season newer than the reference gets no bonus; it is simply current.
    const age = Math.max(0, latest - v.season);
    const w = v.weight * decay ** age;
    weighted += v.value * w;
    total += w;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Value over average for one unit, expressed the way DVOA reports it: a
 * percentage of the league-average baseline rather than a raw difference.
 *
 * Returns null when the baseline is at or below zero. Per-play EPA averages
 * hover near zero and can cross it, and dividing by a baseline that small
 * produces a number that swings wildly on noise — better to say nothing than to
 * publish a four-hundred-percent efficiency because the denominator vanished.
 */
export function valueOverAverage(value: number, baseline: number): number | null {
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1e-6) return null;
  if (baseline <= 0) return null;
  return ((value - baseline) / baseline) * 100;
}
