
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(here, '../.cache');

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

export const SOURCES = {
  players: `${BASE}/players/players.csv`,
  combine: `${BASE}/combine/combine.csv`,
  weekly: (season: number) => `${BASE}/stats_player/stats_player_week_${season}.csv`,
  snaps: (season: number) => `${BASE}/snap_counts/snap_counts_${season}.csv`,

  schedules: `${BASE}/schedules/games.csv`,

  pbp: (season: number) => `${BASE}/pbp/play_by_play_${season}.csv.gz`,

  ftn: (season: number) => `${BASE}/ftn_charting/ftn_charting_${season}.csv`,

  advstatsDef: (season: number) =>
    `${BASE}/pfr_advstats/advstats_week_def_${season}.csv`,

  depthCharts: (season: number) => `${BASE}/depth_charts/depth_charts_${season}.csv`,
} as const;

export const FTN_FIRST_SEASON = 2022;

export class MissingSeasonError extends Error {}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function cachedPath(url: string, force: boolean): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const name = url.split('/').slice(-2).join('_');
  const path = join(CACHE_DIR, name);

  if (!force && existsSync(path)) {
    const age = Date.now() - (await stat(path)).mtimeMs;
    if (age < CACHE_TTL_MS) return path;
  }

  const res = await fetch(url);
  if (res.status === 404) {
    throw new MissingSeasonError(`Not published yet: ${url}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const tmp = `${path}.partial`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
  return path;
}

export async function* streamCsv(
  url: string,
  options: { force?: boolean } = {},
): AsyncGenerator<Record<string, string>> {
  const path = await cachedPath(url, options.force ?? false);
  const file = createReadStream(path);
  const bytes = url.endsWith('.gz') ? file.pipe(createGunzip()) : file;
  const parser = bytes.pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true }),
  );
  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

export function num(value: string | undefined | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'NA' || trimmed === 'null') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function int(value: string | undefined | null): number | null {
  const parsed = num(value);
  return parsed == null ? null : Math.round(parsed);
}

export function str(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'NA' ? null : trimmed;
}

export function heightToInches(value: string | undefined | null): number | null {
  const raw = str(value);
  if (!raw) return null;
  const dashed = raw.match(/^(\d+)[-'](\d+)$/);
  if (dashed) return Number(dashed[1]) * 12 + Number(dashed[2]);
  const plain = Number(raw);
  return Number.isFinite(plain) ? plain : null;
}

// "Amon-Ra St. Brown" -> "amonrastbrown"
// "José Ramírez"      -> "joseramirez"
// "D.K. Metcalf"      -> "dkmetcalf"
export function slugify(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function measurableKey(
  name: string,
  season: number | null,
  school: string | null,
): string {
  return `${slugify(name)}:${season ?? 0}:${slugify(school)}`;
}
