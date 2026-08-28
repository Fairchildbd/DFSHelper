
export type Position =
  | 'QB' | 'RB' | 'FB' | 'WR' | 'TE'
  | 'OT' | 'OG' | 'C'
  | 'DT' | 'DE' | 'EDGE' | 'LB'
  | 'CB' | 'S'
  | 'K' | 'P' | 'LS';

export type Cohort =
  | 'OL'
  | 'DL'
  | 'POWER'
  | 'SPEED'
  | 'QB'
  | 'SPEC';

export const COHORT_LABELS: Record<Cohort, string> = {
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  POWER: 'Power / Hybrid',
  SPEED: 'Speed / Coverage',
  QB: 'Quarterback',
  SPEC: 'Specialist',
};

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

export const LOWER_IS_BETTER: Record<Drill, boolean> = {
  forty: true,
  cone: true,
  shuttle: true,
  bench: false,
  vertical: false,
  broad: false,
};

export const COHORT_WEIGHTS: Record<Cohort, Partial<Record<Drill, number>>> = {
  OL: { cone: 0.4, bench: 0.3, broad: 0.3 },
  DL: { cone: 0.4, bench: 0.3, broad: 0.3 },

  POWER: { bench: 0.2, broad: 0.2, forty: 0.25, shuttle: 0.15, vertical: 0.2 },

  SPEED: { vertical: 0.25, shuttle: 0.25, cone: 0.25, forty: 0.25 },

  QB: { forty: 0.6, broad: 0.4 },

  SPEC: {},
};

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
  OL: 'OG',
  DT: 'DT', NT: 'DT', DL: 'DT', LDT: 'DT', RDT: 'DT',
  DE: 'DE', LDE: 'DE', RDE: 'DE',
  EDGE: 'EDGE', OLB: 'EDGE',
  LB: 'LB', ILB: 'LB', MLB: 'LB',
  WLB: 'LB', SLB: 'LB', LILB: 'LB', RILB: 'LB',
  CB: 'CB', DB: 'CB', LCB: 'CB', RCB: 'CB', NB: 'CB',
  S: 'S', FS: 'S', SS: 'S', SAF: 'S',
  K: 'K', PK: 'K',
  P: 'P',
  LS: 'LS',
};

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

export const RANKABLE_COHORTS: Cohort[] = ['QB', 'POWER', 'SPEED', 'OL', 'DL'];

export function isRankable(position: Position): boolean {
  return cohortFor(position) !== 'SPEC';
}
