
import type { GameShape } from './api';
import { theme } from './theme';

export function edgeColor(edge: number | null): string {
  if (edge == null) return theme.textFaint;
  if (edge >= 45) return '#34D399';
  if (edge >= 20) return '#A3E635';
  if (edge > -20) return '#94A3B8';
  if (edge > -45) return '#FBBF24';
  return '#F87171';
}

export function mismatchColor(score: number): string {
  if (score >= 70) return '#34D399';
  if (score >= 58) return '#A3E635';
  if (score >= 45) return '#94A3B8';
  return theme.textDim;
}

export function shootoutColor(score: number): string {
  if (score >= 62) return '#34D399';
  if (score >= 54) return '#A3E635';
  if (score >= 44) return '#94A3B8';
  return theme.textDim;
}

export const GAME_SHAPES: Record<
  GameShape,
  { title: string; blurb: string; color: string }
> = {
  shootout: {
    title: 'Shootout',
    blurb: 'Real scoring, and both offenses can get to it. Games to stack.',
    color: '#34D399',
  },
  one_sided: {
    title: 'Points, but one-sided',
    blurb:
      'The scoring is there and one team carries it. A side to attack, not a game to stack.',
    color: '#A3E635',
  },
  low_scoring: {
    title: 'Low-scoring',
    blurb:
      'Not much projected, and no defense to credit for it — these offenses simply cannot move.',
    color: '#94A3B8',
  },
  defensive: {
    title: 'Defensive games',
    blurb:
      'Quiet because the defenses are good. The mismatches here are real, but they favour the defense.',
    color: '#FBBF24',
  },
};

export function describeEdge(label: string | null, value: number | null): string {
  if (!label || value == null) return 'No gradeable mismatch';
  const [offense, defense] = label.split(' vs ');
  if (!offense || !defense) return label;

  return value >= 0
    ? `${offense} has the edge on ${defense}`
    : `${defense} shuts down ${offense}`;
}

export function formatTendency(value: number, unit: string): string {
  switch (unit) {
    case 'pct':
      return `${value.toFixed(1)}%`;
    case 'seconds':
      return `${value.toFixed(1)}s`;
    case 'epa':
      return value.toFixed(3);
    default:
      return value.toFixed(2);
  }
}

export function tendencySourceLabel(
  source: 'coach' | 'team' | 'league',
  coach: string | null,
): { label: string; color: string } {
  switch (source) {
    case 'coach':
      return { label: `${coach ?? 'Coach'}’s own record`, color: theme.production };
    case 'team':
      return { label: 'New staff — showing the team’s recent profile', color: theme.warn };
    default:
      return { label: 'League average — no profile available', color: theme.danger };
  }
}

function formatGametime(gametime: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(gametime.trim());
  if (!match) return gametime;

  const hour24 = Number(match[1]);
  if (hour24 > 23) return gametime;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${match[2]} ${suffix} ET`;
}

export function formatKickoff(gameday: string | null, gametime: string | null): string {
  const time = gametime ? formatGametime(gametime) : '';
  if (!gameday) return time;

  const day = gameday.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return time || gameday;

  const formatted = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return time ? `${formatted} · ${time}` : formatted;
}

export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
