
import type { DkPosition } from './dfs.js';

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export const UNAVAILABLE_TIER: Tier = 6;

export const UNAVAILABLE_STATUS = new Set(['IR', 'OUT', 'PUP', 'D', 'NA', 'SUSP']);

export const TIER_ONE_SALARY_SHARE = 0.5;

export const TIER_TWO_TARGETS_PER_GAME = 3;

export const TIER_TWO_TOUCHES_PER_GAME = 5;

const SPECIALIST_POSITIONS = new Set<DkPosition>(['K', 'DST']);

export interface TierInput {
  id: string;
  position: DkPosition;
  team: string;
  salary: number;
  posRank: number | null;
  targetsPerGame: number | null;
  touchesPerGame: number | null;
  status: string | null;
}

export type Tiered<T> = T & { tier: Tier };

type DepthRole = 'leads' | 'reserve';

export function isUnavailable(player: TierInput): boolean {
  return player.status != null && UNAVAILABLE_STATUS.has(player.status.toUpperCase());
}

function leadsHisPosition(player: TierInput): boolean {
  return player.posRank === 1;
}

function carriesRealVolume(player: TierInput): boolean {
  const targets = player.targetsPerGame;
  const touches = player.touchesPerGame;
  return (
    (targets != null && targets >= TIER_TWO_TARGETS_PER_GAME) ||
    (touches != null && touches >= TIER_TWO_TOUCHES_PER_GAME)
  );
}

function teamsWithoutTheirStarter(players: readonly TierInput[]): Set<string> {
  const starters = new Map<string, TierInput[]>();
  for (const player of players) {
    if (player.position !== 'QB' || !leadsHisPosition(player)) continue;
    const listed = starters.get(player.team);
    if (listed) listed.push(player);
    else starters.set(player.team, [player]);
  }

  const open = new Set<string>();
  for (const [team, qbs] of starters) {
    if (qbs.every(isUnavailable)) open.add(team);
  }
  return open;
}

function inheritedStarterIds(players: readonly TierInput[]): Set<string> {
  const open = teamsWithoutTheirStarter(players);
  const heir = new Map<string, TierInput>();

  for (const player of players) {
    if (player.position !== 'QB') continue;
    if (!open.has(player.team) || leadsHisPosition(player) || isUnavailable(player)) continue;

    const standing = heir.get(player.team);
    const ahead =
      standing == null ||
      player.salary > standing.salary ||
      (player.salary === standing.salary && player.id < standing.id);
    if (ahead) heir.set(player.team, player);
  }

  return new Set([...heir.values()].map((player) => player.id));
}

function tierFor(
  player: TierInput,
  context: { topSkillSalary: number; role: DepthRole },
): Tier {
  if (isUnavailable(player)) return UNAVAILABLE_TIER;
  if (SPECIALIST_POSITIONS.has(player.position)) return 3;

  const leads = context.role === 'leads';
  const pricedWithStarters =
    context.topSkillSalary > 0 &&
    player.salary >= context.topSkillSalary * TIER_ONE_SALARY_SHARE;

  if (leads && pricedWithStarters) return 1;
  if (leads && player.position === 'QB') return 2;
  if (player.position === 'QB') return 5;
  if (carriesRealVolume(player)) return 2;
  return 4;
}

export function assignTiers<T extends TierInput>(players: readonly T[]): Tiered<T>[] {
  const topSkillSalary = new Map<string, number>();
  for (const player of players) {
    if (SPECIALIST_POSITIONS.has(player.position) || isUnavailable(player)) continue;
    if (player.salary > (topSkillSalary.get(player.team) ?? 0)) {
      topSkillSalary.set(player.team, player.salary);
    }
  }

  const inherited = inheritedStarterIds(players);

  return players.map((player) => ({
    ...player,
    tier: tierFor(player, {
      topSkillSalary: topSkillSalary.get(player.team) ?? 0,
      role: leadsHisPosition(player) || inherited.has(player.id) ? 'leads' : 'reserve',
    }),
  }));
}
