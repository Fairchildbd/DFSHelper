
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { insertBatched, sql } from '../db.ts';

const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA',
  JAC: 'JAX',
  WSH: 'WAS',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LA',
};

const team = (raw: string): string => {
  const upper = raw.trim().toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
};

interface RawRow {
  Position?: string;
  Name?: string;
  ID?: string;
  'Roster Position'?: string;
  Salary?: string;
  'Game Info'?: string;
  TeamAbbrev?: string;
  AvgPointsPerGame?: string;
  Status?: string;
}

export interface DkImportOptions {
  file: string;
  season?: number;
  week?: number;
}

export interface DkImportResult {
  season: number;
  week: number;
  contest: 'classic' | 'showdown';
  rows: number;
  matched: number;
  unmatched: string[];
  games: number;
}

function parseGameInfo(raw: string | undefined): { away: string; home: string; date: string | null } | null {
  if (!raw) return null;
  const match = /^([A-Za-z]{2,3})@([A-Za-z]{2,3})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.trim());
  if (!match) return null;
  return {
    away: team(match[1]!),
    home: team(match[2]!),
    date: `${match[5]}-${match[3]}-${match[4]}`,
  };
}

async function readRows(file: string): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const parser = createReadStream(file).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }),
  );
  for await (const record of parser) rows.push(record as RawRow);
  return rows;
}

// "Marvin Harrison Jr." -> "marvinharrison"
// "Robert Griffin III"  -> "robertgriffin"
// "Odell Beckham Jr."   -> "odellbeckham"
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');
}

export async function importDkSalaries(opts: DkImportOptions): Promise<DkImportResult> {
  const raw = await readRows(opts.file);
  if (raw.length === 0) throw new Error(`No rows in ${opts.file}`);

  const contest = raw.some((r) => (r['Roster Position'] ?? '').trim().toUpperCase() === 'CPT')
    ? 'showdown'
    : 'classic';

  const infos = raw.map((r) => parseGameInfo(r['Game Info'])).filter((g) => g != null);
  if (infos.length === 0) throw new Error('No parseable Game Info column — is this a DraftKings export?');

  const dates = [...new Set(infos.map((g) => g!.date).filter(Boolean))] as string[];
  const teams = [...new Set(infos.flatMap((g) => [g!.home, g!.away]))];

  const scheduled = await sql<
    { game_id: string; season: number; week: number; home_team: string; away_team: string }[]
  >`
    SELECT game_id, season, week, home_team, away_team
    FROM games
    WHERE (${opts.season ?? null}::int IS NULL OR season = ${opts.season ?? null})
      AND (${opts.week ?? null}::int IS NULL OR week = ${opts.week ?? null})
      AND (${dates.length === 0} OR gameday::text = ANY(${dates}))
      AND (home_team = ANY(${teams}) OR away_team = ANY(${teams}))
  `;
  if (scheduled.length === 0) {
    throw new Error(
      `No scheduled games match this export (${teams.join(', ')} on ${dates.join(', ')}). ` +
        'Run the schedule ingest first, or pass --season/--week.',
    );
  }

  const season = opts.season ?? scheduled[0]!.season;
  const week = opts.week ?? scheduled[0]!.week;
  const gameByTeam = new Map<string, string>();
  for (const g of scheduled) {
    if (g.season !== season || g.week !== week) continue;
    gameByTeam.set(g.home_team, g.game_id);
    gameByTeam.set(g.away_team, g.game_id);
  }

  const roster = await sql<{ gsis_id: string; display_name: string; team: string; position: string }[]>`
    SELECT DISTINCT ON (d.gsis_id) d.gsis_id, p.display_name, d.team, d.position
    FROM depth_chart d
    JOIN players p ON p.gsis_id = d.gsis_id
    -- Return and holder rows name the same players a second time with no
    -- position on them, and DISTINCT ON would be free to pick one.
    WHERE d.season = ${season} AND d.position IS NOT NULL
    ORDER BY d.gsis_id, d.pos_rank NULLS LAST
  `;
  const byTeamName = new Map<string, string>();
  for (const r of roster) byTeamName.set(`${r.team}|${nameKey(r.display_name)}`, r.gsis_id);

  const byName = new Map<string, string | null>();
  for (const r of roster) {
    const key = nameKey(r.display_name);
    byName.set(key, byName.has(key) ? null : r.gsis_id);
  }

  const unmatched: string[] = [];
  const rows = raw
    .map((r) => {
      const salary = Number(r.Salary);
      const position = (r.Position ?? '').trim().toUpperCase();
      const name = (r.Name ?? '').trim();
      const abbrev = team(r.TeamAbbrev ?? '');
      if (!name || !position || !abbrev || !Number.isFinite(salary)) return null;

      const info = parseGameInfo(r['Game Info']);
      const opponent = info ? (info.home === abbrev ? info.away : info.home) : null;

      let gsis: string | null = null;
      if (position !== 'DST') {
        gsis = byTeamName.get(`${abbrev}|${nameKey(name)}`) ?? byName.get(nameKey(name)) ?? null;
        if (!gsis) unmatched.push(`${name} (${abbrev} ${position})`);
      }

      return {
        season,
        week,
        contest,
        dk_id: (r.ID ?? '').trim() || `${abbrev}-${nameKey(name)}`,
        roster_position: (r['Roster Position'] ?? position).trim().toUpperCase(),
        name,
        position,
        team: abbrev,
        opponent,
        game_id: gameByTeam.get(abbrev) ?? null,
        salary: Math.round(salary),
        avg_points: Number.isFinite(Number(r.AvgPointsPerGame)) ? Number(r.AvgPointsPerGame) : null,
        status: (r.Status ?? '').trim().toUpperCase() || null,
        gsis_id: gsis,
      };
    })
    .filter((r) => r != null);

  await sql`
    DELETE FROM dk_salaries
    WHERE season = ${season} AND week = ${week} AND contest = ${contest}
  `;
  await insertBatched('dk_salaries', rows, '(season, week, contest, dk_id, roster_position)');

  return {
    season,
    week,
    contest,
    rows: rows.length,
    matched: rows.filter((r) => r.gsis_id != null || r.position === 'DST').length,
    unmatched: [...new Set(unmatched)],
    games: new Set(rows.map((r) => r.game_id).filter(Boolean)).size,
  };
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = flag('file') ?? process.argv[2];
  if (!file) {
    console.error('usage: npm run ingest:dk -- --file <DKSalaries.csv> [--season 2026] [--week 1]');
    process.exit(1);
  }

  const seasonFlag = flag('season');
  const weekFlag = flag('week');
  const result = await importDkSalaries({
    file,
    season: seasonFlag ? Number(seasonFlag) : undefined,
    week: weekFlag ? Number(weekFlag) : undefined,
  });

  console.log(
    `${result.contest} slate: ${result.rows} rows, ${result.games} games, ` +
      `season ${result.season} week ${result.week}`,
  );
  if (result.unmatched.length > 0) {
    console.log(`  ${result.unmatched.length} unmatched: ${result.unmatched.slice(0, 10).join(', ')}`);
  }
  await sql.end();
}
