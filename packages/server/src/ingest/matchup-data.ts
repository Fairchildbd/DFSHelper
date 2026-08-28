
import { sql } from '../db.ts';
import { PRODUCTION_WINDOW_SEASONS, TENDENCY_WINDOW_SEASONS } from '../env.ts';
import { computeDefenseVsPosition, loadDefenderCoverage } from './advstats.ts';
import { loadDvoa } from './dvoa.ts';
import { loadTendencies } from './pbp.ts';
import { loadDepthChart, loadSchedule } from './schedule.ts';

interface Options {
  force?: boolean;
  season?: number;
}

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
