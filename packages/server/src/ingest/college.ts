/**
 * College production ingest, from the CollegeFootballData API.
 *
 * Two things about this source shape the code:
 *
 * The stats endpoint returns *long* format — one row per
 * (player, category, statType) — so a player's season is scattered across a
 * dozen rows that have to be pivoted back into columns. Category matters when
 * pivoting: `passing/INT` is an interception thrown and `interceptions/INT` is
 * one caught. Collapsing on statType alone would credit quarterbacks with
 * takeaways.
 *
 * And CFBD's player ids are its own numeric ids, unrelated to the slug-style
 * `cfb_id` nflverse carries. There is no shared key, so linking a college
 * career to an NFL player is done on name + school, and any match that is not
 * unique is left unlinked rather than guessed at.
 */

import { insertBatched, sql } from '../db.ts';
import { CFBD_API_KEY, COLLEGE_SEASON_START } from '../env.ts';

const CFBD_BASE = 'https://apinext.collegefootballdata.com';

/**
 * Categories worth pulling. `interceptions` is separate from `defensive`
 * upstream, and both are needed for defensive backs.
 */
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

/**
 * Maps a (category, statType) pair onto a column. Anything not listed is
 * ignored, which keeps the pivot resilient to CFBD adding stat types.
 */
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

  // Interceptions caught live in their own category; the `defensive|INT` pair
  // does not exist upstream, and `passing|INT` means the opposite thing.
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

/** Pull one season, pivot it, and upsert. */
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
          gsis_id: null, // linked after load, by name + school
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

/**
 * Resolve college careers onto NFL players.
 *
 * The only shared identity is the player's name. School would be the natural
 * confirmer, but the two feeds disagree on how to spell one ("Ole Miss" vs
 * "Mississippi", "USC" vs "Southern California"), so it would reject correct
 * matches more often than it caught wrong ones — matching is on normalized name
 * alone, and uniqueness carries the burden instead.
 *
 * A name that maps to more than one college career, or more than one NFL
 * player, is left unlinked. Attaching the wrong college career to a player is
 * worse than leaving the component empty, which the engine already handles by
 * renormalizing the remaining weights.
 */
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

/**
 * Lowercase, strip accents and punctuation — the same shape `slugify` produces,
 * so a name normalizes identically whether it arrives from CFBD or nflverse.
 * Requires the `unaccent` extension, created by the migration.
 */
function normalizeSql(column: string): string {
  return `regexp_replace(lower(unaccent(${column})), '[^a-z0-9]', '', 'g')`;
}

/**
 * Load every college season in range, then link.
 *
 * Seasons are fetched one at a time rather than in parallel: CFBD's free tier
 * rate-limits, and a burst of concurrent requests earns a 429 that costs more
 * time than it saves.
 */
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
      // A season that has not been played yet is expected, not a failure.
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
