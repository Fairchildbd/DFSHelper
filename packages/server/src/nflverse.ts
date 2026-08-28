/**
 * nflverse data access.
 *
 * The release assets are plain CSVs on GitHub, some north of 30 MB, so they are
 * streamed through a parser rather than buffered, and cached on disk so a
 * re-run during development does not re-download 70 MB.
 */

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
  /**
   * Current weekly stats release: one file per season carrying offense,
   * defense, and kicking in a single 150-column row set.
   *
   * Note the older `player_stats/player_stats.csv` and `player_stats_def.csv`
   * assets still resolve but are frozen at 2024 — using them silently costs you
   * the most recent seasons, which is the opposite of what a DFS tool wants.
   */
  weekly: (season: number) => `${BASE}/stats_player/stats_player_week_${season}.csv`,
  snaps: (season: number) => `${BASE}/snap_counts/snap_counts_${season}.csv`,

  /**
   * The full schedule, every season in one file. Carries `home_coach` and
   * `away_coach`, which is the only free source tying plays to a coaching staff
   * and therefore the hinge the whole tendency model hangs on.
   */
  schedules: `${BASE}/schedules/games.csv`,

  /**
   * Play-by-play, taken gzipped: 19 MB against 98 MB for the same season as
   * plain CSV, and it is streamed through gunzip rather than expanded to disk.
   */
  pbp: (season: number) => `${BASE}/pbp/play_by_play_${season}.csv.gz`,

  /** FTN charting: play action, motion, screens, blitzers. 2022 onward only. */
  ftn: (season: number) => `${BASE}/ftn_charting/ftn_charting_${season}.csv`,

  /** PFR advanced defensive stats — per-defender coverage and pressure. */
  advstatsDef: (season: number) =>
    `${BASE}/pfr_advstats/advstats_week_def_${season}.csv`,

  /** Depth charts, re-snapshotted continuously; only the newest one matters. */
  depthCharts: (season: number) => `${BASE}/depth_charts/depth_charts_${season}.csv`,
} as const;

/** Earliest season with FTN charting. Before this, scheme metrics are absent. */
export const FTN_FIRST_SEASON = 2022;

/** Thrown when a season's file has not been published yet. */
export class MissingSeasonError extends Error {}

/** Treat a cached file older than this as stale. */
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
    // A season file that does not exist yet is an expected state in the
    // preseason, not a failure.
    throw new MissingSeasonError(`Not published yet: ${url}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  // Write to a temp file first so an interrupted download never poisons the cache.
  const tmp = `${path}.partial`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
  return path;
}

/** Stream one nflverse CSV, yielding each row as a plain object. */
export async function* streamCsv(
  url: string,
  options: { force?: boolean } = {},
): AsyncGenerator<Record<string, string>> {
  const path = await cachedPath(url, options.force ?? false);
  const file = createReadStream(path);
  // Some releases are only sane gzipped — play-by-play is 98 MB expanded — so
  // the decompressor sits in the pipe rather than expanding to a temp file.
  const bytes = url.endsWith('.gz') ? file.pipe(createGunzip()) : file;
  const parser = bytes.pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true }),
  );
  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}

/** nflverse writes empty strings and the literal "NA" for missing values. */
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

/** Combine heights arrive as `6-4`; everything downstream wants inches. */
export function heightToInches(value: string | undefined | null): number | null {
  const raw = str(value);
  if (!raw) return null;
  const dashed = raw.match(/^(\d+)[-'](\d+)$/);
  if (dashed) return Number(dashed[1]) * 12 + Number(dashed[2]);
  const plain = Number(raw);
  return Number.isFinite(plain) ? plain : null;
}

export function slugify(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Identity for a measurable row.
 *
 * Deliberately built from name + season + school rather than pfr_id, because
 * nflverse assigns the same pfr_id to different people about 19 times in the
 * combine file \u2014 two distinct 2000 entrants named Mike Green, one a safety from
 * NW State and one a fullback from Houston, share `GreeMi00`. Keying on pfr_id
 * would collapse them into one row and hand one player's drills to the other.
 */
export function measurableKey(
  name: string,
  season: number | null,
  school: string | null,
): string {
  return `${slugify(name)}:${season ?? 0}:${slugify(school)}`;
}
