import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repo keeps one .env at the root rather than one per workspace.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return value;
}

export const DATABASE_URL = required('DATABASE_URL');
export const PORT = Number(process.env.PORT ?? 4000);

/** Earliest season pulled into the weekly stats tables. */
export const INGEST_SEASON_START = Number(process.env.INGEST_SEASON_START ?? 2015);

/**
 * How many recent seasons feed the production component of a ranking.
 * Two seasons balances recency against sample size for rotational players.
 */
export const PRODUCTION_WINDOW_SEASONS = Number(process.env.PRODUCTION_WINDOW_SEASONS ?? 2);

/**
 * How many seasons of per-week stats to keep on disk.
 *
 * The weekly tables are the bulk of the database and they only ever grow, so
 * without a ceiling the free-tier storage cap arrives unannounced -- as failed
 * writes during an ingest, which reads as a broken pipeline rather than a full
 * disk. Nothing queries beyond the production window (rankings drive it, and
 * every other reader is single-season), so the extra seasons are dead weight.
 *
 * Deliberately wider than the window it protects: raising
 * PRODUCTION_WINDOW_SEASONS should widen the ranking sample immediately rather
 * than wait on a re-backfill, and the spare seasons cost a few MB. The floor of
 * 4 keeps that true even if the window is set to 1. Pruned seasons are always
 * recoverable -- nflverse keeps every year, so a re-ingest restores them.
 */
export const RETENTION_SEASONS = Number(
  process.env.RETENTION_SEASONS ?? Math.max(PRODUCTION_WINDOW_SEASONS + 2, 4),
);

/**
 * CollegeFootballData API key. Free, from https://collegefootballdata.com/key
 * Only needed for the college ingest; the rest of the pipeline runs without it.
 */
export const CFBD_API_KEY = process.env.CFBD_API_KEY ?? '';

/**
 * Earliest college season to pull. Only players in their first three NFL
 * seasons use college stats, but the full range seeds the baselines those
 * players are percentiled against.
 */
export const COLLEGE_SEASON_START = Number(process.env.COLLEGE_SEASON_START ?? 2015);

/** Only rank players active in this season or later. */
export const ACTIVE_SINCE_SEASON = Number(process.env.ACTIVE_SINCE_SEASON ?? 2025);

/**
 * How many recent seasons feed coaching tendency profiles.
 *
 * Three balances two opposing errors: too short and a coach's profile is one
 * season of noise, too long and it describes a scheme he has since abandoned.
 * Coordinator turnover under a stable head coach is the practical limit on
 * going wider.
 */
export const TENDENCY_WINDOW_SEASONS = Number(process.env.TENDENCY_WINDOW_SEASONS ?? 3);
