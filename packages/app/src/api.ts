/**
 * API client.
 *
 * The base URL matters more than it looks: an iOS simulator can reach the host
 * on localhost, but a physical device or Android emulator cannot. Set
 * EXPO_PUBLIC_API_URL to your machine's LAN address when testing on hardware.
 */

import { Platform } from 'react-native';

const DEFAULT_HOST =
  Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_HOST;

export interface RankedPlayer {
  gsis_id: string;
  display_name: string;
  position: string;
  cohort: string;
  team: string | null;
  age: number | null;
  years_experience: number | null;
  composite: number;
  athletic_score: number | null;
  athletic_confidence: number | null;
  production_score: number | null;
  production_confidence: number | null;
  production_weight: number | null;
  college_score: number | null;
  college_confidence: number | null;
  weight_athletic: number | null;
  weight_college: number | null;
  weight_nfl: number | null;
  /** Position-appropriate opportunities behind the production score. */
  opportunities: number | null;
  /** False means too little playing time to rank, not poor play. */
  qualified: boolean | null;
  /** Games started in the window. */
  starts: number | null;
  /**
   * Sort tier applied before score. 0 everywhere except quarterback, where
   * 1 = spot starter and 2 = never started.
   */
  rank_tier: number | null;
  position_rank: number;
  overall_rank: number;
}

/**
 * Normalize the flat weight columns into the shape ScoreSplitBar expects.
 *
 * Fields are optional so a caller holding only a player's identity — the
 * matchup screen, before its detail fetch lands — can still render the bar.
 */
export function weightsOf(p: {
  weight_athletic?: number | null;
  weight_college?: number | null;
  weight_nfl?: number | null;
}) {
  return {
    athletic: Number(p.weight_athletic ?? 0),
    college: Number(p.weight_college ?? 0),
    nfl: Number(p.weight_nfl ?? 0),
  };
}

export interface MetricDetail {
  metric: string;
  label: string;
  raw: number | null;
  percentile: number | null;
  weight: number;
  scope: string | null;
}

export interface Component {
  /** 0-100 over recorded metrics only. Never discounted for what is missing. */
  score: number | null;
  confidence: number;
  sampleConfidence?: number;
  metrics: MetricDetail[];
}

export interface PlayerDetail extends RankedPlayer {
  headshot_url: string | null;
  college: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_pick: number | null;
  jersey_number: number | null;
  detail: {
    athletic: Component;
    college: Component;
    production: Component;
    lowSignalMeasurables: boolean;
    lowSignalProduction: boolean;
    noRecentProduction: boolean;
  };
  measurables: Array<{
    source: string;
    season: number | null;
    school: string | null;
    forty: string | null;
    bench: number | null;
    vertical: string | null;
    broad: number | null;
    cone: string | null;
    shuttle: string | null;
  }>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${API_URL}${path}`);
  }
  return (await res.json()) as T;
}

export function fetchRankings(params: {
  position?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; limit: number; offset: number; players: RankedPlayer[] }> {
  const query = new URLSearchParams();
  if (params.position) query.set('position', params.position);
  if (params.search) query.set('search', params.search);
  query.set('limit', String(params.limit ?? 50));
  query.set('offset', String(params.offset ?? 0));
  return get(`/rankings?${query.toString()}`);
}

// ---------------------------------------------------------------------------
// DraftKings lineups
// ---------------------------------------------------------------------------

export type ContestType = 'classic' | 'showdown';

export interface SlateSummary {
  contest: ContestType;
  /** Set for a single-game slate, which is what a showdown is. */
  game_id: string | null;
  players: number;
  games: number;
  imported_at: string;
}

export type StrategyKey = 'mismatch';

export interface StrategyDefinition {
  key: StrategyKey;
  label: string;
  tagline: string;
  description: string;
}

export interface LineupPick {
  id: string;
  name: string;
  position: string;
  team: string;
  gameId: string;
  slot: string;
  salary: number;
  /** Salary after the captain multiplier. */
  cost: number;
  multiplier: number;
  /** The matchup grade this seat was bought for, 0-100. */
  matchupScore: number | null;
  /** Seat value, and the same after the multiplier. */
  value: number;
  weight: number;
  /** The unit edge behind the grade. */
  laneEdge: number | null;
  /** DraftKings' injury flag; only 'Q' or null survives into a lineup. */
  status: string | null;
  note: string;
}

export interface Lineup {
  picks: LineupPick[];
  salary: number;
  value: number;
  /** Mean matchup grade across the roster — the headline number. */
  averageGrade: number;
  remaining: number;
}

/**
 * One of the three showdown entries.
 *
 * A single game correlates its own seats, so a showdown answer is a set: one
 * entry per team having the day, and one for a game that never gets going.
 * `description` is the engine's own account of what the build is betting on,
 * served rather than written into the screen so the two cannot drift.
 */
export interface ShowdownBuild {
  key: string;
  label: string;
  description: string;
  /** The team it is betting on; null for the slow-game entry. */
  team: string | null;
  lineup: Lineup | null;
  problem: string | null;
}

/**
 * The model's read on which way the game goes.
 *
 * Advisory. It is null whenever too few lanes are graded to support one, and a
 * null read is shown as "no read" rather than hidden — that a game is genuinely
 * unreadable is worth knowing before entering four lineups into it.
 */
export interface GameScriptRead {
  /** The build key it points at. */
  scenario: string;
  team: string | null;
  confidence: 'strong' | 'slight';
  why: string;
  /** Mean lane edge for each side, away first. */
  lanes: [number, number];
}

export interface LineupResponse {
  season: number;
  week: number;
  contest: ContestType;
  strategy: StrategyKey;
  /** The stacked game, when one was stacked. */
  stack: {
    gameId: string;
    label: string;
    mismatchScore: number | null;
    players: number;
  } | null;
  /** Season the defensive takeaway rates came from. */
  baselineSeason: number;
  poolSize: number;
  /** Priced players the model never graded — filler only. */
  ungraded: number;
  /** Priced players left out of the pool as out or on injured reserve. */
  unavailable: number;
  lineup: Lineup | null;
  /** Showdown only: the model's read, when the lanes support one. */
  read: GameScriptRead | null;
  /** Showdown only: the four entries. Null for a classic slate. */
  builds: ShowdownBuild[] | null;
  bench: LineupPick[];
  problem: string | null;
}

export function fetchSlates(): Promise<{
  season: number | null;
  week: number | null;
  slates: SlateSummary[];
  strategies: StrategyDefinition[];
}> {
  return get('/slates');
}

export function fetchLineup(params: {
  contest: ContestType;
  strategy: StrategyKey;
  gameId?: string | null;
  stackGame?: string | null;
  locks?: string[];
  excludes?: string[];
}): Promise<LineupResponse> {
  const query = new URLSearchParams({ contest: params.contest, strategy: params.strategy });
  if (params.gameId) query.set('gameId', params.gameId);
  if (params.stackGame) query.set('stackGame', params.stackGame);
  if (params.locks?.length) query.set('locks', params.locks.join(','));
  if (params.excludes?.length) query.set('excludes', params.excludes.join(','));
  return get(`/lineup?${query.toString()}`);
}

export function fetchPlayer(id: string): Promise<PlayerDetail> {
  return get(`/players/${id}`);
}

export interface Meta {
  cohorts: Array<{ key: string; label: string; weights: Record<string, number> }>;
  drills: Array<{ key: string; label: string; unit: string }>;
  positions: Array<{ position: string; count: number }>;
  lastIngest: { finished_at: string | null; status: string } | null;
}

export function fetchMeta(): Promise<Meta> {
  return get('/meta');
}

// ---------------------------------------------------------------------------
// Matchups
// ---------------------------------------------------------------------------

/**
 * What kind of game this is — the weekly list groups by it rather than ranking
 * on one axis. Mirrors `GameShape` in @dfs/shared; the server decides which one
 * a game is, and the order the sections appear in comes back as `shapeOrder`.
 */
export type GameShape = 'shootout' | 'one_sided' | 'low_scoring' | 'defensive';

export interface MatchupSummary {
  game_id: string;
  season: number;
  week: number;
  game_type?: string;
  gameday: string | null;
  gametime: string | null;
  home_team: string;
  away_team: string;
  home_coach: string | null;
  away_coach: string | null;
  mismatch_score: string;
  edge_score: string;
  edge_count: number;
  total_line: string | null;
  spread_line: string | null;
  top_edge_label: string | null;
  top_edge_value: string | null;
  /**
   * The scoring-environment read, 0-100. Null for rows built before this
   * existed and for games with no gradeable lane.
   */
  shootout_score?: string | null;
  /** False when no Vegas total exists, so the market's view is missing from it. */
  shootout_applied?: boolean | null;
  /** Team whose offense carries the game. Null when the two sides are even. */
  lean_team?: string | null;
  /** Percentile points between the stronger offense and the weaker. */
  lean_margin?: string | null;
  /** Which section of the weekly list this game belongs to. */
  game_shape?: GameShape | null;
  /** Populated once the game is final. Null while it is still a forecast. */
  home_score?: number | null;
  away_score?: number | null;
  /** How many of the ten highest-graded players finished in the real top ten. */
  top10_hits?: number | null;
  /** True when the prediction was generated after the game had been played. */
  backfilled?: boolean;
  locked?: boolean;
  result_at?: string | null;
}

export interface LaneEdgeDetail {
  lane: string;
  label: string;
  edge: number | null;
  offenseStrength: number | null;
  defenseStrength: number | null;
  usageAdjustment: number;
}

export interface TendencyValue {
  metric: string;
  value: number;
  percentile: number | null;
  /** Placing among the league's staffs on this metric, 1 = the most of it. */
  rank: number | null;
  /** How many staffs that rank is out of. 32 once every team has played. */
  rankOf: number | null;
}

export interface StaffProfile {
  /** 'coach' when profiled from his own games; 'team' when he is a new hire. */
  source: 'coach' | 'team' | 'league';
  confidence: number;
  nGames: number;
  metrics: TendencyValue[];
}

export interface SideProfile {
  team: string;
  coach: string | null;
  offense: StaffProfile;
  defense: StaffProfile;
}

export interface MatchupPlayer {
  gsis_id: string;
  team: string;
  opponent: string;
  display_name: string;
  position: string;
  pos_rank: number | null;
  lane: string | null;
  matchup_score: string;
  confidence: string;
  composite: string | null;
  lane_edge: string | null;
  volume_score: string | null;
  headshot_url: string | null;
  actual_points: string | null;
  actual_rank: number | null;
  predicted_rank: number | null;
  actual_line: {
    receptions: number | null;
    targets: number | null;
    receivingYards: number | null;
    rushingYards: number | null;
    passingYards: number | null;
    tds: number | null;
  } | null;
  detail: {
    laneLabel: string;
    coach: string | null;
    tendencySource: 'coach' | 'team' | 'league';
    tendencyConfidence: number;
    factors: Array<{
      key: string;
      label: string;
      value: number | null;
      weight: number;
      note: string;
    }>;
  };
}

/**
 * One player at one lineup slot — the starter, never a backup.
 *
 * A slot is not a position: three receivers all list as 'WR' and only the slot
 * separates WR1 from WR3, which is why the server picks per slot rather than
 * per position.
 */
export interface MatchupStarter {
  team: string;
  unit: 'offense' | 'defense' | 'special';
  /** Upstream lineup slot. Ordering is already applied by the server. */
  slot: number | null;
  /** Depth-chart abbreviation for the slot: 'WR', 'LCB', 'PK'. */
  role: string;
  /** Long form of the same: 'Wide Receiver', 'Place kicker'. */
  role_name: string | null;
  gsis_id: string;
  display_name: string;
  /** Null on return and holder rows, which are jobs rather than positions. */
  position: string | null;
  pos_rank: number | null;
  composite: number | null;
  position_rank: number | null;
  headshot_url: string | null;
}

export interface MatchupDetail extends MatchupSummary {
  stadium: string | null;
  roof: string | null;
  div_game: boolean | null;
  detail: {
    edges: LaneEdgeDetail[];
    pacePercentile: number | null;
    home: SideProfile;
    away: SideProfile;
  };
  players: MatchupPlayer[];
  starters: MatchupStarter[];
}

export interface WeekInfo {
  season: number;
  week: number;
  games: number;
  played: number;
  /** How many of this week's games have a prediction built. */
  built: number;
  kickoff: string | null;
}

export function fetchWeeks(): Promise<{
  weeks: WeekInfo[];
  current: { season: number; week: number } | null;
  /** True when no game in the current week has kicked off yet. */
  upcoming: boolean;
}> {
  return get('/weeks');
}

export function fetchMatchups(params: {
  season: number;
  week: number;
}): Promise<{ games: MatchupSummary[]; shapeOrder: GameShape[] }> {
  return get(`/matchups?season=${params.season}&week=${params.week}`);
}

export function fetchMatchup(gameId: string): Promise<MatchupDetail> {
  return get(`/matchups/${gameId}`);
}

/**
 * The model's own constants, served rather than hardcoded.
 *
 * The About tab quotes these in prose. Serving them means the explanation
 * cannot drift from the engine: change the threshold in `@dfs/shared` and the
 * sentence describing it changes with it.
 */
export interface MatchupModel {
  edgeThreshold: number;
  /** How many of the biggest lane edges feed a game's score. */
  topEdges: number;
  /** Percentile points a coach's usage tendency may move a lane edge. */
  maxUsageAdjustment: number;
  /** How much a defense-favourable lane counts toward the mismatch score. */
  defenseEdgeWeight: number;
  /** What each part of the scoring environment is worth. */
  shootoutWeights: { total: number; offense: number; defense: number; pace: number };
  /** Total at which the shootout score's market component bottoms out. */
  shootoutTotalFloor: number;
  /** Total at which it saturates. */
  shootoutTotalCeiling: number;
  /** Share of the offensive component carried by the weaker of the two offenses. */
  weakerOffenseWeight: number;
  /** Shootout score at or above which a game projects real scoring. */
  liveGameFloor: number;
  /** Percentile points between the offenses before a game counts as leaning. */
  leanTolerance: number;
  factorWeights: { composite: number; lane_edge: number; volume: number };
}

export interface MatchupMeta {
  lanes: Array<{ key: string; label: string; shortLabel: string }>;
  offenseTendencies: Array<{ key: string; label: string; description: string; unit: string }>;
  defenseTendencies: Array<{ key: string; label: string; description: string; unit: string }>;
  edgeThreshold: number;
  model: MatchupModel;
}

export function fetchMatchupMeta(): Promise<MatchupMeta> {
  return get('/matchup-meta');
}

export interface WeekBlock {
  season: number;
  week: number;
  /** "Week 3", "Super Bowl" — postseason weeks continue the numbering upstream. */
  label: string;
  games: MatchupSummary[];
  scheduled: number;
  played: number;
  /** True when nothing has kicked off, so every figure on screen is a forecast. */
  upcoming: boolean;
  missing: boolean;
}

/**
 * The week now in play, plus the week just finished.
 *
 * This is the whole of the weekly product: one week of predictions, and one
 * week of results to check them against.
 */
export function fetchThisWeek(): Promise<{
  current: WeekBlock | null;
  previous: WeekBlock | null;
  shapeOrder: GameShape[];
}> {
  return get('/this-week');
}
