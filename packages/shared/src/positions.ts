/**
 * Position taxonomy and drill weighting.
 *
 * Raw NFL position labels are messy and inconsistent across sources (nflverse
 * combine data alone uses OT/OG/OL/C/G/T for the offensive line). Everything
 * funnels through `normalizePosition` into a small set of scoring cohorts, and
 * each cohort carries the drill weights that define what athleticism means for
 * that job.
 */

/** Canonical position after cleanup. */
export type Position =
  | 'QB' | 'RB' | 'FB' | 'WR' | 'TE'
  | 'OT' | 'OG' | 'C'
  | 'DT' | 'DE' | 'EDGE' | 'LB'
  | 'CB' | 'S'
  | 'K' | 'P' | 'LS';

/**
 * Scoring cohorts. Percentiles are always computed *within* a cohort, so a
 * guard is measured against guards and never against receivers.
 */
export type Cohort =
  | 'OL'      // offensive line: cone, bench, broad
  | 'DL'      // interior + edge defenders: cone, bench, broad
  | 'POWER'   // RB / LB / FB / TE: bench, broad, forty, shuttle, vertical
  | 'SPEED'   // WR / CB / S: vertical, shuttle, cone, forty
  | 'QB'      // production-driven; combine drills are near-noise
  | 'SPEC';   // K/P/LS — excluded from athletic scoring entirely

export const COHORT_LABELS: Record<Cohort, string> = {
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  POWER: 'Power / Hybrid',
  SPEED: 'Speed / Coverage',
  QB: 'Quarterback',
  SPEC: 'Specialist',
};

/** The six measurable drills carried in combine data. */
export type Drill = 'forty' | 'bench' | 'vertical' | 'broad' | 'cone' | 'shuttle';

export const ALL_DRILLS: Drill[] = ['forty', 'bench', 'vertical', 'broad', 'cone', 'shuttle'];

export const DRILL_LABELS: Record<Drill, string> = {
  forty: '40-Yard Dash',
  bench: 'Bench Press',
  vertical: 'Vertical Jump',
  broad: 'Broad Jump',
  cone: '3-Cone Drill',
  shuttle: '20-Yard Shuttle',
};

export const DRILL_UNITS: Record<Drill, string> = {
  forty: 's',
  bench: 'reps',
  vertical: 'in',
  broad: 'in',
  cone: 's',
  shuttle: 's',
};

/**
 * Drills where a *lower* raw number is better. Used to flip the z-score so
 * every drill ends up on a consistent "higher percentile = better" scale.
 */
export const LOWER_IS_BETTER: Record<Drill, boolean> = {
  forty: true,
  cone: true,
  shuttle: true,
  bench: false,
  vertical: false,
  broad: false,
};

/**
 * Per-cohort drill weights. Each cohort's weights sum to 1.0 so the weighted
 * blend lands back on a 0-100 scale without extra bookkeeping.
 *
 * A drill absent from a cohort's map contributes nothing — it isn't scored as
 * zero, it simply isn't part of that position's definition of athleticism.
 */
export const COHORT_WEIGHTS: Record<Cohort, Partial<Record<Drill, number>>> = {
  // Linemen live in short areas: change of direction, functional strength, and
  // lower-body explosion off the snap.
  OL: { cone: 0.4, bench: 0.3, broad: 0.3 },
  DL: { cone: 0.4, bench: 0.3, broad: 0.3 },

  // Backs and linebackers need to run, hit, and redirect in traffic.
  POWER: { bench: 0.2, broad: 0.2, forty: 0.25, shuttle: 0.15, vertical: 0.2 },

  // Receivers and defensive backs win with agility, ball-skill explosion, and
  // long speed. Bench is deliberately absent — it carries no signal here.
  SPEED: { vertical: 0.25, shuttle: 0.25, cone: 0.25, forty: 0.25 },

  // Quarterbacks are graded on production. The combine drills that exist in the
  // public record (no throwing-velocity or accuracy data) only proxy mobility,
  // so they are kept at low weight and flagged as low-signal downstream.
  QB: { forty: 0.6, broad: 0.4 },

  SPEC: {},
};

/**
 * How much a cohort's measurables are allowed to move its composite score.
 *
 * For most positions the drills are the real thing being measured, so this is
 * 1. Quarterbacks are the exception: the public combine record holds no
 * throwing data, so a 40 time and a broad jump describe a QB's mobility and
 * nothing about whether they can play. Without this cap an unproven but fast
 * quarterback outranks every established starter purely on wheels — which is
 * exactly the failure the production floor was meant to prevent, but the floor
 * cannot fire for a player who has no production at all.
 */
export const COHORT_ATHLETIC_SIGNAL: Record<Cohort, number> = {
  QB: 0.3,
  OL: 1,
  DL: 1,
  POWER: 1,
  SPEED: 1,
  SPEC: 1,
};

const POSITION_ALIASES: Record<string, Position> = {
  QB: 'QB',
  RB: 'RB', HB: 'RB', TB: 'RB',
  FB: 'FB',
  WR: 'WR', SE: 'WR', FL: 'WR',
  TE: 'TE',
  OT: 'OT', T: 'OT', LT: 'OT', RT: 'OT',
  OG: 'OG', G: 'OG', LG: 'OG', RG: 'OG',
  C: 'C',
  OL: 'OG', // ambiguous interior/tackle label — default to guard
  DT: 'DT', NT: 'DT', DL: 'DT', LDT: 'DT', RDT: 'DT',
  DE: 'DE', LDE: 'DE', RDE: 'DE',
  EDGE: 'EDGE', OLB: 'EDGE', // nflverse tags most edge rushers OLB pre-2019
  LB: 'LB', ILB: 'LB', MLB: 'LB',
  // Depth charts name linebackers by alignment: weak side, strong side, and
  // left/right inside. All are the same job for scoring purposes.
  WLB: 'LB', SLB: 'LB', LILB: 'LB', RILB: 'LB',
  CB: 'CB', DB: 'CB', LCB: 'CB', RCB: 'CB', NB: 'CB',
  S: 'S', FS: 'S', SS: 'S', SAF: 'S',
  K: 'K', PK: 'K',
  P: 'P',
  LS: 'LS',
};

/** Map a raw position string from any feed onto the canonical set. */
export function normalizePosition(raw: string | null | undefined): Position | null {
  if (!raw) return null;
  return POSITION_ALIASES[raw.trim().toUpperCase()] ?? null;
}

const POSITION_COHORTS: Record<Position, Cohort> = {
  QB: 'QB',
  RB: 'POWER', FB: 'POWER', TE: 'POWER', LB: 'POWER',
  WR: 'SPEED', CB: 'SPEED', S: 'SPEED',
  OT: 'OL', OG: 'OL', C: 'OL',
  DT: 'DL', DE: 'DL', EDGE: 'DL',
  K: 'SPEC', P: 'SPEC', LS: 'SPEC',
};

export function cohortFor(position: Position): Cohort {
  return POSITION_COHORTS[position];
}

/** Cohorts we actually produce rankings for. */
export const RANKABLE_COHORTS: Cohort[] = ['QB', 'POWER', 'SPEED', 'OL', 'DL'];

export function isRankable(position: Position): boolean {
  return cohortFor(position) !== 'SPEC';
}
