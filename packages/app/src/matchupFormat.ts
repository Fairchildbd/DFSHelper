/**
 * Presentation helpers for the matchup layer.
 *
 * The recurring problem these solve is direction. A lane edge is signed —
 * positive means the offense holds the advantage, negative means the defense
 * does — and a raw signed number in a list is close to unreadable. Every
 * helper here turns the sign into words before it reaches the screen.
 */

import type { GameShape } from './api';
import { theme } from './theme';

/**
 * Colour for a signed edge.
 *
 * Deliberately not a symmetric red/green ramp. A large negative edge is not
 * "bad news" in the abstract — it is a strong signal, just one that says fade
 * rather than play — so both extremes get saturated colour and only the
 * genuinely even middle goes grey.
 */
export function edgeColor(edge: number | null): string {
  if (edge == null) return theme.textFaint;
  if (edge >= 45) return '#34D399';
  if (edge >= 20) return '#A3E635';
  if (edge > -20) return '#94A3B8';
  if (edge > -45) return '#FBBF24';
  return '#F87171';
}

/** Mismatch scores run roughly 29-88 in practice, so the ramp is fitted there. */
export function mismatchColor(score: number): string {
  if (score >= 70) return '#34D399';
  if (score >= 58) return '#A3E635';
  if (score >= 45) return '#94A3B8';
  return theme.textDim;
}

/**
 * Shootout scores cluster tighter than mismatch scores, so the ramp is steeper.
 *
 * Four blended percentile components regress toward the middle in a way a
 * root-mean-square of the four most extreme lanes does not, and reusing the
 * mismatch ramp painted an entire slate the same grey.
 */
export function shootoutColor(score: number): string {
  if (score >= 62) return '#34D399';
  if (score >= 54) return '#A3E635';
  if (score >= 44) return '#94A3B8';
  return theme.textDim;
}

/**
 * The four sections of the weekly list, and what each one is telling you.
 *
 * The blurb is not decoration. A section header that says only "Low-scoring"
 * leaves the reader to guess whether that is a warning or a note, and the two
 * quiet sections mean opposite things about what to do with the games in them.
 */
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

/**
 * Rewrite a signed lane headline as a sentence with a direction.
 *
 * The stored label is neutral ("CIN pass game vs TB"); which side that favours
 * lives entirely in the sign, so the label alone would tell a reader the
 * opposite of the truth half the time.
 */
export function describeEdge(label: string | null, value: number | null): string {
  if (!label || value == null) return 'No gradeable mismatch';
  const [offense, defense] = label.split(' vs ');
  if (!offense || !defense) return label;

  return value >= 0
    ? `${offense} has the edge on ${defense}`
    : `${defense} shuts down ${offense}`;
}

/** Format one tendency value according to its unit. */
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

/**
 * How a staff profile was sourced, in words the user can act on.
 *
 * This is the honest half of the coach-keyed model: when a coach is new to the
 * league there is no head-coaching record to profile, and the screen has to say
 * that it is describing the franchise's recent past rather than the man now
 * running it.
 */
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

/**
 * Kickoff clock, in words rather than in the schedule feed's raw form.
 *
 * nflverse stores gametime as a 24-hour "HH:MM" string that is always Eastern,
 * with no offset attached. Rather than guess a UTC instant from it — the offset
 * swings with DST and a wrong guess silently moves a late window game — the
 * time is relabelled in place and the zone stated outright.
 */
function formatGametime(gametime: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(gametime.trim());
  if (!match) return gametime;

  const hour24 = Number(match[1]);
  if (hour24 > 23) return gametime;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${match[2]} ${suffix} ET`;
}

/** Kickoff line: "Sun, Sep 13 · 1:00 PM ET". */
export function formatKickoff(gameday: string | null, gametime: string | null): string {
  const time = gametime ? formatGametime(gametime) : '';
  if (!gameday) return time;

  // gameday should arrive as a bare "YYYY-MM-DD", but an upstream DATE that
  // slips through as a full instant would otherwise poison the parse and get
  // printed verbatim, so take the calendar date off the front either way.
  const day = gameday.slice(0, 10);
  // Parsed as UTC deliberately: the date is a calendar date, and letting the
  // device's timezone shift it can move a Sunday game to Saturday.
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

/** Positions a DFS lineup is actually built from. */
export const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
