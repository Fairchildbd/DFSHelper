/**
 * Ingest for everything the matchup layer needs, in dependency order.
 *
 * The schedule has to land first: it is the only source that ties a play to a
 * coaching staff, so the tendency pass cannot attribute anything without it.
 */

import { sql } from '../db.ts';
import { PRODUCTION_WINDOW_SEASONS, TENDENCY_WINDOW_SEASONS } from '../env.ts';
import { computeDefenseVsPosition, loadDefenderCoverage } from './advstats.ts';
import { loadDvoa } from './dvoa.ts';
import { loadTendencies } from './pbp.ts';
import { loadDepthChart, loadSchedule } from './schedule.ts';

interface Options {
  force?: boolean;
  /** Season whose depth chart is loaded. Defaults to the next unplayed season. */
  season?: number;
}

/**
 * Seasons that feed tendency and defensive profiles.
 *
 * Deliberately the *completed* seasons behind the target: in the preseason
 * there are no plays from the upcoming year at all, and in-season the current
 * year is included as soon as it has games.
 */
async function windowSeasons(target: number): Promise<number[]> {
  const [row] = await sql<{ season: number | null }[]>`
    SELECT MAX(season)::int AS season FROM player_week_offense
  `;
  const newest = row?.season ?? target - 1;
  const seasons: number[] = [];
  for (let s = newest - (TENDENCY_WINDOW_SEASONS - 1); s <= newest; s++) seasons.push(s);
  return seasons;
}

async function nextSeason(): Promise<number> {
  const [row] = await sql<{ season: number | null }[]>`
    SELECT season FROM games
    WHERE home_score IS NULL AND game_type = 'REG'
    ORDER BY gameday NULLS LAST, game_id LIMIT 1
  `;
  return row?.season ?? new Date().getFullYear();
}

export async function runMatchupIngest(opts: Options = {}): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  console.log('schedule…');
  counts.games = await loadSchedule(opts);
  console.log(`  ${counts.games} games`);

  const season = opts.season ?? (await nextSeason());
  const seasons = await windowSeasons(season);
  console.log(`  target season ${season}; tendency window ${seasons.join(', ')}`);

  // The previous season's chart is loaded too, so a just-finished game — or a
  // backfilled playoff game — is graded against the roster that played it
  // rather than against next year's.
  console.log('depth charts…');
  counts.depth_chart = await loadDepthChart(season, opts);
  counts.depth_chart_prev = await loadDepthChart(season - 1, opts);
  console.log(
    `  ${counts.depth_chart} slots for ${season}, ${counts.depth_chart_prev} for ${season - 1}`,
  );

  console.log('coaching tendencies from play-by-play…');
  const tendencies = await loadTendencies(seasons, opts);
  counts.coaches = tendencies.coaches;
  counts.tendency_metrics = tendencies.metrics;
  console.log(`  ${tendencies.coaches} coaches, ${tendencies.teams} teams, ${tendencies.metrics} metric rows`);

  console.log('defender coverage…');
  counts.defenders = await loadDefenderCoverage(seasons, opts);
  console.log(`  ${counts.defenders} defender seasons`);

  console.log('defense vs position…');
  counts.def_vs_position = await computeDefenseVsPosition(seasons);
  console.log(`  ${counts.def_vs_position} rows`);

  /*
   * Opponent adjustment, last because it is the only step that wants two
   * different windows at once.
   *
   * The fit spans the full tendency window, since a defensive coefficient
   * estimated on one thin season is a noisy correction applied to every player
   * who faced that team. Player rates are held to the production window, which
   * is what the ranking engine scores everyone else over — letting them run
   * wider would credit a player for seasons the rest of the board has aged out.
   */
  const playerSeasons = seasons.slice(-PRODUCTION_WINDOW_SEASONS);
  console.log(
    `opponent-adjusted efficiency (fit ${seasons.join(', ')}; ` +
      `player rates ${playerSeasons.join(', ')})…`,
  );
  const dvoa = await loadDvoa(seasons, { ...opts, playerSeasons });
  counts.dvoa_team_metrics = dvoa.teams;
  counts.dvoa_players = dvoa.players;
  console.log(
    `  ${dvoa.teams} team metric rows, ${dvoa.players} players, ` +
      `${dvoa.plays.toLocaleString()} plays fitted`,
  );

  return counts;
}

// Run directly: `npm run ingest:matchups -w @dfs/server`
if (import.meta.url === `file://${process.argv[1]}`) {
  const started = Date.now();
  try {
    const counts = await runMatchupIngest({ force: process.argv.includes('--force') });
    console.log(
      `Matchup ingest complete in ${Math.round((Date.now() - started) / 1000)}s`,
      counts,
    );
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
