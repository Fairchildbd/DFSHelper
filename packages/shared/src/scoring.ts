
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

export const MIN_BASELINE_N = 30;

export const FULL_PRODUCTION_GAMES = 8;

export const FULL_COLLEGE_SEASONS = 2;

export interface ComponentWeights {
  athletic: number;
  college: number;
  nfl: number;
}

const EXPERIENCE_WEIGHTS: ComponentWeights[] = [
  { athletic: 0.3, college: 0.7, nfl: 0.0 },
  { athletic: 0.2, college: 0.4, nfl: 0.4 },
  { athletic: 0.12, college: 0.22, nfl: 0.66 },
  { athletic: 0.06, college: 0.09, nfl: 0.85 },
];

const VETERAN_WEIGHTS: ComponentWeights = { athletic: 0, college: 0, nfl: 1 };

export const COLLEGE_RELEVANCE_YEARS = 4;

export function componentWeights(yearsExperience: number): ComponentWeights {
  const exp = Math.max(0, Math.floor(yearsExperience));
  return EXPERIENCE_WEIGHTS[exp] ?? VETERAN_WEIGHTS;
}

const NEUTRAL_PERCENTILE = 50;

export const NO_PRODUCTION_ANCHOR = 25;

export const EVIDENCE_FLOOR = 0.5;

interface ScopedBaseline {
  baseline: Baseline;
  scope: string;
}

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

  return {
    score: round(weightedSum / measuredWeight),
    confidence: round(measuredWeight / totalWeight, 3),
    metrics: scored,
  };
}

export function rankTierFor(position: Position, starts: number): number {
  if (!STARTER_TIERED_POSITIONS.includes(position)) return RANK_TIER.STARTER;
  if (starts >= FULL_TIME_STARTS) return RANK_TIER.STARTER;
  if (starts >= 1) return RANK_TIER.SPOT_STARTER;
  return RANK_TIER.NON_STARTER;
}

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

  const fullSample = FULL_SAMPLE_OPPORTUNITIES[input.position];
  const opportunities = input.opportunities ?? input.gamesPlayed;
  const sampleConfidence = clamp(opportunities / fullSample, 0, 1);
  const collegeSampleConfidence = clamp(
    (input.collegeSeasons ?? 0) / FULL_COLLEGE_SEASONS,
    0,
    1,
  );

  const signal = COHORT_ATHLETIC_SIGNAL[cohort];
  const athleticForComposite =
    athletic.score == null
      ? null
      : NEUTRAL_PERCENTILE + (athletic.score - NEUTRAL_PERCENTILE) * signal;

  const target = componentWeights(input.yearsExperience);

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

  const isVeteran = input.yearsExperience >= COLLEGE_RELEVANCE_YEARS;
  const noRecentProduction = isVeteran && production.score == null;

  let composite: number;
  let appliedWeights: ComponentWeights;

  if (noRecentProduction) {
    composite = NO_PRODUCTION_ANCHOR;
    appliedWeights = { athletic: 0, college: 0, nfl: 0 };
  } else if (evidence <= 0) {
    composite = NEUTRAL_PERCENTILE;
    appliedWeights = { athletic: 0, college: 0, nfl: 0 };
  } else {
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

export function rankPlayers(inputs: PlayerInput[], table: BaselineTable): PlayerScore[] {
  return inputs.map((input) => scorePlayer(input, table)).sort(compareForRanking);
}

export function compareForRanking(a: PlayerScore, b: PlayerScore): number {
  if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
  if (a.rankTier !== b.rankTier) return a.rankTier - b.rankTier;
  return b.composite - a.composite;
}

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
