
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
  opportunities: number | null;
  qualified: boolean | null;
  starts: number | null;
  rank_tier: number | null;
  position_rank: number;
  overall_rank: number;
}

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

export type ContestType = 'classic' | 'showdown';

export interface SlateSummary {
  contest: ContestType;
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
  cost: number;
  multiplier: number;
  matchupScore: number | null;
  value: number;
  weight: number;
  laneEdge: number | null;
  status: string | null;
  note: string;
}

export interface Lineup {
  picks: LineupPick[];
  salary: number;
  value: number;
  averageGrade: number;
  remaining: number;
}

export interface ShowdownBuild {
  key: string;
  label: string;
  description: string;
  team: string | null;
  lineup: Lineup | null;
  problem: string | null;
}

export interface GameScriptRead {
  scenario: string;
  team: string | null;
  confidence: 'strong' | 'slight';
  why: string;
  lanes: [number, number];
}

export interface LineupResponse {
  season: number;
  week: number;
  contest: ContestType;
  strategy: StrategyKey;
  stack: {
    gameId: string;
    label: string;
    mismatchScore: number | null;
    players: number;
  } | null;
  baselineSeason: number;
  poolSize: number;
  ungraded: number;
  unavailable: number;
  lineup: Lineup | null;
  read: GameScriptRead | null;
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
  shootout_score?: string | null;
  shootout_applied?: boolean | null;
  lean_team?: string | null;
  lean_margin?: string | null;
  game_shape?: GameShape | null;
  home_score?: number | null;
  away_score?: number | null;
  top10_hits?: number | null;
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
  rank: number | null;
  rankOf: number | null;
}

export interface StaffProfile {
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

export interface MatchupStarter {
  team: string;
  unit: 'offense' | 'defense' | 'special';
  slot: number | null;
  role: string;
  role_name: string | null;
  gsis_id: string;
  display_name: string;
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
  built: number;
  kickoff: string | null;
}

export function fetchWeeks(): Promise<{
  weeks: WeekInfo[];
  current: { season: number; week: number } | null;
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

export interface MatchupModel {
  edgeThreshold: number;
  topEdges: number;
  maxUsageAdjustment: number;
  defenseEdgeWeight: number;
  shootoutWeights: { total: number; offense: number; defense: number; pace: number };
  shootoutTotalFloor: number;
  shootoutTotalCeiling: number;
  weakerOffenseWeight: number;
  liveGameFloor: number;
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
  label: string;
  games: MatchupSummary[];
  scheduled: number;
  played: number;
  upcoming: boolean;
  missing: boolean;
}

export function fetchThisWeek(): Promise<{
  current: WeekBlock | null;
  previous: WeekBlock | null;
  shapeOrder: GameShape[];
}> {
  return get('/this-week');
}
