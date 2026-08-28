import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export const INGEST_SEASON_START = Number(process.env.INGEST_SEASON_START ?? 2015);

export const PRODUCTION_WINDOW_SEASONS = Number(process.env.PRODUCTION_WINDOW_SEASONS ?? 2);

export const RETENTION_SEASONS = Number(
  process.env.RETENTION_SEASONS ?? Math.max(PRODUCTION_WINDOW_SEASONS + 2, 4),
);

export const CFBD_API_KEY = process.env.CFBD_API_KEY ?? '';

export const COLLEGE_SEASON_START = Number(process.env.COLLEGE_SEASON_START ?? 2015);

export const ACTIVE_SINCE_SEASON = Number(process.env.ACTIVE_SINCE_SEASON ?? 2025);

export const TENDENCY_WINDOW_SEASONS = Number(process.env.TENDENCY_WINDOW_SEASONS ?? 3);
