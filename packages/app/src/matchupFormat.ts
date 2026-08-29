import type { GameShape } from './api';
import type { Theme } from './theme';

export function edgeColor(t: Theme, edge: number | null): string {
  if (edge == null) return t.textFaint;
  if (edge >= 45) return t.great;
  if (edge >= 20) return t.good;
  if (edge > -20) return t.even;
  if (edge > -45) return t.weak;
  return t.bad;
}

export function mismatchColor(t: Theme, score: number): string {
  if (score >= 70) return t.great;
  if (score >= 58) return t.good;
  if (score >= 45) return t.even;
  return t.textDim;
}

export function shootoutColor(t: Theme, score: number): string {
  if (score >= 62) return t.great;
  if (score >= 54) return t.good;
  if (score >= 44) return t.even;
  return t.textDim;
}

export const GAME_SHAPES: Record<
  GameShape,
  { title: string; blurb: string; tone: 'great' | 'good' | 'even' | 'weak' }
> = {
  shootout: {
    title: 'Shootout',
    blurb: 'Real scoring, and both offenses can get to it. Games to stack.',
    tone: 'great',
  },
  one_sided: {
    title: 'Points, but one-sided',
    blurb:
      'The scoring is there and one team carries it. A side to attack, not a game to stack.',
    tone: 'good',
  },
  low_scoring: {
    title: 'Low-scoring',
    blurb:
      'Not much projected, and no defense to credit for it — these offenses simply cannot move.',
    tone: 'even',
  },
  defensive: {
    title: 'Defensive games',
    blurb:
      'Quiet because the defenses are good. The mismatches here are real, but they favour the defense.',
    tone: 'weak',
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
  t: Theme,
  source: 'coach' | 'team' | 'league',
  coach: string | null,
): { label: string; color: string } {
  switch (source) {
    case 'coach':
      return { label: `${coach ?? 'Coach'}’s own record`, color: t.positive };
    case 'team':
      return { label: 'New staff — showing the team’s recent profile', color: t.warn };
    default:
      return { label: 'League average — no profile available', color: t.danger };
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
