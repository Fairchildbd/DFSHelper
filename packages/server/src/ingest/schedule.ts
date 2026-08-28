/**
 * Schedule and depth-chart ingest.
 *
 * These two tables are what make the matchup layer possible at all: the
 * schedule says who plays whom and which staff is on each sideline, and the
 * depth chart says who is actually on the field and in what role.
 */

import { normalizePosition } from '@dfs/shared';
import { insertBatched, sql } from '../db.ts';
import { MissingSeasonError, SOURCES, int, num, str, streamCsv } from '../nflverse.ts';

interface LoadOptions {
  force?: boolean;
}

/** nflverse writes booleans as 0/1 in this file. */
function bool(value: string | undefined | null): boolean | null {
  const parsed = int(value);
  return parsed == null ? null : parsed === 1;
}

/**
 * The full schedule, every season in one file.
 *
 * Loaded unfiltered — it is only a few thousand rows in total, and the older
 * seasons are what let a coach's tendency profile draw on his whole career
 * rather than just his current job.
 */
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
      // Absent for most of the second half of a season — lookahead lines are
      // only posted a few weeks out. NULL here is normal, not missing data.
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

/**
 * Which of the three charts a row belongs to.
 *
 * `pos_grp` names the personnel package rather than the unit — '3WR 1TE',
 * 'Base 3-4 D', 'Base 4-3 D', 'Special Teams' — so defence is recognised by
 * its 'D' suffix and everything left over is offence. A new offensive package
 * name therefore lands in the right place on its own; a new defensive one
 * would have to break the naming convention to be misfiled.
 */
function unitOf(posGrp: string | null): 'offense' | 'defense' | 'special' {
  if (!posGrp) return 'offense';
  if (posGrp === 'Special Teams') return 'special';
  return /\bD$/.test(posGrp) ? 'defense' : 'offense';
}

/**
 * Current depth chart for one season.
 *
 * The upstream file is a running log rather than a snapshot: every refresh
 * appends a fresh copy of all 32 charts stamped with `dt`, so the 2026 file
 * already carries 465k rows for what is really ~3,300 current assignments.
 * Only the newest stamp per team is kept.
 *
 * Roles that are not positions — kick returner, punt returner, holder — are
 * kept, but only under `unit = 'special'` and with a null `position`. They are
 * the same players listed a second time, so every consumer that measures a
 * unit's strength filters on `position IS NOT NULL` to avoid counting a
 * receiver twice or mistaking his return job for his real place on the chart.
 */
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
      // A null position is a special-teams role (KR, PR, H) rather than an
      // unknown one. Off the special-teams chart it means a label this app
      // does not model, and there is nothing to store.
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

  // One player can hold two slots on the same chart (a guard listed at both
  // LG and RG). Keep the one where he is highest on the depth chart, since
  // that is the role he will actually play.
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

  // Replace rather than upsert: a player cut since the last run must disappear
  // from the chart, and an upsert would leave him on it forever.
  await sql`DELETE FROM depth_chart WHERE season = ${season}`;
  return insertBatched(
    'depth_chart',
    [...byKey.values()],
    '(season, team, gsis_id, pos_abb)',
  );
}
