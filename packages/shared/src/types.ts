import type { Cohort, Drill, Position } from './positions.js';

/** A player's measurable results. Any drill may be absent — most are. */
export type Measurables = Partial<Record<Drill, number>>;

/** Where a set of measurables came from. Combine and pro day are not equivalent. */
export type MeasurableSource = 'combine' | 'pro_day' | 'manual';

/**
 * Mean/standard deviation for one metric within one scope, precomputed at
 * ingest so the scoring engine stays pure arithmetic and can run on-device.
 */
export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

/**
 * Baselines keyed by scope, where a scope is either `pos:WR` or `cohort:SPEED`.
 * The engine prefers the position-level scope and falls back to the cohort when
 * a position lacks the sample size to be trustworthy on its own.
 */
export type BaselineTable = Record<string, Record<string, Baseline>>;

/** Per-game production rates, already divided by games played. */
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
  /** Per-game production rates over the scoring window. */
  production: ProductionRates;
  /** Games in the production window. Used for display, and as the sample unit
   * for positions with no opportunity counter. */
  gamesPlayed: number;
  /**
   * Position-appropriate opportunities in the window — pass attempts, touches,
   * or targets. This, not games, gates how far production is trusted.
   */
  opportunities?: number;
  /** Games started in the window. Only used at starter-gated positions (QB). */
  starts?: number;
  /**
   * Per-game college production rates, keyed with a `cfb_` prefix.
   * Only consulted for a player's first three professional seasons.
   */
  collegeProduction?: ProductionRates;
  /** College seasons of record — drives college sample confidence. */
  collegeSeasons?: number;
}

/** One drill or production metric after conversion to a percentile. */
export interface MetricScore {
  metric: string;
  label: string;
  raw: number | null;
  /** 0-100 within the player's comparison scope. Null when unmeasured. */
  percentile: number | null;
  /** Share of the component score this metric was worth. */
  weight: number;
  /** Scope actually used, e.g. `pos:WR`. Null when unmeasured. */
  scope: string | null;
}

export interface ComponentScore {
  /**
   * 0-100 across the metrics actually recorded. Never adjusted for what is
   * missing — uncertainty is expressed as reduced weight in the composite, so
   * that absent data is neutral rather than a penalty.
   */
  score: number | null;
  /** Share of this component's metric weight that was actually measured, 0-1. */
  confidence: number;
  /**
   * For production only: how much of a full sample the games played represent.
   * The score above is already shrunk by this, so a one-game cameo cannot post
   * an elite per-game rate.
   */
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
  /** College production. Empty once a player is four seasons into the NFL. */
  college: ComponentScore;
  production: ComponentScore;

  /** 0-100 blend of athletic and production. */
  composite: number;
  /** Combined share of `composite` from college + NFL stats, 0-1. */
  productionWeight: number;
  /** Actual per-component shares of `composite` after renormalization. */
  weights: { athletic: number; college: number; nfl: number };
  /** How much this cohort's measurables were allowed to move the composite. */
  athleticSignal: number;
  /** Opportunities behind the production score. */
  opportunities: number;
  /**
   * Whether the production sample is large enough to rank this player against
   * qualified players. False means unmeasured, not bad.
   */
  qualified: boolean;
  /** Games started in the window. */
  starts: number;
  /**
   * Sort tier applied before the composite. Always 0 except at starter-gated
   * positions, where a backup sorts below every starter regardless of score.
   */
  rankTier: number;
  /** True when the position's combine drills carry little real signal (QB). */
  lowSignalMeasurables: boolean;
  /** True when the only available production data does not grade play quality (OL). */
  lowSignalProduction: boolean;
  /**
   * True for a veteran with no NFL production in the scoring window. Their
   * composite is an inference from absence, not a measurement — the UI should
   * say so rather than presenting it as a graded score.
   */
  noRecentProduction: boolean;
}
