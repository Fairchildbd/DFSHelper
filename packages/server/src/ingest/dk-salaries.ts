/**
 * DraftKings salary import.
 *
 * Salaries are the one input in this project that cannot be derived, scraped
 * honestly, or inferred from football: DraftKings sets them, and the contest
 * lobby's own CSV export is the authoritative copy. So this is a file importer
 * rather than a downloader — you click "Export to CSV" on the draft screen and
 * point this at the file.
 *
 * The export looks like:
 *
 *   Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame
 *   QB,Patrick Mahomes (12345),Patrick Mahomes,12345,QB,7800,DEN@KC 09/13/2026 01:00PM ET,KC,22.4
 *
 * A showdown export is the same shape with two rows per player — one CPT at
 * 1.5x salary, one FLEX at the base price — which is why `roster_position` is
 * part of the key rather than a detail.
 */

import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { insertBatched, sql } from '../db.ts';

/**
 * DraftKings abbreviations that disagree with nflverse.
 *
 * Only the Rams differ today, but the list exists because this is exactly the
 * kind of mismatch that silently drops a team's whole slate: an unmatched
 * abbreviation produces no error, just a pool with sixteen fewer players.
 */
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
  /** Overrides the season and week inferred from the schedule. */
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

/** `DEN@KC 09/13/2026 01:00PM ET` → the two teams and the kickoff date. */
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

/**
 * Match a DraftKings name to a gsis_id.
 *
 * Keyed on team plus a stripped name, because DraftKings writes "Marvin
 * Harrison Jr." where nflverse writes "Marvin Harrison" about as often as the
 * reverse, and suffixes and punctuation are the whole difference in most
 * failures. Team narrows the field to about 50 people, which makes a loose name
 * match safe in a way it would never be league-wide.
 */
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

  // The slate is identified by the games it contains rather than by a flag, so
  // an export dropped in without arguments still lands in the right week.
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

  // A player whose name matches exactly one person league-wide is safe to link
  // even when his listed team disagrees, which happens every week in September
  // as practice squads move.
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

  // Replacing rather than merging: a re-export mid-week is DraftKings changing
  // its mind about a price, and a stale row beside a fresh one would let the
  // optimizer spend money that no longer exists.
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

// ---------------------------------------------------------------------------

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
