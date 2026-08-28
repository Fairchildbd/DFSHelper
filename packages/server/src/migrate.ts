import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './db.ts';

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const schema = await readFile(resolve(here, 'schema.sql'), 'utf8');
  console.log('Applying schema…');
  await sql.unsafe(schema);

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log(`Schema applied. Tables: ${tables.map((t) => t.table_name).join(', ')}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
