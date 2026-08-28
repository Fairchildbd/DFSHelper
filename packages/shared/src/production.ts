/**
 * Production metric definitions.
 *
 * Unlike combine drills, which are cohort-level, production is defined per
 * *position* — a linebacker and a running back share the POWER athletic profile
 * but nothing about how their play is measured.
 *
 * Every metric here is a per-game rate. Rate stats (target share, completion
 * percentage, snap share) are already normalized and pass through unchanged;
 * counting stats are divided by games played before scoring.
 */

import type { Position } from './positions.js';

export interface ProductionMetric {
  /** Column key in the production rate map. */
  key: string;
  label: string;
  weight: number;
  /** True for metrics where lower is better (interceptions thrown, etc.). */
  lowerIsBetter?: boolean;
  /** True when the metric is a ratio and must not be divided by games. */
  isRate?: boolean;
}

const QB: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.33 },
  // Opponent-adjusted, and per dropback rather than per attempt.
  //
  // The adjustment is the point: two quarterbacks at identical raw EPA are not
  // the same quarterback if one spent the window against the league's best
  // secondaries, and every efficiency figure in this file was blind to that
  // until the DVOA pass started removing it. See shared/src/dvoa.ts.
  //
  // Per dropback because a sack is the quarterback's play. The feed attributes
  // every sack to `passer_player_id` and to no rusher, so excluding them would
  // let a passer who takes a sack on every pressure grade out even with one who
  // throws the ball away.
  { key: 'adj_passing_epa_per_dropback', label: 'Adj. EPA/Dropback', weight: 0.26, isRate: true },
  // How often a dropback did its job, in the DVOA sense — 45% of the yards to
  // go on first down, 60% on second, the conversion on third and fourth.
  //
  // This is the floor half of the efficiency picture and EPA cannot supply it.
  // EPA is a mean over a fat-tailed distribution, so a quarterback who threw
  // one seventy-yard touchdown and a quarterback who moved the chains all
  // afternoon can post the same figure. Weighted below EPA on purpose: this is
  // a Millionaire Maker tool and the ceiling matters more than the floor, so
  // success rate informs the grade rather than driving it.
  { key: 'adj_passing_success_rate', label: 'Adj. Success Rate', weight: 0.1, isRate: true },
  // Cut from 0.12 when success rate arrived. A passing first down *is* a
  // success on third and fourth down and most of the yardage cases on first and
  // second, so leaving both at full weight would count the same event twice.
  { key: 'passing_first_downs', label: 'Passing 1st Downs/G', weight: 0.08 },
  // Rushing production, deliberately counted twice.
  //
  // A quarterback's rushing already sits inside his PPR points, so this metric
  // double-counts it on purpose. Two reasons. Designed quarterback runs are a
  // scheme decision and among the most stable things a quarterback does year to
  // year, where passing touchdowns are among the least — so rushing deserves
  // more weight than its share of a points total implies. And in DraftKings
  // scoring a rushing yard is worth two and a half passing yards, which makes a
  // running quarterback's floor structurally higher than a pocket passer's at
  // the same points-per-game.
  { key: 'rushing_points', label: 'Rushing Points/G', weight: 0.15 },
  // Rate, not per game. Interceptions scale with how often a quarterback
  // throws, so a per-game figure quietly rewards low-volume passers for
  // attempts they never made — the same volume conflation that made per-game
  // EPA punish starters. Interception *rate* is the standard football measure
  // and is what actually reflects ball security.
  { key: 'interception_rate', label: 'INT Rate', weight: 0.08, lowerIsBetter: true, isRate: true },
];

const RB: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.42 },
  // Opponent-adjusted; see the note on the quarterback equivalent. Carries
  // include quarterback scrambles for the quarterbacks who take them, because
  // the feed types a scramble as a run and attributes it to the rusher.
  { key: 'adj_rushing_epa_per_carry', label: 'Adj. EPA/Carry', weight: 0.17, isRate: true },
  // Weighted a shade higher than the passing equivalent. A running back's
  // value is more nearly a volume-of-successful-carries story than a
  // quarterback's is, and a back who is stuffed on a third of his carries has a
  // floor problem that yards per game hides.
  { key: 'adj_rushing_success_rate', label: 'Adj. Success Rate', weight: 0.11, isRate: true },
  { key: 'rushing_yards', label: 'Rush Yards/G', weight: 0.12 },
  { key: 'receptions', label: 'Receptions/G', weight: 0.18 },
];

const RECEIVER: ProductionMetric[] = [
  { key: 'fantasy_points_ppr', label: 'PPR Points/G', weight: 0.37 },
  { key: 'target_share', label: 'Target Share', weight: 0.19, isRate: true },
  // Opponent-adjusted per target. The adjustment is coarser here than it looks:
  // it is fitted on the whole defense rather than on the corner who actually
  // covered the route, because no free feed says who was in coverage on a given
  // play. `defender_coverage` names the corners a receiver will see and the
  // matchup layer uses it; this is the season-long team-level correction.
  { key: 'adj_receiving_epa_per_tgt', label: 'Adj. EPA/Target', weight: 0.17, isRate: true },
  // Lowest success-rate weight of the three positions, and deliberately so. A
  // receiver's fantasy value is the most explosive-play-driven on the field, so
  // the floor metric says the least about him.
  { key: 'adj_receiving_success_rate', label: 'Adj. Success Rate', weight: 0.1, isRate: true },
  { key: 'receiving_yards', label: 'Rec Yards/G', weight: 0.17 },
];

const LB: ProductionMetric[] = [
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.35 },
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.2 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.2 },
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.15 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.1 },
];

const PASS_RUSHER: ProductionMetric[] = [
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.35 },
  { key: 'def_qb_hits', label: 'QB Hits/G', weight: 0.25 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.25 },
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.15 },
];

const CB: ProductionMetric[] = [
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.35 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.25 },
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.25 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.15 },
];

const SAFETY: ProductionMetric[] = [
  { key: 'def_tackles', label: 'Tackles/G', weight: 0.3 },
  { key: 'def_pass_defended', label: 'Passes Defended/G', weight: 0.25 },
  { key: 'def_interceptions', label: 'Interceptions/G', weight: 0.2 },
  { key: 'def_tackles_for_loss', label: 'TFL/G', weight: 0.15 },
  { key: 'def_sacks', label: 'Sacks/G', weight: 0.1 },
];

/**
 * Offensive linemen have no individual production stats in any public feed.
 * Snap share is the only honest signal available — it measures availability and
 * a coaching staff's trust, not play quality. Flagged as low-signal so the UI
 * can say so rather than implying it grades blocking.
 */
const OL: ProductionMetric[] = [
  { key: 'snap_pct', label: 'Snap Share', weight: 1, isRate: true },
];

export const PRODUCTION_METRICS: Record<Position, ProductionMetric[]> = {
  QB,
  RB, FB: RB,
  WR: RECEIVER, TE: RECEIVER,
  LB,
  DE: PASS_RUSHER, EDGE: PASS_RUSHER, DT: PASS_RUSHER,
  CB,
  S: SAFETY,
  OT: OL, OG: OL, C: OL,
  K: [], P: [], LS: [],
};

/** Positions whose available production data does not really grade play quality. */
export const LOW_SIGNAL_PRODUCTION: Position[] = ['OT', 'OG', 'C'];

/**
 * How much opportunity a player needs before their production is trusted in
 * full, expressed in the unit that actually gates each position.
 *
 * Games played is the wrong unit. A backup quarterback who appears in ten
 * mop-up games has ten games and eighty attempts, and counting that as a full
 * season of evidence lets him outrank a starter who threw five hundred. What
 * varies between a starter and a reserve is not how many Sundays they dressed
 * for, it is how many chances they got.
 *
 * Defenders have no clean opportunity counter in the public feed, so games
 * remain the unit there and the threshold is set accordingly.
 */
export const FULL_SAMPLE_OPPORTUNITIES: Record<Position, number> = {
  QB: 250,                       // pass attempts — roughly half a starter's season
  RB: 120, FB: 120,              // touches (carries + receptions)
  WR: 60, TE: 60,                // targets
  LB: 8, DE: 8, EDGE: 8, DT: 8,  // games
  CB: 8, S: 8,
  OT: 8, OG: 8, C: 8,            // games
  K: 8, P: 8, LS: 8,
};

/** The unit `opportunities` is counted in, for display. */
export const OPPORTUNITY_UNIT: Record<Position, string> = {
  QB: 'attempts',
  RB: 'touches', FB: 'touches',
  WR: 'targets', TE: 'targets',
  LB: 'games', DE: 'games', EDGE: 'games', DT: 'games',
  CB: 'games', S: 'games',
  OT: 'games', OG: 'games', C: 'games',
  K: 'games', P: 'games', LS: 'games',
};

/**
 * Below this share of a full sample, a player is not ranked against qualified
 * players at all. Someone with a dozen attempts has no meaningful ranking, and
 * placing them mid-table implies knowledge that does not exist.
 */
export const QUALIFYING_SAMPLE = 0.25;

/**
 * Positions where holding the job is itself the headline fact.
 *
 * Quarterback is the only one. There are exactly 32 starting jobs, one ball,
 * and no rotation — so a backup ranked above a starter is never useful
 * information, however efficient he looked in mop-up duty. The worst starting
 * quarterback in the league is still a starting quarterback, and a DFS board
 * that buries him under reserves is answering a question nobody asked.
 *
 * No other position works this way. Running backs split carries, receivers
 * rotate by package, and defenders sub by down and distance, so a committee
 * back or a slot receiver is legitimately comparable to a nominal starter and
 * must not be tiered beneath one.
 */
export const STARTER_TIERED_POSITIONS: Position[] = ['QB'];

/** Starts in the window that mark a full-time job rather than a fill-in. */
export const FULL_TIME_STARTS = 8;

/**
 * Sort tiers for starter-gated positions. Lower sorts first, and every position
 * that is not starter-gated sits at 0 so this never reorders them.
 */
export const RANK_TIER = {
  STARTER: 0,
  SPOT_STARTER: 1,
  NON_STARTER: 2,
} as const;

/**
 * College production metrics, keyed with a `cfb_` prefix so they never collide
 * with NFL metrics in the shared baseline table — a 100-yard college game and a
 * 100-yard NFL game are not the same event and must be percentiled against
 * different populations.
 *
 * Deliberately simpler than the NFL set. College data carries no EPA, no target
 * share, and no snap counts, so these are the counting stats that survive the
 * jump between levels. College weights only matter for a player's first three
 * seasons, so precision here buys less than it would on the NFL side.
 *
 * Counting stats are a player's *best* college season rather than a per-game
 * average, for two reasons. The stats feed reports season totals with no games
 * -played field, so a true per-game rate is not derivable without an extra
 * request per week of every season. And peak production is what scouts actually
 * weigh — an average would punish a redshirt or injury year that says nothing
 * about how good the player is. Ratio stats are computed from career totals,
 * where the larger denominator makes them more stable than a single season.
 */
const CFB_QB: ProductionMetric[] = [
  { key: 'cfb_passing_yards', label: 'Pass Yards (best yr)', weight: 0.35 },
  { key: 'cfb_passing_tds', label: 'Pass TD (best yr)', weight: 0.3 },
  { key: 'cfb_completion_pct', label: 'Completion %', weight: 0.2, isRate: true },
  { key: 'cfb_interceptions', label: 'INT per Attempt', weight: 0.15, lowerIsBetter: true, isRate: true },
];

const CFB_RB: ProductionMetric[] = [
  { key: 'cfb_rushing_yards', label: 'Rush Yards (best yr)', weight: 0.4 },
  { key: 'cfb_rushing_tds', label: 'Rush TD (best yr)', weight: 0.25 },
  { key: 'cfb_yards_per_carry', label: 'Yards per Carry', weight: 0.2, isRate: true },
  { key: 'cfb_receptions', label: 'Receptions (best yr)', weight: 0.15 },
];

const CFB_RECEIVER: ProductionMetric[] = [
  { key: 'cfb_receiving_yards', label: 'Rec Yards (best yr)', weight: 0.4 },
  { key: 'cfb_receiving_tds', label: 'Rec TD (best yr)', weight: 0.25 },
  { key: 'cfb_receptions', label: 'Receptions (best yr)', weight: 0.2 },
  { key: 'cfb_yards_per_reception', label: 'Yards per Catch', weight: 0.15, isRate: true },
];

const CFB_LB: ProductionMetric[] = [
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.4 },
  { key: 'cfb_tackles_for_loss', label: 'TFL (best yr)', weight: 0.25 },
  { key: 'cfb_sacks', label: 'Sacks (best yr)', weight: 0.2 },
  { key: 'cfb_pass_defended', label: 'Passes Defended (best yr)', weight: 0.15 },
];

const CFB_PASS_RUSHER: ProductionMetric[] = [
  { key: 'cfb_sacks', label: 'Sacks (best yr)', weight: 0.4 },
  { key: 'cfb_tackles_for_loss', label: 'TFL (best yr)', weight: 0.35 },
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.25 },
];

const CFB_DB: ProductionMetric[] = [
  { key: 'cfb_pass_defended', label: 'Passes Defended (best yr)', weight: 0.35 },
  { key: 'cfb_interceptions_def', label: 'Interceptions (best yr)', weight: 0.3 },
  { key: 'cfb_tackles', label: 'Tackles (best yr)', weight: 0.35 },
];

/**
 * Offensive linemen have no individual college stats either. Their college
 * component stays empty, which means it drops out of the blend and the
 * remaining components renormalize — the honest result for a position nobody
 * publishes numbers on.
 */
const CFB_NONE: ProductionMetric[] = [];

export const COLLEGE_PRODUCTION_METRICS: Record<Position, ProductionMetric[]> = {
  QB: CFB_QB,
  RB: CFB_RB, FB: CFB_RB,
  WR: CFB_RECEIVER, TE: CFB_RECEIVER,
  LB: CFB_LB,
  DE: CFB_PASS_RUSHER, EDGE: CFB_PASS_RUSHER, DT: CFB_PASS_RUSHER,
  CB: CFB_DB, S: CFB_DB,
  OT: CFB_NONE, OG: CFB_NONE, C: CFB_NONE,
  K: CFB_NONE, P: CFB_NONE, LS: CFB_NONE,
};

/** Metric keys that are ratios and must not be divided by games played. */
export const RATE_METRICS = new Set<string>(
  Object.values(PRODUCTION_METRICS)
    .flat()
    .filter((m) => m.isRate)
    .map((m) => m.key),
);
