
import { cohortFor, normalizePosition } from '@dfs/shared';
import { insertBatched, sql } from '../db.ts';
import { INGEST_SEASON_START } from '../env.ts';
import {
  MissingSeasonError,
  SOURCES,
  heightToInches,
  int,
  measurableKey,
  num,
  str,
  streamCsv,
} from '../nflverse.ts';

interface LoadOptions {
  force?: boolean;
  seasonStart?: number;
}

export async function loadPlayers(opts: LoadOptions = {}): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  for await (const r of streamCsv(SOURCES.players, opts)) {
    const gsis = str(r.gsis_id);
    if (!gsis) continue;

    const position = normalizePosition(r.position ?? r.position_group);
    rows.push({
      gsis_id: gsis,
      pfr_id: str(r.pfr_id),
      display_name: str(r.display_name) ?? gsis,
      first_name: str(r.first_name),
      last_name: str(r.last_name),
      position_raw: str(r.position),
      position,
      cohort: position ? cohortFor(position) : null,
      team: str(r.latest_team),
      jersey_number: int(r.jersey_number),
      birth_date: str(r.birth_date),
      height_inches: heightToInches(r.height),
      weight_lbs: int(r.weight),
      college: str(r.college_name),
      headshot_url: str(r.headshot),
      rookie_season: int(r.rookie_season),
      last_season: int(r.last_season),
      years_experience: int(r.years_of_experience),
      status: str(r.status),
      draft_year: int(r.draft_year),
      draft_round: int(r.draft_round),
      draft_pick: int(r.draft_pick),
    });
  }
  return insertBatched('players', rows, '(gsis_id)');
}

export async function loadCombine(opts: LoadOptions = {}): Promise<number> {
  const byKey = new Map<string, Record<string, unknown>>();
  let collisions = 0;

  for await (const r of streamCsv(SOURCES.combine, opts)) {
    const name = str(r.player_name);
    if (!name) continue;

    const season = int(r.season);
    const school = str(r.school);
    const position = normalizePosition(r.pos);
    const key = measurableKey(name, season, school);

    const row = {
      measurable_key: key,
      gsis_id: null,
      pfr_id: str(r.pfr_id),
      player_name: name,
      source: 'combine',
      season,
      position_raw: str(r.pos),
      position,
      school,
      height_inches: heightToInches(r.ht),
      weight_lbs: int(r.wt),
      forty: num(r.forty),
      bench: int(r.bench),
      vertical: num(r.vertical),
      broad: int(r.broad_jump),
      cone: num(r.cone),
      shuttle: num(r.shuttle),
    };

    const existing = byKey.get(key);
    if (existing) {
      collisions++;
      if (drillCount(row) <= drillCount(existing)) continue;
    }
    byKey.set(key, row);
  }

  if (collisions > 0) {
    console.log(`  ${collisions} duplicate combine rows collapsed (kept most complete)`);
  }

  const count = await insertBatched(
    'measurables',
    [...byKey.values()],
    '(measurable_key, source)',
  );

  const linked = await sql`
    WITH unambiguous AS (
      SELECT pfr_id FROM measurables
      WHERE pfr_id IS NOT NULL
      GROUP BY pfr_id HAVING COUNT(*) = 1
    )
    UPDATE measurables m
    SET gsis_id = p.gsis_id
    FROM players p
    WHERE m.pfr_id IS NOT NULL
      AND m.pfr_id = p.pfr_id
      AND m.pfr_id IN (SELECT pfr_id FROM unambiguous)
      AND m.gsis_id IS DISTINCT FROM p.gsis_id
  `;
  console.log(`  ${linked.count} measurable rows linked to league ids`);

  const [{ count: ambiguous }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM (
      SELECT pfr_id FROM measurables
      WHERE pfr_id IS NOT NULL GROUP BY pfr_id HAVING COUNT(*) > 1
    ) x
  `;
  if (ambiguous > 0) {
    console.log(`  ${ambiguous} pfr_ids ambiguous upstream — left unlinked on purpose`);
  }

  return count;
}

function drillCount(row: Record<string, unknown>): number {
  return ['forty', 'bench', 'vertical', 'broad', 'cone', 'shuttle'].filter(
    (d) => row[d] != null,
  ).length;
}

const RATE_COLUMNS = new Set([
  'target_share',
  'air_yards_share',
  'wopr',
  'offense_pct',
  'defense_pct',
  'st_pct',
]);

const KEY_COLUMNS = new Set(['gsis_id', 'season', 'week', 'season_type', 'team', 'opponent', 'position']);

function mergeWeeklyRow(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void {
  for (const [column, value] of Object.entries(incoming)) {
    if (KEY_COLUMNS.has(column)) continue;
    const existing = target[column];
    if (typeof value !== 'number') continue;
    if (typeof existing !== 'number') {
      target[column] = value;
    } else if (RATE_COLUMNS.has(column)) {
      target[column] = Math.max(existing, value);
    } else {
      target[column] = existing + value;
    }
  }
}

export async function loadWeeklyStats(
  seasons: number[],
  opts: LoadOptions = {},
): Promise<{ offense: number; defense: number; skipped: number[] }> {
  let offenseTotal = 0;
  let defenseTotal = 0;
  const skipped: number[] = [];

  for (const season of seasons) {
    const offenseByKey = new Map<string, Record<string, unknown>>();
    const defenseByKey = new Map<string, Record<string, unknown>>();
    let merged = 0;

    try {
      for await (const r of streamCsv(SOURCES.weekly(season), opts)) {
        const gsis = str(r.player_id);
        const rowSeason = int(r.season) ?? season;
        if (!gsis) continue;

        const week = int(r.week) ?? 0;
        const seasonType = str(r.season_type) ?? 'REG';
        const key = `${gsis}|${rowSeason}|${week}|${seasonType}`;

        const offense = {
          gsis_id: gsis,
          season: rowSeason,
          week,
          season_type: seasonType,
          team: str(r.team),
          opponent: str(r.opponent_team),
          position: str(r.position),
          completions: int(r.completions),
          attempts: int(r.attempts),
          passing_yards: num(r.passing_yards),
          passing_tds: int(r.passing_tds),
          interceptions: int(r.passing_interceptions),
          passing_epa: num(r.passing_epa),
          passing_first_downs: num(r.passing_first_downs),
          carries: int(r.carries),
          rushing_yards: num(r.rushing_yards),
          rushing_tds: int(r.rushing_tds),
          rushing_epa: num(r.rushing_epa),
          receptions: int(r.receptions),
          targets: int(r.targets),
          receiving_yards: num(r.receiving_yards),
          receiving_tds: int(r.receiving_tds),
          receiving_epa: num(r.receiving_epa),
          target_share: num(r.target_share),
          air_yards_share: num(r.air_yards_share),
          wopr: num(r.wopr),
          fantasy_points: num(r.fantasy_points),
          fantasy_points_ppr: num(r.fantasy_points_ppr),
        };

        const solo = num(r.def_tackles_solo) ?? 0;
        const withAssist = num(r.def_tackles_with_assist) ?? 0;

        const defense = {
          gsis_id: gsis,
          season: rowSeason,
          week,
          season_type: seasonType,
          team: str(r.team),
          position: str(r.position),
          def_tackles: solo + withAssist,
          def_tackles_solo: solo,
          def_tackles_for_loss: num(r.def_tackles_for_loss),
          def_sacks: num(r.def_sacks),
          def_qb_hits: num(r.def_qb_hits),
          def_interceptions: num(r.def_interceptions),
          def_pass_defended: num(r.def_pass_defended),
          def_fumbles_forced: num(r.def_fumbles_forced),
          def_tds: num(r.def_tds),
        };

        if (hasAny(offense, OFFENSE_SIGNALS)) {
          const existing = offenseByKey.get(key);
          if (existing) {
            mergeWeeklyRow(existing, offense);
            merged++;
          } else offenseByKey.set(key, offense);
        }

        if (hasAny(defense, DEFENSE_SIGNALS)) {
          const existing = defenseByKey.get(key);
          if (existing) mergeWeeklyRow(existing, defense);
          else defenseByKey.set(key, defense);
        }
      }
    } catch (err) {
      if (err instanceof MissingSeasonError) {
        skipped.push(season);
        continue;
      }
      throw err;
    }

    offenseTotal += await insertBatched(
      'player_week_offense',
      [...offenseByKey.values()],
      '(gsis_id, season, week, season_type)',
    );
    defenseTotal += await insertBatched(
      'player_week_defense',
      [...defenseByKey.values()],
      '(gsis_id, season, week, season_type)',
    );

    console.log(
      `  ${season}: ${offenseByKey.size} offense, ${defenseByKey.size} defense` +
        (merged > 0 ? ` (${merged} split-week merged)` : ''),
    );
  }

  return { offense: offenseTotal, defense: defenseTotal, skipped };
}

const OFFENSE_SIGNALS = [
  'completions', 'attempts', 'carries', 'targets', 'receptions',
  'passing_yards', 'rushing_yards', 'receiving_yards',
];

const DEFENSE_SIGNALS = [
  'def_tackles', 'def_tackles_for_loss', 'def_sacks', 'def_qb_hits',
  'def_interceptions', 'def_pass_defended', 'def_fumbles_forced', 'def_tds',
];

function hasAny(row: Record<string, unknown>, columns: string[]): boolean {
  return columns.some((c) => {
    const v = row[c];
    return typeof v === 'number' && v !== 0;
  });
}

export async function loadSnaps(seasons: number[], opts: LoadOptions = {}): Promise<number> {
  let total = 0;
  for (const season of seasons) {
    const byKey = new Map<string, Record<string, unknown>>();
    try {
      for await (const r of streamCsv(SOURCES.snaps(season), opts)) {
        const pfr = str(r.pfr_player_id);
        if (!pfr) continue;
        const row = {
          pfr_id: pfr,
          season: int(r.season) ?? season,
          week: int(r.week) ?? 0,
          game_type: str(r.game_type) ?? 'REG',
          team: str(r.team),
          position: str(r.position),
          offense_snaps: int(r.offense_snaps),
          offense_pct: num(r.offense_pct),
          defense_snaps: int(r.defense_snaps),
          defense_pct: num(r.defense_pct),
          st_snaps: int(r.st_snaps),
          st_pct: num(r.st_pct),
        };

        const key = `${row.pfr_id}|${row.season}|${row.week}|${row.game_type}`;
        const existing = byKey.get(key);
        if (existing) mergeWeeklyRow(existing, row);
        else byKey.set(key, row);
      }
    } catch (err) {
      console.warn(`  snap counts ${season}: ${(err as Error).message}`);
      continue;
    }
    total += await insertBatched(
      'snap_counts',
      [...byKey.values()],
      '(pfr_id, season, week, game_type)',
    );
  }
  return total;
}

export async function runIngest(opts: LoadOptions = {}): Promise<Record<string, number>> {
  const seasonStart = opts.seasonStart ?? INGEST_SEASON_START;
  const currentSeason = new Date().getFullYear();
  const seasons: number[] = [];
  for (let s = seasonStart; s <= currentSeason; s++) seasons.push(s);

  const counts: Record<string, number> = {};

  console.log('players…');
  counts.players = await loadPlayers(opts);
  console.log(`  ${counts.players} players`);

  console.log('combine…');
  counts.combine = await loadCombine(opts);
  console.log(`  ${counts.combine} measurable rows`);

  console.log(`weekly stats (${seasons[0]}–${seasons.at(-1)})…`);
  const weekly = await loadWeeklyStats(seasons, opts);
  counts.offense = weekly.offense;
  counts.defense = weekly.defense;
  if (weekly.skipped.length > 0) {
    console.log(`  not published yet, skipped: ${weekly.skipped.join(', ')}`);
  }
  console.log(`  ${weekly.offense} offense rows, ${weekly.defense} defense rows`);

  console.log(`snap counts (${seasons[0]}–${seasons.at(-1)})…`);
  counts.snaps = await loadSnaps(seasons, opts);
  console.log(`  ${counts.snaps} snap rows`);

  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = Date.now();
  const [run] = await sql<{ id: number }[]>`
    INSERT INTO ingest_runs (status) VALUES ('running') RETURNING id
  `;
  try {
    const counts = await runIngest({ force: process.argv.includes('--force') });
    await sql`
      UPDATE ingest_runs
      SET status = 'ok', finished_at = now(), detail = ${sql.json(counts)}
      WHERE id = ${run!.id}
    `;
    console.log(`Ingest complete in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    await sql`
      UPDATE ingest_runs
      SET status = 'failed', finished_at = now(),
          detail = ${sql.json({ error: (err as Error).message })}
      WHERE id = ${run!.id}
    `;
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
