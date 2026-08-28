
import { FTN_FIRST_SEASON, MissingSeasonError, SOURCES, int, num, str, streamCsv } from '../nflverse.ts';
import { insertBatched, sql } from '../db.ts';

interface LoadOptions {
  force?: boolean;
}

interface Acc {
  games: Set<string>;

  plays: number;
  proeSum: number;
  proeN: number;
  earlyPlays: number;
  earlyPass: number;
  paceSum: number;
  paceN: number;
  shotgun: number;
  noHuddle: number;
  deep: number;
  airN: number;
  rzPlays: number;
  rzPass: number;
  runOutside: number;
  runs: number;
  targets: number;
  targetsWR: number;
  targetsTE: number;
  targetsRB: number;

  ftnSnaps: number;
  motion: number;
  rpo: number;
  ftnDropbacks: number;
  playAction: number;
  screen: number;

  defPlays: number;
  defPass: number;
  defDropbacks: number;
  defPressure: number;
  epaPassSum: number;
  epaPassN: number;
  epaRushSum: number;
  epaRushN: number;
  explosive: number;
  explosiveN: number;

  ftnDefDropbacks: number;
  blitz: number;
  ftnDefSnaps: number;
  lightBox: number;
  heavyBox: number;
}

function emptyAcc(): Acc {
  return {
    games: new Set(),
    plays: 0, proeSum: 0, proeN: 0, earlyPlays: 0, earlyPass: 0,
    paceSum: 0, paceN: 0, shotgun: 0, noHuddle: 0, deep: 0, airN: 0,
    rzPlays: 0, rzPass: 0, runOutside: 0, runs: 0,
    targets: 0, targetsWR: 0, targetsTE: 0, targetsRB: 0,
    ftnSnaps: 0, motion: 0, rpo: 0, ftnDropbacks: 0, playAction: 0, screen: 0,
    defPlays: 0, defPass: 0, defDropbacks: 0, defPressure: 0,
    epaPassSum: 0, epaPassN: 0, epaRushSum: 0, epaRushN: 0,
    explosive: 0, explosiveN: 0,
    ftnDefDropbacks: 0, blitz: 0, ftnDefSnaps: 0, lightBox: 0, heavyBox: 0,
  };
}

class Book {
  private readonly accs = new Map<string, Acc>();

  get(key: string): Acc {
    let acc = this.accs.get(key);
    if (!acc) {
      acc = emptyAcc();
      this.accs.set(key, acc);
    }
    return acc;
  }

  entries(): IterableIterator<[string, Acc]> {
    return this.accs.entries();
  }
}

const NEUTRAL_WP_LOW = 0.2;
const NEUTRAL_WP_HIGH = 0.8;

const DEEP_AIR_YARDS = 15;

const EXPLOSIVE_YARDS = 20;

const MAX_PACE_GAP = 60;

interface PlayContext {
  offCoach: string | null;
  defCoach: string | null;
  posteam: string;
  defteam: string;
}

export async function loadTendencies(
  seasons: number[],
  opts: LoadOptions = {},
): Promise<{ coaches: number; teams: number; metrics: number }> {
  const coachRows = await sql<
    { game_id: string; home_team: string; away_team: string; home_coach: string | null; away_coach: string | null }[]
  >`
    SELECT game_id, home_team, away_team, home_coach, away_coach
    FROM games WHERE season = ANY(${seasons})
  `;
  const coachByGameTeam = new Map<string, string>();
  for (const g of coachRows) {
    if (g.home_coach) coachByGameTeam.set(`${g.game_id}|${g.home_team}`, g.home_coach);
    if (g.away_coach) coachByGameTeam.set(`${g.game_id}|${g.away_team}`, g.away_coach);
  }

  const positionRows = await sql<{ gsis_id: string; position: string | null }[]>`
    SELECT gsis_id, position FROM players WHERE position IS NOT NULL
  `;
  const positionById = new Map(positionRows.map((p) => [p.gsis_id, p.position]));

  const coachBook = new Book();
  const teamBook = new Book();

  for (const season of seasons) {
    const playIndex = new Map<string, PlayContext>();
    let plays = 0;

    try {
      let lastGame: string | null = null;
      let lastDrive: number | null = null;
      let lastSeconds: number | null = null;

      for await (const r of streamCsv(SOURCES.pbp(season), opts)) {
        if (str(r.season_type) !== 'REG') continue;

        const gameId = str(r.game_id);
        const posteam = str(r.posteam);
        const defteam = str(r.defteam);
        const playType = str(r.play_type);
        if (!gameId || !posteam || !defteam) continue;

        if (playType !== 'pass' && playType !== 'run') continue;
        if (int(r.qb_kneel) === 1 || int(r.qb_spike) === 1) continue;
        if (int(r.play_deleted) === 1 || int(r.aborted_play) === 1) continue;

        const offCoach = coachByGameTeam.get(`${gameId}|${posteam}`) ?? null;
        const defCoach = coachByGameTeam.get(`${gameId}|${defteam}`) ?? null;

        const playId = str(r.play_id);
        if (playId) {
          playIndex.set(`${gameId}|${playId}`, { offCoach, defCoach, posteam, defteam });
        }
        plays++;

        const isPass = playType === 'pass';
        const wp = num(r.wp);
        const neutral = wp != null && wp >= NEUTRAL_WP_LOW && wp <= NEUTRAL_WP_HIGH;

        const seconds = num(r.game_seconds_remaining);
        const drive = int(r.fixed_drive);
        const sameSeries = gameId === lastGame && drive === lastDrive;
        const gap =
          sameSeries && seconds != null && lastSeconds != null ? lastSeconds - seconds : null;
        lastGame = gameId;
        lastDrive = drive;
        lastSeconds = seconds;

        const offTargets: Acc[] = [];
        if (offCoach) offTargets.push(coachBook.get(offCoach));
        offTargets.push(teamBook.get(posteam));

        const defTargets: Acc[] = [];
        if (defCoach) defTargets.push(coachBook.get(defCoach));
        defTargets.push(teamBook.get(defteam));

        const down = int(r.down);
        const yardline = int(r.yardline_100);
        const airYards = num(r.air_yards);
        const runLocation = str(r.run_location);
        const receiver = str(r.receiver_player_id);
        const epa = num(r.epa);
        const yardsGained = num(r.yards_gained);
        const qbHit = int(r.qb_hit) === 1;
        const sack = int(r.sack) === 1;

        for (const acc of offTargets) {
          acc.games.add(gameId);

          if (gap != null && gap > 0 && gap <= MAX_PACE_GAP) {
            acc.paceSum += gap;
            acc.paceN++;
          }

          if (!neutral) continue;

          acc.plays++;
          if (int(r.shotgun) === 1) acc.shotgun++;
          if (int(r.no_huddle) === 1) acc.noHuddle++;

          const passOe = num(r.pass_oe);
          if (passOe != null) {
            acc.proeSum += passOe;
            acc.proeN++;
          }

          if (down === 1 || down === 2) {
            acc.earlyPlays++;
            if (isPass) acc.earlyPass++;
          }

          if (yardline != null && yardline <= 20) {
            acc.rzPlays++;
            if (isPass) acc.rzPass++;
          }

          if (isPass && airYards != null) {
            acc.airN++;
            if (airYards >= DEEP_AIR_YARDS) acc.deep++;
          }

          if (!isPass && runLocation) {
            acc.runs++;
            if (runLocation === 'left' || runLocation === 'right') acc.runOutside++;
          }

          if (isPass && receiver) {
            const position = positionById.get(receiver);
            acc.targets++;
            if (position === 'WR') acc.targetsWR++;
            else if (position === 'TE') acc.targetsTE++;
            else if (position === 'RB' || position === 'FB') acc.targetsRB++;
          }
        }

        for (const acc of defTargets) {
          acc.games.add(gameId);
          if (!neutral) continue;

          acc.defPlays++;
          if (isPass) acc.defPass++;

          if (isPass) {
            acc.defDropbacks++;
            if (qbHit || sack) acc.defPressure++;
            if (epa != null) {
              acc.epaPassSum += epa;
              acc.epaPassN++;
            }
          } else if (epa != null) {
            acc.epaRushSum += epa;
            acc.epaRushN++;
          }

          if (yardsGained != null) {
            acc.explosiveN++;
            if (yardsGained >= EXPLOSIVE_YARDS) acc.explosive++;
          }
        }
      }
    } catch (err) {
      if (err instanceof MissingSeasonError) {
        console.log(`  play-by-play for ${season} not published yet — skipped`);
        continue;
      }
      throw err;
    }

    console.log(`  ${season}: ${plays.toLocaleString()} scrimmage plays`);

    if (season >= FTN_FIRST_SEASON) {
      let charted = 0;
      try {
        for await (const r of streamCsv(SOURCES.ftn(season), opts)) {
          const gameId = str(r.nflverse_game_id);
          const playId = str(r.nflverse_play_id);
          if (!gameId || !playId) continue;

          const ctx = playIndex.get(`${gameId}|${playId}`);
          if (!ctx) continue;
          charted++;

          const motion = str(r.is_motion) === 'TRUE' || int(r.is_motion) === 1;
          const rpo = str(r.is_rpo) === 'TRUE' || int(r.is_rpo) === 1;
          const playAction = str(r.is_play_action) === 'TRUE' || int(r.is_play_action) === 1;
          const screen = str(r.is_screen_pass) === 'TRUE' || int(r.is_screen_pass) === 1;
          const blitzers = int(r.n_blitzers);
          const box = int(r.n_defense_box);
          const rushers = int(r.n_pass_rushers);
          const isDropback = rushers != null && rushers > 0;

          const offAccs: Acc[] = [];
          if (ctx.offCoach) offAccs.push(coachBook.get(ctx.offCoach));
          offAccs.push(teamBook.get(ctx.posteam));

          for (const acc of offAccs) {
            acc.ftnSnaps++;
            if (motion) acc.motion++;
            if (rpo) acc.rpo++;
            if (isDropback) {
              acc.ftnDropbacks++;
              if (playAction) acc.playAction++;
              if (screen) acc.screen++;
            }
          }

          const defAccs: Acc[] = [];
          if (ctx.defCoach) defAccs.push(coachBook.get(ctx.defCoach));
          defAccs.push(teamBook.get(ctx.defteam));

          for (const acc of defAccs) {
            if (box != null && box > 0) {
              acc.ftnDefSnaps++;
              if (box <= 6) acc.lightBox++;
              if (box >= 8) acc.heavyBox++;
            }
            if (isDropback && blitzers != null) {
              acc.ftnDefDropbacks++;
              if (blitzers >= 1 && rushers! >= 5) acc.blitz++;
            }
          }
        }
        console.log(`  ${season}: ${charted.toLocaleString()} plays charted by FTN`);
      } catch (err) {
        if (err instanceof MissingSeasonError) {
          console.log(`  FTN charting for ${season} not published yet — skipped`);
        } else {
          throw err;
        }
      }
    }

    playIndex.clear();
  }

  const seasonLabel = seasons.join(',');
  const coachRowsOut: Record<string, unknown>[] = [];
  const teamRowsOut: Record<string, unknown>[] = [];

  for (const [coach, acc] of coachBook.entries()) {
    for (const { side, metric, value } of deriveMetrics(acc)) {
      coachRowsOut.push({
        coach, side, metric, value,
        n_plays: side === 'offense' ? acc.plays : acc.defPlays,
        n_games: acc.games.size,
        seasons: seasonLabel,
      });
    }
  }

  for (const [team, acc] of teamBook.entries()) {
    for (const { side, metric, value } of deriveMetrics(acc)) {
      teamRowsOut.push({
        team, side, metric, value,
        n_plays: side === 'offense' ? acc.plays : acc.defPlays,
        n_games: acc.games.size,
      });
    }
  }

  await sql`TRUNCATE coach_tendencies`;
  await sql`TRUNCATE team_tendencies`;
  await insertBatched('coach_tendencies', coachRowsOut, '(coach, side, metric)');
  await insertBatched('team_tendencies', teamRowsOut, '(team, side, metric)');

  const coaches = new Set(coachRowsOut.map((r) => r.coach)).size;
  const teams = new Set(teamRowsOut.map((r) => r.team)).size;
  return { coaches, teams, metrics: coachRowsOut.length + teamRowsOut.length };
}

interface DerivedMetric {
  side: 'offense' | 'defense';
  metric: string;
  value: number;
}

function deriveMetrics(acc: Acc): DerivedMetric[] {
  const out: DerivedMetric[] = [];
  const push = (side: 'offense' | 'defense', metric: string, value: number | null) => {
    if (value != null && Number.isFinite(value)) out.push({ side, metric, value });
  };
  const ratio = (n: number, d: number, scale = 100) => (d > 0 ? (n / d) * scale : null);

  push('offense', 'proe', acc.proeN > 0 ? acc.proeSum / acc.proeN : null);
  push('offense', 'pass_rate_early', ratio(acc.earlyPass, acc.earlyPlays));
  push('offense', 'sec_per_play', acc.paceN > 0 ? acc.paceSum / acc.paceN : null);
  push('offense', 'shotgun_rate', ratio(acc.shotgun, acc.plays));
  push('offense', 'no_huddle_rate', ratio(acc.noHuddle, acc.plays));
  push('offense', 'deep_rate', ratio(acc.deep, acc.airN));
  push('offense', 'rz_pass_rate', ratio(acc.rzPass, acc.rzPlays));
  push('offense', 'run_outside_rate', ratio(acc.runOutside, acc.runs));
  push('offense', 'play_action_rate', ratio(acc.playAction, acc.ftnDropbacks));
  push('offense', 'motion_rate', ratio(acc.motion, acc.ftnSnaps));
  push('offense', 'screen_rate', ratio(acc.screen, acc.ftnDropbacks));
  push('offense', 'rpo_rate', ratio(acc.rpo, acc.ftnSnaps));
  push('offense', 'wr_target_share', ratio(acc.targetsWR, acc.targets));
  push('offense', 'te_target_share', ratio(acc.targetsTE, acc.targets));
  push('offense', 'rb_target_share', ratio(acc.targetsRB, acc.targets));

  push('defense', 'blitz_rate', ratio(acc.blitz, acc.ftnDefDropbacks));
  push('defense', 'pressure_rate', ratio(acc.defPressure, acc.defDropbacks));
  push('defense', 'light_box_rate', ratio(acc.lightBox, acc.ftnDefSnaps));
  push('defense', 'heavy_box_rate', ratio(acc.heavyBox, acc.ftnDefSnaps));
  push('defense', 'epa_allowed_pass', acc.epaPassN > 0 ? acc.epaPassSum / acc.epaPassN : null);
  push('defense', 'epa_allowed_rush', acc.epaRushN > 0 ? acc.epaRushSum / acc.epaRushN : null);
  push('defense', 'explosive_allowed_rate', ratio(acc.explosive, acc.explosiveN));
  push('defense', 'pass_rate_faced', ratio(acc.defPass, acc.defPlays));

  return out;
}
