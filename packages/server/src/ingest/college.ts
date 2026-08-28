
import { insertBatched, sql } from '../db.ts';
import { CFBD_API_KEY, COLLEGE_SEASON_START } from '../env.ts';

const CFBD_BASE = 'https://apinext.collegefootballdata.com';

const CATEGORIES = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions'] as const;

interface PlayerSeasonStat {
  season: number;
  playerId: number | string;
  player: string;
  team: string;
  conference: string | null;
  category: string;
  statType: string;
  stat: number | string;
}

const STAT_COLUMNS: Record<string, string> = {
  'passing|YDS': 'passing_yards',
  'passing|TD': 'passing_tds',
  'passing|INT': 'passing_interceptions',
  'passing|COMPLETIONS': 'completions',
  'passing|ATT': 'attempts',

  'rushing|YDS': 'rushing_yards',
  'rushing|TD': 'rushing_tds',
  'rushing|CAR': 'carries',

  'receiving|YDS': 'receiving_yards',
  'receiving|TD': 'receiving_tds',
  'receiving|REC': 'receptions',

  'defensive|TOT': 'tackles',
  'defensive|TFL': 'tackles_for_loss',
  'defensive|SACKS': 'sacks',
  'defensive|PD': 'pass_defended',

  'interceptions|INT': 'interceptions_def',
};

async function fetchCategory(
  season: number,
  category: string,
): Promise<PlayerSeasonStat[]> {
  const url = `${CFBD_BASE}/stats/player/season?year=${season}&category=${category}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CFBD_API_KEY}`, Accept: 'application/json' },
  });

  if (res.status === 401) {
    throw new Error(
      'CFBD rejected the API key. Set CFBD_API_KEY in .env — get a free one at ' +
        'https://collegefootballdata.com/key',
    );
  }
  if (res.status === 429) {
    throw new Error('CFBD rate limit hit. Wait a minute and re-run.');
  }
  if (!res.ok) {
    throw new Error(`CFBD ${category} ${season}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PlayerSeasonStat[];
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function loadCollegeSeason(season: number): Promise<number> {
  const byPlayer = new Map<string, Record<string, unknown>>();

  for (const category of CATEGORIES) {
    const rows = await fetchCategory(season, category);

    for (const r of rows) {
      const column = STAT_COLUMNS[`${r.category}|${r.statType}`];
      if (!column) continue;

      const value = toNumber(r.stat);
      if (value == null) continue;

      const id = String(r.playerId);
      const key = `${id}|${season}`;
      let row = byPlayer.get(key);
      if (!row) {
        row = {
          cfb_player_id: id,
          season,
          gsis_id: null,
          player_name: r.player,
          team: r.team,
          position: null,
          games: null,
        };
        byPlayer.set(key, row);
      }
      row[column] = value;
    }
  }

  return insertBatched(
    'college_player_season',
    [...byPlayer.values()],
    '(cfb_player_id, season)',
  );
}

export async function linkCollegeToPlayers(): Promise<{ linked: number; ambiguous: number }> {
  const linked = await sql`
    WITH cfb AS (
      SELECT cfb_player_id,
             ${sql.unsafe(normalizeSql('player_name'))} AS name_key
      FROM college_player_season
      GROUP BY cfb_player_id, player_name
    ),
    -- Only names that identify exactly one college career and one NFL player.
    cfb_unique AS (
      SELECT name_key, MIN(cfb_player_id) AS cfb_player_id
      FROM cfb GROUP BY name_key HAVING COUNT(DISTINCT cfb_player_id) = 1
    ),
    nfl_unique AS (
      SELECT ${sql.unsafe(normalizeSql('display_name'))} AS name_key,
             MIN(gsis_id) AS gsis_id
      FROM players
      WHERE position IS NOT NULL
      GROUP BY 1 HAVING COUNT(DISTINCT gsis_id) = 1
    )
    UPDATE college_player_season c
    SET gsis_id = n.gsis_id
    FROM cfb_unique u
    JOIN nfl_unique n ON n.name_key = u.name_key
    WHERE c.cfb_player_id = u.cfb_player_id
      AND c.gsis_id IS DISTINCT FROM n.gsis_id
  `;

  const [{ count: ambiguous }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM (
      SELECT ${sql.unsafe(normalizeSql('player_name'))} AS name_key
      FROM college_player_season
      GROUP BY 1 HAVING COUNT(DISTINCT cfb_player_id) > 1
    ) x
  `;

  return { linked: linked.count, ambiguous };
}

function normalizeSql(column: string): string {
  return `regexp_replace(lower(unaccent(${column})), '[^a-z0-9]', '', 'g')`;
}

export async function runCollegeIngest(
  seasonStart = COLLEGE_SEASON_START,
  seasonEnd = new Date().getFullYear(),
): Promise<{ rows: number; linked: number; ambiguous: number; skipped: number[] }> {
  let rows = 0;
  const skipped: number[] = [];

  for (let season = seasonStart; season <= seasonEnd; season++) {
    try {
      const n = await loadCollegeSeason(season);
      rows += n;
      console.log(`  ${season}: ${n} college player-seasons`);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('404')) {
        skipped.push(season);
        continue;
      }
      throw err;
    }
  }

  const { linked, ambiguous } = await linkCollegeToPlayers();
  console.log(`  ${linked} college careers linked to NFL players`);
  if (ambiguous > 0) {
    console.log(`  ${ambiguous} ambiguous names left unlinked on purpose`);
  }

  return { rows, linked, ambiguous, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runCollegeIngest();
    console.log(`College ingest complete: ${result.rows} rows, ${result.linked} linked.`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
