
import type { Position } from './positions.js';
import { clamp, mean, normalCdf, stdDev } from './stats.js';

export type Side = 'offense' | 'defense';

export type TendencySource = 'coach' | 'team' | 'league';

export interface TendencyMetric {
  key: string;
  label: string;
  description: string;
  unit: 'pct' | 'rate' | 'seconds' | 'epa';
  higherIsBetter?: boolean | null;
}

export const OFFENSE_TENDENCIES: TendencyMetric[] = [
  { key: 'proe', label: 'Pass Rate Over Expected', description: 'Pass tendency once down, distance and score are controlled for', unit: 'pct' },
  { key: 'pass_rate_early', label: 'Early-Down Pass Rate', description: 'Pass share on 1st and 2nd down in neutral game state', unit: 'pct' },
  { key: 'sec_per_play', label: 'Seconds Per Play', description: 'Pace of play — lower means more snaps, more fantasy points', unit: 'seconds' },
  { key: 'shotgun_rate', label: 'Shotgun Rate', description: 'Share of snaps taken out of shotgun', unit: 'pct' },
  { key: 'no_huddle_rate', label: 'No-Huddle Rate', description: 'Share of snaps run without huddling', unit: 'pct' },
  { key: 'deep_rate', label: 'Deep Pass Rate', description: 'Share of throws travelling 15+ air yards', unit: 'pct' },
  { key: 'rz_pass_rate', label: 'Red-Zone Pass Rate', description: 'Pass share inside the opponent 20 — where touchdowns come from', unit: 'pct' },
  { key: 'run_outside_rate', label: 'Outside Run Rate', description: 'Share of carries off tackle rather than between the guards', unit: 'pct' },
  { key: 'play_action_rate', label: 'Play-Action Rate', description: 'Share of dropbacks using play action', unit: 'pct' },
  { key: 'motion_rate', label: 'Pre-Snap Motion Rate', description: 'Share of snaps with a man in motion', unit: 'pct' },
  { key: 'screen_rate', label: 'Screen Rate', description: 'Share of dropbacks thrown as screens', unit: 'pct' },
  { key: 'rpo_rate', label: 'RPO Rate', description: 'Share of snaps that are run-pass options', unit: 'pct' },
  { key: 'wr_target_share', label: 'WR Target Share', description: 'Share of this offense’s targets going to receivers', unit: 'pct' },
  { key: 'te_target_share', label: 'TE Target Share', description: 'Share of targets going to tight ends', unit: 'pct' },
  { key: 'rb_target_share', label: 'RB Target Share', description: 'Share of targets going to running backs', unit: 'pct' },
];

export const DEFENSE_TENDENCIES: TendencyMetric[] = [
  { key: 'blitz_rate', label: 'Blitz Rate', description: 'Share of dropbacks facing five or more rushers', unit: 'pct' },
  { key: 'pressure_rate', label: 'Pressure Rate', description: 'Share of dropbacks pressured, blitzing or not', unit: 'pct', higherIsBetter: true },
  { key: 'light_box_rate', label: 'Light Box Rate', description: 'Share of snaps with six or fewer in the box', unit: 'pct' },
  { key: 'heavy_box_rate', label: 'Heavy Box Rate', description: 'Share of snaps with eight or more in the box', unit: 'pct' },
  { key: 'epa_allowed_pass', label: 'EPA Allowed / Dropback', description: 'Expected points surrendered per pass play', unit: 'epa', higherIsBetter: false },
  { key: 'epa_allowed_rush', label: 'EPA Allowed / Rush', description: 'Expected points surrendered per run play', unit: 'epa', higherIsBetter: false },
  { key: 'explosive_allowed_rate', label: 'Explosive Play Rate Allowed', description: 'Share of plays surrendering 20+ yards', unit: 'pct', higherIsBetter: false },
  { key: 'pass_rate_faced', label: 'Pass Rate Faced', description: 'How pass-heavy opponents choose to be against this defense', unit: 'pct' },
];

export const TENDENCIES_BY_SIDE: Record<Side, TendencyMetric[]> = {
  offense: OFFENSE_TENDENCIES,
  defense: DEFENSE_TENDENCIES,
};

export function tendencyMetric(side: Side, key: string): TendencyMetric | undefined {
  return TENDENCIES_BY_SIDE[side].find((m) => m.key === key);
}

export interface DvpMetric {
  key: string;
  label: string;
  lowerIsBetter: boolean;
}

export const DVP_METRICS: DvpMetric[] = [
  { key: 'fp_allowed', label: 'PPR Points Allowed/G', lowerIsBetter: true },
  { key: 'yards_allowed', label: 'Yards Allowed/G', lowerIsBetter: true },
  { key: 'tds_allowed', label: 'TDs Allowed/G', lowerIsBetter: true },
  { key: 'targets_allowed', label: 'Targets Allowed/G', lowerIsBetter: true },
];

export const DVP_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export type LaneKey = 'qb_pass' | 'wr' | 'te' | 'rb_rush' | 'rb_recv' | 'ol_pass_pro';

export interface Lane {
  key: LaneKey;
  label: string;
  shortLabel: string;
  offensePositions: Position[];
  maxRank: number;
  dvpPosition: Position | null;
  usageMetric: string | null;
  defenseMetrics: string[];
  dvoaMetric: string | null;
  defensePositions: Position[];
}

export const LANES: Lane[] = [
  {
    key: 'qb_pass',
    label: 'Passing game',
    shortLabel: 'pass game',
    offensePositions: ['QB'],
    maxRank: 1,
    dvpPosition: 'QB',
    usageMetric: 'proe',
    defenseMetrics: ['pressure_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['CB', 'S'],
  },
  {
    key: 'wr',
    label: 'Receivers vs coverage',
    shortLabel: 'WRs',
    offensePositions: ['WR'],
    maxRank: 4,
    dvpPosition: 'WR',
    usageMetric: 'wr_target_share',
    defenseMetrics: ['explosive_allowed_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['CB', 'S'],
  },
  {
    key: 'te',
    label: 'Tight ends vs linebackers and safeties',
    shortLabel: 'TEs',
    offensePositions: ['TE'],
    maxRank: 2,
    dvpPosition: 'TE',
    usageMetric: 'te_target_share',
    defenseMetrics: ['explosive_allowed_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['LB', 'S'],
  },
  {
    key: 'rb_rush',
    label: 'Run game vs front seven',
    shortLabel: 'run game',
    offensePositions: ['RB', 'FB'],
    maxRank: 2,
    dvpPosition: 'RB',
    usageMetric: null,
    defenseMetrics: ['heavy_box_rate'],
    dvoaMetric: 'epa_allowed_rush_adj',
    defensePositions: ['DT', 'DE', 'EDGE', 'LB'],
  },
  {
    key: 'rb_recv',
    label: 'Backs in the passing game',
    shortLabel: 'pass-catching backs',
    offensePositions: ['RB'],
    maxRank: 2,
    dvpPosition: 'RB',
    usageMetric: 'rb_target_share',
    defenseMetrics: ['blitz_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['LB'],
  },
  {
    key: 'ol_pass_pro',
    label: 'Pass protection vs rush',
    shortLabel: 'pass protection',
    offensePositions: ['OT', 'OG', 'C'],
    maxRank: 5,
    dvpPosition: null,
    usageMetric: null,
    defenseMetrics: ['pressure_rate', 'blitz_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['EDGE', 'DE', 'DT'],
  },
];

export const LANES_BY_KEY: Record<LaneKey, Lane> = Object.fromEntries(
  LANES.map((l) => [l.key, l]),
) as Record<LaneKey, Lane>;

export function laneForPosition(position: Position): LaneKey | null {
  switch (position) {
    case 'QB': return 'qb_pass';
    case 'WR': return 'wr';
    case 'TE': return 'te';
    case 'RB': case 'FB': return 'rb_rush';
    case 'OT': case 'OG': case 'C': return 'ol_pass_pro';
    default: return null;
  }
}

export function roleWeight(posRank: number | null | undefined, maxRank: number): number {
  const rank = posRank == null || posRank < 1 ? maxRank : posRank;
  return 0.5 ** (rank - 1);
}

export interface LaneEdgeInput {
  lane: Lane;
  offenseStrength: number | null;
  defenseStrength: number | null;
  usagePercentile?: number | null;
}

export interface LaneEdge {
  lane: LaneKey;
  label: string;
  offense?: string;
  defense?: string;
  offenseStrength: number | null;
  defenseStrength: number | null;
  edge: number | null;
  usageAdjustment: number;
}

export const MAX_USAGE_ADJUSTMENT = 10;

export function computeLaneEdge(input: LaneEdgeInput): LaneEdge {
  const { lane, offenseStrength, defenseStrength } = input;

  if (offenseStrength == null || defenseStrength == null) {
    return {
      lane: lane.key,
      label: lane.label,
      offenseStrength,
      defenseStrength,
      edge: null,
      usageAdjustment: 0,
    };
  }

  const usage = input.usagePercentile;
  const usageAdjustment =
    usage == null ? 0 : ((usage - 50) / 50) * MAX_USAGE_ADJUSTMENT;

  const raw = offenseStrength - defenseStrength + usageAdjustment;

  return {
    lane: lane.key,
    label: lane.label,
    offenseStrength,
    defenseStrength,
    edge: clamp(raw, -100, 100),
    usageAdjustment,
  };
}

export const MAX_QB_RUSH_ADJUSTMENT = 12;

export const QB_POCKET_CARRIES = 2;

export const QB_RUNNER_CARRIES = 8;

export function qbRushAdjustment(
  carriesPerGame: number | null | undefined,
  runSuppression: number | null | undefined,
): number {
  if (carriesPerGame == null || runSuppression == null) return 0;

  const lean = clamp(
    (carriesPerGame - QB_POCKET_CARRIES) / (QB_RUNNER_CARRIES - QB_POCKET_CARRIES),
    0,
    1,
  );
  const opportunity = clamp((50 - runSuppression) / 50, -1, 1);

  return lean * opportunity * MAX_QB_RUSH_ADJUSTMENT;
}

export const EDGE_THRESHOLD = 45;

export const TOP_EDGES = 4;

export const DEFENSE_EDGE_WEIGHT = 0.45;

export function edgeWeight(edge: number): number {
  return edge >= 0 ? edge : -edge * DEFENSE_EDGE_WEIGHT;
}

export interface EdgeAggregate {
  edgeScore: number;
  edgeCount: number;
  top: LaneEdge | null;
  graded: number;
}

export function aggregateEdges(edges: LaneEdge[]): EdgeAggregate {
  const graded = edges.filter((e) => e.edge != null);
  if (graded.length === 0) {
    return { edgeScore: 0, edgeCount: 0, top: null, graded: 0 };
  }

  const byWeight = [...graded].sort(
    (a, b) => edgeWeight(b.edge!) - edgeWeight(a.edge!),
  );
  const top = byWeight.slice(0, TOP_EDGES);
  const meanSquare =
    top.reduce((acc, e) => acc + edgeWeight(e.edge!) ** 2, 0) / top.length;

  return {
    edgeScore: clamp(Math.sqrt(meanSquare), 0, 100),
    edgeCount: graded.filter((e) => edgeWeight(e.edge!) >= EDGE_THRESHOLD).length,
    top: byWeight[0] ?? null,
    graded: graded.length,
  };
}

export const NEUTRAL_TOTAL = 44.5;
export const TOTAL_RANGE = 10.5;

export const SHOOTOUT_TOTAL_FLOOR = 38;

export const SHOOTOUT_TOTAL_CEILING = 52;

export const WEAKER_OFFENSE_WEIGHT = 0.6;

export const LEAN_TOLERANCE = 10;

export const SHOOTOUT_WEIGHTS = {
  total: 0.4,
  offense: 0.25,
  defense: 0.2,
  pace: 0.15,
} as const;

export interface ShootoutInput {
  edges: LaneEdge[];
  totalLine: number | null;
  pacePercentile?: number | null;
}

export type GameShape = 'shootout' | 'one_sided' | 'low_scoring' | 'defensive';

export const LIVE_GAME_FLOOR = 50;

export const STRONG_DEFENSE_CEILING = 40;

export interface Shootout {
  score: number;
  shape: GameShape;
  applied: boolean;
  components: {
    total: number | null;
    offense: number | null;
    defense: number | null;
    pace: number | null;
  };
  leanTeam: string | null;
  lean: number;
}

interface TeamOffense {
  team: string;
  strength: number;
}

function offenseByTeam(edges: LaneEdge[]): TeamOffense[] {
  const book = new Map<string, number[]>();
  for (const edge of edges) {
    if (edge.offenseStrength == null) continue;
    const key = edge.offense ?? '';
    const bucket = book.get(key);
    if (bucket) bucket.push(edge.offenseStrength);
    else book.set(key, [edge.offenseStrength]);
  }
  return [...book].map(([team, values]) => ({ team, strength: mean(values) }));
}

export function computeShootout(input: ShootoutInput): Shootout {
  const offenses = offenseByTeam(input.edges).sort((a, b) => b.strength - a.strength);
  const strongest = offenses[0] ?? null;
  const weakest = offenses.length > 1 ? offenses[offenses.length - 1]! : strongest;

  const offense =
    strongest == null || weakest == null
      ? null
      : WEAKER_OFFENSE_WEIGHT * weakest.strength +
        (1 - WEAKER_OFFENSE_WEIGHT) * strongest.strength;

  const suppression = input.edges
    .map((e) => e.defenseStrength)
    .filter((v): v is number => v != null);
  const defense = suppression.length === 0 ? null : 100 - mean(suppression);

  const total =
    input.totalLine == null || !Number.isFinite(input.totalLine)
      ? null
      : clamp(
          ((input.totalLine - SHOOTOUT_TOTAL_FLOOR) /
            (SHOOTOUT_TOTAL_CEILING - SHOOTOUT_TOTAL_FLOOR)) *
            100,
          0,
          100,
        );

  const pace = input.pacePercentile ?? null;

  const parts: Array<[number | null, number]> = [
    [total, SHOOTOUT_WEIGHTS.total],
    [offense, SHOOTOUT_WEIGHTS.offense],
    [defense, SHOOTOUT_WEIGHTS.defense],
    [pace, SHOOTOUT_WEIGHTS.pace],
  ];
  let weighted = 0;
  let weight = 0;
  for (const [value, share] of parts) {
    if (value == null) continue;
    weighted += value * share;
    weight += share;
  }

  const lean = strongest && weakest ? strongest.strength - weakest.strength : 0;

  const score = weight > 0 ? clamp(weighted / weight, 0, 100) : 0;
  const leanTeam =
    strongest && strongest.team && lean >= LEAN_TOLERANCE ? strongest.team : null;

  return {
    score,
    shape: classifyGame(score, leanTeam, defense),
    applied: total != null,
    components: { total, offense, defense, pace },
    leanTeam,
    lean,
  };
}

export function classifyGame(
  score: number,
  leanTeam: string | null,
  defenseComponent: number | null,
): GameShape {
  if (score >= LIVE_GAME_FLOOR) return leanTeam == null ? 'shootout' : 'one_sided';
  if (defenseComponent != null && defenseComponent <= STRONG_DEFENSE_CEILING) {
    return 'defensive';
  }
  return 'low_scoring';
}

export interface MismatchInput {
  edges: LaneEdge[];
  totalLine: number | null;
  pacePercentile?: number | null;
}

export interface Mismatch extends EdgeAggregate {
  mismatchScore: number;
  shootout: Shootout;
}

export function computeMismatch(input: MismatchInput): Mismatch {
  const aggregate = aggregateEdges(input.edges);

  return {
    ...aggregate,
    mismatchScore: aggregate.edgeScore,
    shootout: computeShootout(input),
  };
}

export interface MatchupFactor {
  key: 'composite' | 'lane_edge' | 'volume';
  label: string;
  value: number | null;
  weight: number;
  note: string;
}

export interface PlayerMatchupInput {
  composite: number | null;
  laneEdge: number | null;
  volume: number | null;
}

export interface PlayerMatchupScore {
  score: number;
  confidence: number;
  factors: MatchupFactor[];
}

export const FACTOR_WEIGHTS = { composite: 0.3, lane_edge: 0.4, volume: 0.3 } as const;

export function edgeToScale(edge: number): number {
  return clamp(50 + edge / 2, 0, 100);
}

export function gradePlayerMatchup(input: PlayerMatchupInput): PlayerMatchupScore {
  const factors: MatchupFactor[] = [
    {
      key: 'composite',
      label: 'Player quality',
      value: input.composite,
      weight: FACTOR_WEIGHTS.composite,
      note: 'Season-long ranking composite',
    },
    {
      key: 'lane_edge',
      label: 'Matchup edge',
      value: input.laneEdge == null ? null : edgeToScale(input.laneEdge),
      weight: FACTOR_WEIGHTS.lane_edge,
      note: 'His unit against this opponent',
    },
    {
      key: 'volume',
      label: 'Projected volume',
      value: input.volume,
      weight: FACTOR_WEIGHTS.volume,
      note: 'Scheme pace and target share for his role',
    },
  ];

  const present = factors.filter((f) => f.value != null);
  const totalWeight = present.reduce((acc, f) => acc + f.weight, 0);

  if (totalWeight === 0) {
    return {
      score: 50,
      confidence: 0,
      factors: factors.map((f) => ({ ...f, weight: 0 })),
    };
  }

  const score = present.reduce((acc, f) => acc + f.value! * (f.weight / totalWeight), 0);

  return {
    score: clamp(score, 0, 100),
    confidence: totalWeight,
    factors: factors.map((f) => ({
      ...f,
      weight: f.value == null ? 0 : f.weight / totalWeight,
    })),
  };
}

export const MIN_COACH_GAMES = 8;

export interface TendencyCandidate {
  source: TendencySource;
  values: Record<string, number>;
  nGames: number;
}

export interface ResolvedTendencies {
  source: TendencySource;
  values: Record<string, number>;
  nGames: number;
  confidence: number;
}

const SOURCE_CONFIDENCE: Record<TendencySource, number> = {
  coach: 1,
  team: 0.5,
  league: 0,
};

export function resolveTendencies(
  candidates: TendencyCandidate[],
): ResolvedTendencies | null {
  const order: TendencySource[] = ['coach', 'team', 'league'];

  for (const source of order) {
    const candidate = candidates.find(
      (c) =>
        c.source === source &&
        Object.keys(c.values).length > 0 &&
        (source !== 'coach' || c.nGames >= MIN_COACH_GAMES),
    );
    if (!candidate) continue;

    const sampleFactor =
      source === 'coach' ? clamp(candidate.nGames / 34, 0.5, 1) : 1;

    return {
      source,
      values: candidate.values,
      nGames: candidate.nGames,
      confidence: SOURCE_CONFIDENCE[source] * sampleFactor,
    };
  }

  return null;
}

export interface Distribution {
  mean: number;
  sd: number;
  n: number;
}

export function buildDistributions(
  rows: Array<{ metric: string; value: number }>,
): Record<string, Distribution> {
  const byMetric = new Map<string, number[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    const list = byMetric.get(row.metric);
    if (list) list.push(row.value);
    else byMetric.set(row.metric, [row.value]);
  }

  const out: Record<string, Distribution> = {};
  for (const [metric, values] of byMetric) {
    out[metric] = { mean: mean(values), sd: stdDev(values), n: values.length };
  }
  return out;
}

export const MIN_DISTRIBUTION_N = 8;

export function percentileOf(
  value: number | null | undefined,
  dist: Distribution | undefined,
  lowerIsBetter = false,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!dist || dist.n < MIN_DISTRIBUTION_N || dist.sd <= 0) return null;

  const z = (value - dist.mean) / dist.sd;
  return clamp(normalCdf(lowerIsBetter ? -z : z) * 100, 0, 100);
}
