import { TZDate } from '@date-fns/tz';

import type { GameShape } from './api';
import { t, type MessageKey } from './i18n';
import type { Theme } from './theme';

export function edgeColor(theme: Theme, edge: number | null): string {
  if (edge == null) return theme.textFaint;
  if (edge >= 45) return theme.great;
  if (edge >= 20) return theme.good;
  if (edge > -20) return theme.even;
  if (edge > -45) return theme.weak;
  return theme.bad;
}

export function mismatchColor(theme: Theme, score: number): string {
  if (score >= 70) return theme.great;
  if (score >= 58) return theme.good;
  if (score >= 45) return theme.even;
  return theme.textDim;
}

export function shootoutColor(theme: Theme, score: number): string {
  if (score >= 62) return theme.great;
  if (score >= 54) return theme.good;
  if (score >= 44) return theme.even;
  return theme.textDim;
}

type ShapeTone = 'great' | 'good' | 'even' | 'weak';

interface ShapeCopy {
  title: string;
  blurb: string;
  tone: ShapeTone;
}

const SHAPE_KEYS: Record<
  GameShape,
  { title: MessageKey; blurb: MessageKey; tone: ShapeTone }
> = {
  shootout: { title: 'shape.shootout.title', blurb: 'shape.shootout.blurb', tone: 'great' },
  one_sided: { title: 'shape.oneSided.title', blurb: 'shape.oneSided.blurb', tone: 'good' },
  low_scoring: {
    title: 'shape.lowScoring.title',
    blurb: 'shape.lowScoring.blurb',
    tone: 'even',
  },
  defensive: { title: 'shape.defensive.title', blurb: 'shape.defensive.blurb', tone: 'weak' },
};

export function gameShapeCopy(shape: GameShape): ShapeCopy {
  const keys = SHAPE_KEYS[shape];
  return { title: t(keys.title), blurb: t(keys.blurb), tone: keys.tone };
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
  theme: Theme,
  source: 'coach' | 'team' | 'league',
  coach: string | null,
): { label: string; color: string } {
  switch (source) {
    case 'coach':
      return {
        label: t('tendency.sourceCoach', { coach: coach ?? t('tendency.coachFallback') }),
        color: theme.positive,
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
