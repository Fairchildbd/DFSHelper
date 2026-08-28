
import { normalizePosition } from '@dfs/shared';
import { insertBatched, sql } from '../db.ts';
import { MissingSeasonError, SOURCES, int, num, str, streamCsv } from '../nflverse.ts';

interface LoadOptions {
  force?: boolean;
}

function bool(value: string | undefined | null): boolean | null {
  const parsed = int(value);
  return parsed == null ? null : parsed === 1;
}

export async function loadSchedule(opts: LoadOptions = {}): Promise<number> {
  const rows: Record<string, unknown>[] = [];

  for await (const r of streamCsv(SOURCES.schedules, opts)) {
    const gameId = str(r.game_id);
    const season = int(r.season);
    const week = int(r.week);
    if (!gameId || season == null || week == null) continue;

    rows.push({
      game_id: gameId,
      season,
      week,
      game_type: str(r.game_type) ?? 'REG',
      gameday: str(r.gameday),
      weekday: str(r.weekday),
      gametime: str(r.gametime),
      home_team: str(r.home_team) ?? '',
      away_team: str(r.away_team) ?? '',
      home_coach: str(r.home_coach),
      away_coach: str(r.away_coach),
      home_score: int(r.home_score),
      away_score: int(r.away_score),
      spread_line: num(r.spread_line),
      total_line: num(r.total_line),
      roof: str(r.roof),
      surface: str(r.surface),
      div_game: bool(r.div_game),
      home_rest: int(r.home_rest),
      away_rest: int(r.away_rest),
      stadium: str(r.stadium),
    });
  }

  const filtered = rows.filter((r) => r.home_team && r.away_team);
  return insertBatched('games', filtered, '(game_id)');
}

function unitOf(posGrp: string | null): 'offense' | 'defense' | 'special' {
  if (!posGrp) return 'offense';
  if (posGrp === 'Special Teams') return 'special';
  return /\bD$/.test(posGrp) ? 'defense' : 'offense';
}

export async function loadDepthChart(
  season: number,
  opts: LoadOptions = {},
): Promise<number> {
  const latestStamp = new Map<string, string>();
  const byTeam = new Map<string, Record<string, unknown>[]>();

  try {
    for await (const r of streamCsv(SOURCES.depthCharts(season), opts)) {
      const team = str(r.team);
      const gsis = str(r.gsis_id);
      const stamp = str(r.dt);
      const posAbb = str(r.pos_abb);
      if (!team || !gsis || !stamp || !posAbb) continue;

      const known = latestStamp.get(team);
      if (known == null || stamp > known) {
        latestStamp.set(team, stamp);
        byTeam.set(team, []);
      } else if (stamp < known) {
        continue;
      }

      const posGrp = str(r.pos_grp);
      const unit = unitOf(posGrp);
      const position = normalizePosition(posAbb);
      if (!position && unit !== 'special') continue;

      byTeam.get(team)!.push({
        season,
        team,
        gsis_id: gsis,
        pos_abb: posAbb,
        pos_name: str(r.pos_name),
        pos_grp: posGrp,
        pos_rank: int(r.pos_rank),
        position,
        pos_slot: int(r.pos_slot),
        unit,
        snapshot: stamp,
      });
    }
  } catch (err) {
    if (err instanceof MissingSeasonError) {
      console.log(`  depth charts for ${season} not published yet — skipped`);
      return 0;
    }
    throw err;
  }

  const byKey = new Map<string, Record<string, unknown>>();
  for (const rows of byTeam.values()) {
    for (const row of rows) {
      const key = `${row.team}|${row.gsis_id}|${row.pos_abb}`;
      const existing = byKey.get(key);
      if (existing && Number(existing.pos_rank ?? 99) <= Number(row.pos_rank ?? 99)) {
        continue;
      }
      byKey.set(key, row);
    }
  }

  await sql`DELETE FROM depth_chart WHERE season = ${season}`;
  return insertBatched(
    'depth_chart',
    [...byKey.values()],
    '(season, team, gsis_id, pos_abb)',
  );
}
