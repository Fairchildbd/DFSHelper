// In-memory, per-process, and therefore a speed bump rather than a wall: it
// resets on restart and does not coordinate across instances. It exists to make
// online password guessing slow enough to be pointless against a single box,
// which is the threat a single-instance API actually faces. Move it to Postgres
// or Redis the day this runs behind more than one process.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const SWEEP_EVERY = 500;

interface Attempts {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, Attempts>();
let sinceSweep = 0;

function sweep(now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

export function isThrottled(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string): void {
  const now = Date.now();

  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    sweep(now);
  }

  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
