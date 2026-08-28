
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
  turnover?: boolean;
}

export function isSuccessfulPlay(play: PlayOutcome): boolean | null {
  if (play.turnover) return false;
  if (play.touchdown) return true;

  const { down, yardsToGo, yardsGained } = play;
  if (down == null || yardsGained == null) return null;
  const threshold = SUCCESS_THRESHOLD_BY_DOWN[down];
  if (threshold == null) return null;

  const needed = yardsToGo != null && yardsToGo > 0 ? yardsToGo : 1;
  return yardsGained >= needed * threshold;
}

export interface MatchupCell {
  offense: string;
  defense: string;
  n: number;
  sum: number;
}

export interface TwoWayFit {
  league: number;
  offense: Map<string, number>;
  defense: Map<string, number>;
  delta: number;
  iterations: number;
}

export interface TwoWayOptions {
  shrinkage?: number;
  maxIterations?: number;
  tolerance?: number;
}

const DEFAULT_SHRINKAGE = 200;
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_TOLERANCE = 1e-6;

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

export const SEASON_DECAY = 0.5;

export interface SeasonValue {
  season: number;
  value: number;
  weight: number;
}

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
    const age = Math.max(0, latest - v.season);
    const w = v.weight * decay ** age;
    weighted += v.value * w;
    total += w;
  }
  return total > 0 ? weighted / total : null;
}

export function valueOverAverage(value: number, baseline: number): number | null {
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1e-6) return null;
  if (baseline <= 0) return null;
  return ((value - baseline) / baseline) * 100;
}
