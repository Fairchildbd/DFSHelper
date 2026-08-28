
import { sql } from './db.ts';
import { runIngest } from './ingest/index.ts';
import { runMatchupIngest } from './ingest/matchup-data.ts';
import { attachResults, computeMatchups } from './matchups.ts';
import { computeRankings } from './rankings.ts';
import { pruneHistory } from './prune.ts';

async function main() {
  const started = Date.now();
  const currentSeason = new Date().getFullYear();

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO ingest_runs (status, detail)
    VALUES ('running', ${sql.json({ kind: 'weekly-refresh', season: currentSeason })})
    RETURNING id
  `;

  try {
    const counts = await runIngest({ force: true, seasonStart: currentSeason });
    const matchupCounts = await runMatchupIngest({ force: true });
    const ranking = await computeRankings();
    const matchups = await computeMatchups({ scope: 'week' });

    const results = await attachResults();

    const pruned = await pruneHistory();

    const detail = {
      kind: 'weekly-refresh',
      resultsAttached: results.games,
      season: currentSeason,
      ...counts,
      ...matchupCounts,
      ...ranking,
      matchups: matchups.games,
      playerMatchups: matchups.players,
      prunedBefore: pruned.cutoff,
      prunedRows: Object.values(pruned.deleted).reduce((a, b) => a + b, 0),
    };
    await sql`
      UPDATE ingest_runs SET status = 'ok', finished_at = now(), detail = ${sql.json(detail)}
      WHERE id = ${run!.id}
    `;
    console.log(
      `Refresh complete in ${Math.round((Date.now() - started) / 1000)}s — ` +
        `${ranking.ranked} players ranked, ${matchups.games} matchups built.`,
    );
  } catch (err) {
    await sql`
      UPDATE ingest_runs SET status = 'failed', finished_at = now(),
        detail = ${sql.json({ kind: 'weekly-refresh', error: (err as Error).message })}
      WHERE id = ${run!.id}
    `;
    throw err;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
