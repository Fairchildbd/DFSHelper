/**
 * Storage retention for the per-week stat tables.
 *
 * These three tables are ~75% of the database and they only ever grow: every
 * season appends and nothing ever removes. On a capped plan that ends as failed
 * writes partway through an ingest, which looks like a broken pipeline rather
 * than a full disk -- so the ceiling is enforced here, on a schedule, instead of
 * being discovered.
 *
 * Safe because nothing reads past the production window: rankings.ts selects
 * from `latestSeason - (PRODUCTION_WINDOW_SEASONS - 1)`, its baselines are built
 * from those same rows plus season-agnostic combine measurables, and every other
 * reader (matchups.ts, lineups.ts) is scoped to a single season.
 *
 * Only the weekly tables are pruned. `games`, `players`, `measurables` and the
 * college tables are either small or genuinely historical, and the storage they
 * cost is not worth the risk of cutting something a future query wants.
 */

import { sql } from './db.ts';
import { RETENTION_SEASONS } from './env.ts';

/** The weekly tables, all keyed by an integer `season`. */
const PRUNABLE = ['snap_counts', 'player_week_offense', 'player_week_defense'] as const;

export interface PruneResult {
  cutoff: number | null;
  deleted: Record<string, number>;
  bytesBefore: number;
  bytesAfter: number;
}

async function totalBytes(): Promise<number> {
  const [row] = await sql<{ bytes: string }[]>`
    SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::text AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  `;
  return Number(row?.bytes ?? 0);
}

/**
 * Drop stat rows older than the retention window.
 *
 * `reclaim` runs VACUUM FULL, which rewrites each table so the freed pages are
 * actually returned rather than just marked reusable. It takes an exclusive lock
 * and needs room for a second copy, so it is opt-in: worth it on the first run,
 * which clears years at once, and pointless afterwards when a steady-state run
 * removes at most one season a year.
 */
export async function pruneHistory(opts: { reclaim?: boolean } = {}): Promise<PruneResult> {
  const bytesBefore = await totalBytes();

  // Anchor on the newest season actually present, not the calendar year: in the
  // gap between a season ending and the next beginning, the current year has no
  // rows at all and a calendar cutoff would delete the most recent real data.
  const [{ latest }] = await sql<{ latest: number | null }[]>`
    SELECT MAX(season)::int AS latest FROM player_week_offense
  `;
  if (latest == null) {
    return { cutoff: null, deleted: {}, bytesBefore, bytesAfter: bytesBefore };
  }

  const cutoff = latest - (RETENTION_SEASONS - 1);
  const deleted: Record<string, number> = {};

  for (const table of PRUNABLE) {
    const rows = await sql.unsafe(`DELETE FROM ${table} WHERE season < $1`, [cutoff]);
    deleted[table] = rows.count ?? 0;
    // ANALYZE keeps the planner honest after a large delete; without it the
    // stale row estimates outlive the rows themselves.
    await sql.unsafe(opts.reclaim ? `VACUUM FULL ANALYZE ${table}` : `VACUUM ANALYZE ${table}`);
  }

  return { cutoff, deleted, bytesBefore, bytesAfter: await totalBytes() };
}

const mib = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;

/** `npm run db:prune -- --reclaim` */
if (import.meta.url === `file://${process.argv[1]}`) {
  const reclaim = process.argv.includes('--reclaim');
  const result = await pruneHistory({ reclaim });
  if (result.cutoff == null) {
    console.log('No stat rows present; nothing to prune.');
  } else {
    console.log(`Retention: ${RETENTION_SEASONS} seasons (dropping season < ${result.cutoff})`);
    for (const [table, n] of Object.entries(result.deleted)) {
      console.log(`  ${table.padEnd(22)} ${n} rows deleted`);
    }
    console.log(
      `Storage ${mib(result.bytesBefore)} -> ${mib(result.bytesAfter)}` +
        (reclaim ? '' : '  (run with --reclaim to return the pages)'),
    );
  }
  await sql.end();
}
