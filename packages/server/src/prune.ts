
import { sql } from './db.ts';
import { RETENTION_SEASONS } from './env.ts';

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

export async function pruneHistory(opts: { reclaim?: boolean } = {}): Promise<PruneResult> {
  const bytesBefore = await totalBytes();

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
    await sql.unsafe(opts.reclaim ? `VACUUM FULL ANALYZE ${table}` : `VACUUM ANALYZE ${table}`);
  }

  return { cutoff, deleted, bytesBefore, bytesAfter: await totalBytes() };
}

const mib = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;

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
