import { TZDate } from '@date-fns/tz';

import type { GameShape } from './api';
import { t, type MessageKey } from './i18n';
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

interface ShapeCopy {
  title: string;
  blurb: string;
  color: string;
}

const SHAPE_KEYS: Record<GameShape, { title: MessageKey; blurb: MessageKey }> = {
  shootout: { title: 'shape.shootout.title', blurb: 'shape.shootout.blurb' },
  one_sided: { title: 'shape.oneSided.title', blurb: 'shape.oneSided.blurb' },
  low_scoring: { title: 'shape.lowScoring.title', blurb: 'shape.lowScoring.blurb' },
  defensive: { title: 'shape.defensive.title', blurb: 'shape.defensive.blurb' },
};

export const SHAPE_COLORS: Record<GameShape, string> = {
  shootout: '#34D399',
  one_sided: '#A3E635',
  low_scoring: '#94A3B8',
  defensive: '#FBBF24',
};

export function gameShapeCopy(shape: GameShape): ShapeCopy {
  const keys = SHAPE_KEYS[shape];
  return { title: t(keys.title), blurb: t(keys.blurb), color: SHAPE_COLORS[shape] };
}

export function describeEdge(label: string | null, value: number | null): string {
  if (!label || value == null) return t('matchup.noGradeableMismatch');
  const [offense, defense] = label.split(' vs ');
  if (!offense || !defense) return label;

  return value >= 0
    ? t('matchup.edgeFor', { offense, defense })
    : t('matchup.edgeAgainst', { offense, defense });
}

export function formatTendency(value: number, unit: string): string {
  switch (unit) {
    case 'pct':
      return t('tendency.percent', { value: value.toFixed(1) });
    case 'seconds':
      return t('tendency.seconds', { value: value.toFixed(1) });
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
      return {
        label: t('tendency.sourceCoach', { coach: coach ?? t('tendency.coachFallback') }),
        color: theme.production,
      };
    case 'team':
      return { label: t('tendency.sourceTeam'), color: theme.warn };
    default:
      return { label: t('tendency.sourceLeague'), color: theme.danger };
  }
}

const EASTERN = 'America/New_York';

export function kickoffInstant(gameday: string, gametime: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameday.trim());
  const time = /^(\d{1,2}):(\d{2})/.exec(gametime.trim());
  if (!day || !time) return null;

  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return null;

  const kickoff = new TZDate(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    hour,
    minute,
    EASTERN,
  ).getTime();

  return Number.isNaN(kickoff) ? null : new Date(kickoff);
}

function formatEasternGametime(gametime: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(gametime.trim());
  if (!match) return gametime;

  const hour24 = Number(match[1]);
  if (hour24 > 23) return gametime;
  const meridiem = hour24 < 12 ? t('kickoff.am') : t('kickoff.pm');
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return t('kickoff.eastern', { hour: hour12, minute: match[2]!, meridiem });
}

function formatCalendarDay(gameday: string): string | null {
  const date = new Date(`${gameday.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatKickoff(gameday: string | null, gametime: string | null): string {
  const instant = gameday && gametime ? kickoffInstant(gameday, gametime) : null;
  if (instant) {
    return t('kickoff.dateAndTime', {
      date: instant.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      time: instant.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }),
    });
  }

  const time = gametime ? formatEasternGametime(gametime) : '';
  if (!gameday) return time;

  const day = formatCalendarDay(gameday);
  if (!day) return time || gameday;
  return time ? t('kickoff.dateAndTime', { date: day, time }) : day;
}

export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
