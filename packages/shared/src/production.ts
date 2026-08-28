
import type { Position } from './positions.js';

export interface ProductionMetric {
  key: string;
  label: string;
  weight: number;
  lowerIsBetter?: boolean;
  isRate?: boolean;
}

const QB: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.33 },
  { key: 'adj_passing_epa_per_dropback', label: 'Adj. EPA/Dropback', weight: 0.26, isRate: true },
  { key: 'adj_passing_success_rate', label: 'Adj. Success Rate', weight: 0.1, isRate: true },
  { key: 'passing_first_downs', label: 'Passing 1st Downs/G', weight: 0.08 },
  { key: 'rushing_points', label: 'Rushing Points/G', weight: 0.15 },
  { key: 'interception_rate', label: 'INT Rate', weight: 0.08, lowerIsBetter: true, isRate: true },
];

const RB: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.42 },
  { key: 'adj_rushing_epa_per_carry', label: 'Adj. EPA/Carry', weight: 0.17, isRate: true },
  { key: 'adj_rushing_success_rate', label: 'Adj. Success Rate', weight: 0.11, isRate: true },
  { key: 'rushing_yards', label: 'Rush Yards/G', weight: 0.12 },
  { key: 'receptions', label: 'Receptions/G', weight: 0.18 },
];

const RECEIVER: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.37 },
  { key: 'target_share', label: 'Target Share', weight: 0.19, isRate: true },
  { key: 'adj_receiving_epa_per_tgt', label: 'Adj. EPA/Target', weight: 0.17, isRate: true },
  { key: 'adj_receiving_success_rate', label: 'Adj. Success Rate', weight: 0.1, isRate: true },
  { key: 'receiving_yards', label: 'Rec Yards/G', weight: 0.17 },
];

const LB: ProductionMetric[] = [
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.35 },
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.2 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.2 },
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.15 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.1 },
];

const PASS_RUSHER: ProductionMetric[] = [
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.35 },
  { key: 'def_qb_hits', label: 'QB Hits/G', weight: 0.25 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.25 },
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.15 },
];

const CB: ProductionMetric[] = [
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.35 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.25 },
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.25 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.15 },
];

const SAFETY: ProductionMetric[] = [
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.3 },
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.25 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.2 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.15 },
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.1 },
];

const OL: ProductionMetric[] = [
  { key: 'snap_pct', label: 'Snap Share', weight: 1, isRate: true },
];

export const PRODUCTION_METRICS: Record<Position, ProductionMetric[]> = {
  QB,
  RB, FB: RB,
  WR: RECEIVER, TE: RECEIVER,
  LB,
  DE: PASS_RUSHER, EDGE: PASS_RUSHER, DT: PASS_RUSHER,
  CB,
  S: SAFETY,
  OT: OL, OG: OL, C: OL,
  K: [], P: [], LS: [],
};

export const LOW_SIGNAL_PRODUCTION: Position[] = ['OT', 'OG', 'C'];

export const FULL_SAMPLE_OPPORTUNITIES: Record<Position, number> = {
  QB: 250,
  RB: 120, FB: 120,
  WR: 60, TE: 60,
  LB: 8, DE: 8, EDGE: 8, DT: 8,
  CB: 8, S: 8,
  OT: 8, OG: 8, C: 8,
  K: 8, P: 8, LS: 8,
};

export const OPPORTUNITY_UNIT: Record<Position, string> = {
  QB: 'attempts',
  RB: 'touches', FB: 'touches',
  WR: 'targets', TE: 'targets',
  LB: 'games', DE: 'games', EDGE: 'games', DT: 'games',
  CB: 'games', S: 'games',
  OT: 'games', OG: 'games', C: 'games',
  K: 'games', P: 'games', LS: 'games',
};

export const QUALIFYING_SAMPLE = 0.25;

export const STARTER_TIERED_POSITIONS: Position[] = ['QB'];

export const FULL_TIME_STARTS = 8;

export const RANK_TIER = {
  STARTER: 0,
  SPOT_STARTER: 1,
  NON_STARTER: 2,
} as const;

const CFB_QB: ProductionMetric[] = [
  { key: 'cfb_passing_yards', label: 'Pass Yards (best yr)', weight: 0.35 },
  { key: 'cfb_passing_tds', label: 'Pass TD (best yr)', weight: 0.3 },
  { key: 'cfb_completion_pct', label: 'Completion %', weight: 0.2, isRate: true },
  { key: 'cfb_interceptions', label: 'INT per Attempt', weight: 0.15, lowerIsBetter: true, isRate: true },
];

const CFB_RB: ProductionMetric[] = [
  { key: 'cfb_rushing_yards', label: 'Rush Yards (best yr)', weight: 0.4 },
  { key: 'cfb_rushing_tds', label: 'Rush TD (best yr)', weight: 0.25 },
  { key: 'cfb_yards_per_carry', label: 'Yards per Carry', weight: 0.2, isRate: true },
  { key: 'cfb_receptions', label: 'Receptions (best yr)', weight: 0.15 },
];

const CFB_RECEIVER: ProductionMetric[] = [
  { key: 'cfb_receiving_yards', label: 'Rec Yards (best yr)', weight: 0.4 },
  { key: 'cfb_receiving_tds', label: 'Rec TD (best yr)', weight: 0.25 },
  { key: 'cfb_receptions', label: 'Receptions (best yr)', weight: 0.2 },
  { key: 'cfb_yards_per_reception', label: 'Yards per Catch', weight: 0.15, isRate: true },
];

const CFB_LB: ProductionMetric[] = [
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.4 },
  { key: 'cfb_tackles_for_loss', label: 'TFL (best yr)', weight: 0.25 },
  { key: 'cfb_sacks', label: 'Sacks (best yr)', weight: 0.2 },
  { key: 'cfb_pass_defended', label: 'Passes Defended (best yr)', weight: 0.15 },
];

const CFB_PASS_RUSHER: ProductionMetric[] = [
  { key: 'cfb_sacks', label: 'Sacks (best yr)', weight: 0.4 },
  { key: 'cfb_tackles_for_loss', label: 'TFL (best yr)', weight: 0.35 },
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.25 },
];

const CFB_DB: ProductionMetric[] = [
  { key: 'cfb_pass_defended', label: 'Passes Defended (best yr)', weight: 0.35 },
  { key: 'cfb_interceptions_def', label: 'Interceptions (best yr)', weight: 0.3 },
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.35 },
];

const CFB_NONE: ProductionMetric[] = [];

export const COLLEGE_PRODUCTION_METRICS: Record<Position, ProductionMetric[]> = {
  QB: CFB_QB,
  RB: CFB_RB, FB: CFB_RB,
  WR: CFB_RECEIVER, TE: CFB_RECEIVER,
  LB: CFB_LB,
  DE: CFB_PASS_RUSHER, EDGE: CFB_PASS_RUSHER, DT: CFB_PASS_RUSHER,
  CB: CFB_DB, S: CFB_DB,
  OT: CFB_NONE, OG: CFB_NONE, C: CFB_NONE,
  K: CFB_NONE, P: CFB_NONE, LS: CFB_NONE,
};

export const RATE_METRICS = new Set<string>(
  Object.values(PRODUCTION_METRICS)
    .flat()
    .filter((m) => m.isRate)
    .map((m) => m.key),
);
