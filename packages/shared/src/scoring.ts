/**
 * The ranking engine.
 *
 * Three components feed one composite score:
 *
 *   Athletic   — position-weighted combine/pro-day percentiles. A prediction of
 *                what a player might become, made before they played a down.
 *   College    — production at the previous level. Real results, but against
 *                weaker competition, and only relevant while a player is new.
 *   NFL        — production at this level. The thing everything else was trying
 *                to predict.
 *
 * Two rules govern the blend, and both are hard constraints:
 *
 *   Stats always outweigh measurables. At every experience level the combined
 *   college + NFL weight exceeds the athletic weight. A drill time is a
 *   prediction; a stat line is a result, and a result beats a forecast of it.
 *
 *   College stops counting after year three. From the fourth season on, a
 *   player is their NFL production and nothing else.
 *
 * Missing data is the central design problem here, not an edge case. Barely a
 * third of edge rushers run the 3-cone, yet the cone is the most heavily
 * weighted drill for that cohort. So an unmeasured input is never treated as a
 * zero and never silently dropped: its weight is reassigned to the positional
 * average, which pulls the score toward the middle by exactly the share of
 * evidence that is missing. A corner who ran only the 40 cannot post a 95
 * overall no matter how fast they ran, and a one-game call-up cannot outrank an
 * All-Pro on a single afternoon's per-game rate.
 */

import {
  COHORT_ATHLETIC_SIGNAL,
  COHORT_WEIGHTS,
  DRILL_LABELS,
  LOWER_IS_BETTER,
  cohortFor,
  type Drill,
  type Position,
} from './positions.js';
import {
  COLLEGE_PRODUCTION_METRICS,
  FULL_SAMPLE_OPPORTUNITIES,
  FULL_TIME_STARTS,
  LOW_SIGNAL_PRODUCTION,
  PRODUCTION_METRICS,
  QUALIFYING_SAMPLE,
  RANK_TIER,
  RATE_METRICS,
  STARTER_TIERED_POSITIONS,
} from './production.js';
import { clamp, mean, normalCdf, round, stdDev } from './stats.js';
import type {
  Baseline,
  BaselineTable,
  ComponentScore,
  MetricScore,
  PlayerInput,
  PlayerScore,
} from './types.js';

/**
 * Minimum sample before a position-level baseline is trusted. Below this the
 * engine falls back to the wider cohort — a noisy mean is worse than a coarse
 * but stable one.
 */
export const MIN_BASELINE_N = 30;

/**
 * Games of production before the component is fully trusted, for positions with
 * no better opportunity counter. Skill positions use
 * `FULL_SAMPLE_OPPORTUNITIES` instead — see the note there on why games alone is
 * the wrong unit.
 */
export const FULL_PRODUCTION_GAMES = 8;

/** College seasons before the college component is fully trusted. */
export const FULL_COLLEGE_SEASONS = 2;

/**
 * Component weights by years of NFL experience.
 *
 * Two rules drive this table, and both are hard constraints rather than
 * tendencies:
 *
 *   1. Stats always outweigh measurables. At every experience level the
 *      college + NFL weight exceeds the athletic weight, so a workout can shade
 *      a ranking but never define it.
 *   2. College stops counting after year three. From year four the composite is
 *      NFL production alone — no college, no combine.
 *
 * A drill time is a prediction; a stat line is a result. Once results exist,
 * the prediction stops being the evidence.
 */
export interface ComponentWeights {
  athletic: number;
  college: number;
  nfl: number;
}

const EXPERIENCE_WEIGHTS: ComponentWeights[] = [
  { athletic: 0.3, college: 0.7, nfl: 0.0 }, // rookie — no pro tape yet
  { athletic: 0.2, college: 0.4, nfl: 0.4 },
  { athletic: 0.12, college: 0.22, nfl: 0.66 },
  { athletic: 0.06, college: 0.09, nfl: 0.85 }, // last year college counts
];

/** From year four on, NFL production is the only input. */
const VETERAN_WEIGHTS: ComponentWeights = { athletic: 0, college: 0, nfl: 1 };

/** The experience level at which college stats stop counting entirely. */
export const COLLEGE_RELEVANCE_YEARS = 4;

export function componentWeights(yearsExperience: number): ComponentWeights {
  const exp = Math.max(0, Math.floor(yearsExperience));
  return EXPERIENCE_WEIGHTS[exp] ?? VETERAN_WEIGHTS;
}

/** The neutral value an unmeasured metric is assumed to take. */
const NEUTRAL_PERCENTILE = 50;

/**
 * Score for a player four or more years in with no NFL production on record.
 * Below average on purpose: the league has had years to use them and hasn't.
 * Not zero, because injury and roster churn are real and this is an inference
 * from absence, not a measurement.
 *
 * TODO(availability): this anchor cannot tell "the league declined to play him"
 * from "he was not available to be played". A player who spent the window on
 * IR, PUP, or suspension is scored identically to a career backup, and a highly
 * rated player is penalised for time he was never allowed to accrue.
 *
 * Confirmed by backtest: Calvin Ridley, 2023 week 1 — suspended for all of 2022,
 * so the two-season window held nothing. Anchored at 25, ranked 291st of 297
 * receivers, scored 27.1 in a Millionaire Maker winning lineup.
 *
 * Scale: 150 of 1,707 players active in 2025 are four or more seasons elapsed
 * with two or more seasons missed, so this is not a one-off.
 *
 * Fixing it needs availability to reach the engine at all — `PlayerInput` in
 * types.ts carries no such field today, and `players.status` is ingested but
 * never read back by the ranker. See also the two TODOs in
 * server/src/rankings.ts: the anchor is only half of this, since the production
 * window itself is what comes up empty.
 */
export const NO_PRODUCTION_ANCHOR = 25;

/**
 * Minimum total evidence weight before a composite is taken at face value.
 * Below this, the shortfall is filled with the positional average, so a player
 * backed by one drill and nothing else cannot post an elite ranking.
 */
export const EVIDENCE_FLOOR = 0.5;

interface ScopedBaseline {
  baseline: Baseline;
  scope: string;
}

/**
 * Resolve a baseline for one metric, preferring the narrowest scope with enough
 * sample behind it.
 */
function resolveBaseline(
  table: BaselineTable,
  position: Position,
  metric: string,
): ScopedBaseline | null {
  const scopes = [`pos:${position}`, `cohort:${cohortFor(position)}`];
  for (const scope of scopes) {
    const baseline = table[scope]?.[metric];
    if (baseline && baseline.n >= MIN_BASELINE_N && baseline.sd > 0) {
      return { baseline, scope };
    }
  }
  return null;
}

interface WeightedMetric {
  key: string;
  label: string;
  weight: number;
  lowerIsBetter: boolean;
}

/**
 * Convert a set of weighted raw metrics into a 0-100 component score.
 *
 * Returns both the shrunk score and the raw measured-only score, so callers can
 * distinguish "average athlete" from "we only measured one drill".
 */
function scoreComponent(
  metrics: WeightedMetric[],
  values: Record<string, number | null | undefined>,
  table: BaselineTable,
  position: Position,
): ComponentScore {
  const scored: MetricScore[] = [];
  let weightedSum = 0;
  let measuredWeight = 0;
  let totalWeight = 0;

  for (const metric of metrics) {
    totalWeight += metric.weight;
    const raw = values[metric.key];
    const resolved = resolveBaseline(table, position, metric.key);

    if (raw == null || !Number.isFinite(raw) || !resolved) {
      scored.push({
        metric: metric.key,
        label: metric.label,
        raw: raw ?? null,
        percentile: null,
        weight: metric.weight,
        scope: null,
      });
      continue;
    }

    const { baseline, scope } = resolved;
    let z = (raw - baseline.mean) / baseline.sd;
    if (metric.lowerIsBetter) z = -z;

    // Clamp before the CDF so a single freak outlier cannot dominate a blend.
    const percentile = normalCdf(clamp(z, -3.5, 3.5)) * 100;

    weightedSum += percentile * metric.weight;
    measuredWeight += metric.weight;

    scored.push({
      metric: metric.key,
      label: metric.label,
      raw,
      percentile: round(percentile),
      weight: metric.weight,
      scope,
    });
  }

  if (totalWeight === 0 || measuredWeight === 0) {
    return { score: null, confidence: 0, metrics: scored };
  }

  // The score reflects only what was actually recorded. Uncertainty about the
  // rest is expressed later, as reduced weight in the blend — never by dragging
  // this number toward the mean. Shrinking the score here would mean a player
  // who ran one elite drill scored *worse* than one who skipped the workout
  // entirely, turning missing data into a penalty.
  return {
    score: round(weightedSum / measuredWeight),
    confidence: round(measuredWeight / totalWeight, 3),
    metrics: scored,
  };
}

/**
 * Sort tier for a player, used ahead of the composite when ordering a board.
 *
 * Only quarterbacks are tiered — see STARTER_TIERED_POSITIONS for why. Everyone
 * else returns the top tier, so ordering for those positions is decided by the
 * composite alone, exactly as before.
 */
export function rankTierFor(position: Position, starts: number): number {
  if (!STARTER_TIERED_POSITIONS.includes(position)) return RANK_TIER.STARTER;
  if (starts >= FULL_TIME_STARTS) return RANK_TIER.STARTER;
  if (starts >= 1) return RANK_TIER.SPOT_STARTER;
  return RANK_TIER.NON_STARTER;
}

/** Score one player against a precomputed baseline table. */
export function scorePlayer(input: PlayerInput, table: BaselineTable): PlayerScore {
  const cohort = cohortFor(input.position);

  const drillWeights = COHORT_WEIGHTS[cohort];
  const athleticMetrics: WeightedMetric[] = (Object.keys(drillWeights) as Drill[]).map((drill) => ({
    key: drill,
    label: DRILL_LABELS[drill],
    weight: drillWeights[drill] as number,
    lowerIsBetter: LOWER_IS_BETTER[drill],
  }));

  const athletic = scoreComponent(athleticMetrics, input.measurables, table, input.position);

  const productionMetrics: WeightedMetric[] = PRODUCTION_METRICS[input.position].map((m) => ({
    key: m.key,
    label: m.label,
    weight: m.weight,
    lowerIsBetter: m.lowerIsBetter ?? false,
  }));

  const production = scoreComponent(productionMetrics, input.production, table, input.position);

  // College production, scored against college baselines. Absent by design for
  // anyone past their third season.
  const collegeMetrics: WeightedMetric[] = COLLEGE_PRODUCTION_METRICS[input.position].map((m) => ({
    key: m.key,
    label: m.label,
    weight: m.weight,
    lowerIsBetter: m.lowerIsBetter ?? false,
  }));
  const college = scoreComponent(
    collegeMetrics,
    input.collegeProduction ?? {},
    table,
    input.position,
  );

  /*
   * A thin sample reduces how much the component is trusted, never what it
   * says. Opportunity is the unit, not games: a reserve who appears in ten
   * blowouts has ten games and a fraction of a starter's attempts, and counting
   * those as equivalent evidence is what lets backups outrank starters.
   */
  const fullSample = FULL_SAMPLE_OPPORTUNITIES[input.position];
  const opportunities = input.opportunities ?? input.gamesPlayed;
  const sampleConfidence = clamp(opportunities / fullSample, 0, 1);
  const collegeSampleConfidence = clamp(
    (input.collegeSeasons ?? 0) / FULL_COLLEGE_SEASONS,
    0,
    1,
  );

  // Quarterback drills describe mobility, not quarterbacking, so their reach
  // into the composite is capped. The component score itself stays honest.
  const signal = COHORT_ATHLETIC_SIGNAL[cohort];
  const athleticForComposite =
    athletic.score == null
      ? null
      : NEUTRAL_PERCENTILE + (athletic.score - NEUTRAL_PERCENTILE) * signal;

  const target = componentWeights(input.yearsExperience);

  /*
   * Each component earns weight in proportion to how much evidence backs it.
   * A missing component contributes nothing and simply drops out, so never
   * having worked out costs a player exactly zero — the remaining components
   * renormalize and carry the whole score. A partial workout earns partial
   * weight on what was actually recorded, so an elite drill helps and a poor
   * one hurts, both in proportion to how much was measured.
   */
  const parts: Array<{ score: number; weight: number }> = [];
  if (athleticForComposite != null && target.athletic > 0) {
    parts.push({ score: athleticForComposite, weight: target.athletic * athletic.confidence });
  }
  if (college.score != null && target.college > 0) {
    parts.push({
      score: college.score,
      weight: target.college * college.confidence * collegeSampleConfidence,
    });
  }
  if (production.score != null && target.nfl > 0) {
    parts.push({
      score: production.score,
      weight: target.nfl * production.confidence * sampleConfidence,
    });
  }

  const evidence = parts.reduce((sum, p) => sum + p.weight, 0);

  // A veteran with no NFL production is not an unknown quantity — the league
  // has had four or more years to play him and has not. Absence of production
  // at this stage is itself the result, so it anchors below average rather than
  // falling back to a workout the weight table says should not count.
  const isVeteran = input.yearsExperience >= COLLEGE_RELEVANCE_YEARS;
  const noRecentProduction = isVeteran && production.score == null;

  let composite: number;
  let appliedWeights: ComponentWeights;

  if (noRecentProduction) {
    composite = NO_PRODUCTION_ANCHOR;
    appliedWeights = { athletic: 0, college: 0, nfl: 0 };
  } else if (evidence <= 0) {
    // Nothing recorded anywhere.
    composite = NEUTRAL_PERCENTILE;
    appliedWeights = { athletic: 0, college: 0, nfl: 0 };
  } else {
    /*
     * Renormalizing alone would let a sliver of evidence speak with a full
     * voice — one elite drill and nothing else would round-trip to a 99. So
     * when total evidence falls short of EVIDENCE_FLOOR, the shortfall is
     * filled by the positional average. This is the only place a neutral prior
     * enters, and it applies to the composite rather than to any component, so
     * it never singles out the player for what they did not do.
     */
    const priorWeight = Math.max(0, EVIDENCE_FLOOR - evidence);
    const totalWeight = evidence + priorWeight;
    const weightedSum =
      parts.reduce((sum, p) => sum + p.score * p.weight, 0) +
      NEUTRAL_PERCENTILE * priorWeight;

    composite = weightedSum / totalWeight;
    const share = (w: number) => round(w / totalWeight, 3);
    appliedWeights = {
      athletic: share(
        athleticForComposite != null && target.athletic > 0
          ? target.athletic * athletic.confidence
          : 0,
      ),
      college: share(
        college.score != null && target.college > 0
          ? target.college * college.confidence * collegeSampleConfidence
          : 0,
      ),
      nfl: share(
        production.score != null && target.nfl > 0
          ? target.nfl * production.confidence * sampleConfidence
          : 0,
      ),
    };
  }

  const effectiveProductionWeight = appliedWeights.college + appliedWeights.nfl;

  return {
    playerId: input.playerId,
    name: input.name,
    position: input.position,
    cohort,
    team: input.team,
    age: input.age,
    yearsExperience: input.yearsExperience,
    athletic,
    college: { ...college, sampleConfidence: round(collegeSampleConfidence, 3) },
    production: { ...production, sampleConfidence: round(sampleConfidence, 3) },
    opportunities,
    /*
     * Qualification is reported separately from the score rather than folded
     * into it. A player with a dozen attempts is not bad, he is unmeasured, and
     * the two deserve different treatment: rankings sort qualified players
     * first, so a graded starter is never displaced by someone who barely
     * played.
     */
     qualified: production.score != null && sampleConfidence >= QUALIFYING_SAMPLE,
    starts: input.starts ?? 0,
    rankTier: rankTierFor(input.position, input.starts ?? 0),
    composite: round(composite),
    productionWeight: round(effectiveProductionWeight, 3),
    weights: {
      athletic: round(appliedWeights.athletic, 3),
      college: round(appliedWeights.college, 3),
      nfl: round(appliedWeights.nfl, 3),
    },
    athleticSignal: signal,
    lowSignalMeasurables: signal < 1,
    lowSignalProduction: LOW_SIGNAL_PRODUCTION.includes(input.position),
    noRecentProduction,
  };
}

/** Score and rank a set of players, highest composite first. */
export function rankPlayers(inputs: PlayerInput[], table: BaselineTable): PlayerScore[] {
  return inputs.map((input) => scorePlayer(input, table)).sort(compareForRanking);
}

/**
 * Board ordering: a graded player outranks an unmeasured one, a starter
 * outranks a backup at positions where the job is the point, and only then does
 * the composite decide.
 */
export function compareForRanking(a: PlayerScore, b: PlayerScore): number {
  if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
  if (a.rankTier !== b.rankTier) return a.rankTier - b.rankTier;
  return b.composite - a.composite;
}

/**
 * Build the baseline table from raw observations.
 *
 * `rows` are flat `{ position, metric, value }` triples; the builder emits both
 * position-level and cohort-level scopes so `resolveBaseline` has a fallback.
 * Rate metrics are expected to arrive already normalized.
 */
export function buildBaselines(
  rows: Array<{ position: Position; metric: string; value: number }>,
): BaselineTable {
  const buckets = new Map<string, Map<string, number[]>>();

  const push = (scope: string, metric: string, value: number) => {
    let byMetric = buckets.get(scope);
    if (!byMetric) {
      byMetric = new Map();
      buckets.set(scope, byMetric);
    }
    const list = byMetric.get(metric);
    if (list) list.push(value);
    else byMetric.set(metric, [value]);
  };

  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    push(`pos:${row.position}`, row.metric, row.value);
    push(`cohort:${cohortFor(row.position)}`, row.metric, row.value);
  }

  const table: BaselineTable = {};
  for (const [scope, byMetric] of buckets) {
    table[scope] = {};
    for (const [metric, values] of byMetric) {
      table[scope][metric] = {
        mean: mean(values),
        sd: stdDev(values),
        n: values.length,
      };
    }
  }
  return table;
}

export { RATE_METRICS };
