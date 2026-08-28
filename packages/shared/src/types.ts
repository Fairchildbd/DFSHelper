import type { Cohort, Drill, Position } from './positions.js';

export type Measurables = Partial<Record<Drill, number>>;

export type MeasurableSource = 'combine' | 'pro_day' | 'manual';

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

export type BaselineTable = Record<string, Record<string, Baseline>>;

export type ProductionRates = Record<string, number | null>;

export interface PlayerInput {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  yearsExperience: number;
  measurables: Measurables;
  measurableSource: MeasurableSource | null;
  production: ProductionRates;
  gamesPlayed: number;
  opportunities?: number;
  starts?: number;
  collegeProduction?: ProductionRates;
  collegeSeasons?: number;
}

export interface MetricScore {
  metric: string;
  label: string;
  raw: number | null;
  percentile: number | null;
  weight: number;
  scope: string | null;
}

export interface ComponentScore {
  score: number | null;
  confidence: number;
  sampleConfidence?: number;
  metrics: MetricScore[];
}

export interface PlayerScore {
  playerId: string;
  name: string;
  position: Position;
  cohort: Cohort;
  team: string | null;
  age: number | null;
  yearsExperience: number;

  athletic: ComponentScore;
  college: ComponentScore;
  production: ComponentScore;

  composite: number;
  productionWeight: number;
  weights: { athletic: number; college: number; nfl: number };
  athleticSignal: number;
  opportunities: number;
  qualified: boolean;
  starts: number;
  rankTier: number;
  lowSignalMeasurables: boolean;
  lowSignalProduction: boolean;
  noRecentProduction: boolean;
}
