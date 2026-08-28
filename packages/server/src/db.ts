import postgres from 'postgres';
import { DATABASE_URL } from './env.ts';

export const sql = postgres(DATABASE_URL, {
  ssl: 'require',
  // Ingest runs long batch inserts; a small pool keeps Neon's connection
  // limits comfortable while still overlapping network round trips.
  max: 5,
  idle_timeout: 20,
  connect_timeout: 30,
});

export type Sql = typeof sql;

/** Insert rows in chunks, because a single multi-megabyte statement will not fly. */
export async function insertBatched<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  conflictTarget: string,
  chunkSize = 1000,
): Promise<number> {
  if (rows.length === 0) return 0;

  const columns = Object.keys(rows[0]!);
  const updates = columns.filter((c) => !conflictTarget.includes(c));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const setClause =
      updates.length > 0
        ? sql`DO UPDATE SET ${sql.unsafe(
            updates.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', '),
          )}`
        : sql`DO NOTHING`;

    await sql`
      INSERT INTO ${sql(table)} ${sql(chunk as never, columns as never)}
      ON CONFLICT ${sql.unsafe(conflictTarget)} ${setClause}
    `;
    inserted += chunk.length;
  }
  return inserted;
}
