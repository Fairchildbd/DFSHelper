/**
 * Weekly refresh — intended for Wednesdays, once the previous week's games are
 * final and nflverse has published its update.
 *
 * Only the current season's weekly stats are re-pulled; combine data changes
 * once a year and the historical seasons are immutable. Rankings are then
 * recomputed from scratch, because a new week shifts every percentile.
 *
 *   0 9 * * 3  cd /path/to/DFSHelper && npm run db:refresh >> refresh.log 2>&1
 */

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
    // force: skip the disk cache, since the point of the run is fresh data.
    const counts = await runIngest({ force: true, seasonStart: currentSeason });
    const matchupCounts = await runMatchupIngest({ force: true });
    const ranking = await computeRankings();
    // After rankings, not before: a lane's unit strength is built from the
    // composites that pass has just recomputed.
    // Week-scoped on purpose: the weekly job forecasts the week now in play and
    // leaves finished weeks locked. The season-wide best-ball build is a
    // separate, manual run.
    const matchups = await computeMatchups({ scope: 'week' });

    // Results first would be wrong: a game that finished this week must be
    // graded against the prediction already stored for it, then locked.
    const results = await attachResults();

    // Last, so a failure here cannot cost the week's real work, and so nothing
    // downstream is still reading the rows being removed. The weekly tables are
    // the only ones that grow without bound; trimming them on the same schedule
    // that fills them is what keeps the storage cap from arriving as a surprise
    // mid-ingest write failure.
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
