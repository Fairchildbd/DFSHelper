/**
 * Matchup model: coaching tendencies, unit-vs-unit lanes, and the arithmetic
 * that turns them into a weekly mismatch ranking.
 *
 * Everything here is pure. The server materializes the results into `matchups`
 * and `player_matchups`, but the functions themselves take plain numbers so the
 * math is unit-testable and could run on-device alongside the scoring engine.
 *
 * The organizing idea: a player's ranking says how good he is, a coach's
 * tendencies say how he will be *used*, and the opponent's defensive profile
 * says how much that usage is worth this week. A mismatch is where those three
 * disagree with each other in the offense's favour.
 */

import type { Position } from './positions.js';
import { clamp, mean, normalCdf, stdDev } from './stats.js';

/** Which side of the ball a tendency describes. */
export type Side = 'offense' | 'defense';

/**
 * Where a tendency profile came from.
 *
 * Coaches move between franchises — the 2026 season alone opened with five
 * staffs new to their team — so a team-keyed profile can describe a coach who
 * is no longer there. Profiles are therefore coach-keyed first, and this field
 * records honestly when we had to fall back.
 */
export type TendencySource = 'coach' | 'team' | 'league';

export interface TendencyMetric {
  key: string;
  label: string;
  /** Short gloss shown under the value in the coaching fingerprint. */
  description: string;
  /** Formatting hint for the app. */
  unit: 'pct' | 'rate' | 'seconds' | 'epa';
  /**
   * True when a *higher* raw value means a better unit. Used only for the
   * defensive metrics that feed lane suppression; tendency metrics that are
   * stylistic rather than good-or-bad (pace, shotgun rate) leave this null.
   */
  higherIsBetter?: boolean | null;
}

/**
 * Offensive tendencies.
 *
 * `proe` leads deliberately: pass rate over expected is the single most durable
 * fingerprint a play-caller has, because it already controls for down, distance
 * and score. Raw pass rate mostly measures whether a team was ahead.
 */
export const OFFENSE_TENDENCIES: TendencyMetric[] = [
  { key: 'proe', label: 'Pass Rate Over Expected', description: 'Pass tendency once down, distance and score are controlled for', unit: 'pct' },
  { key: 'pass_rate_early', label: 'Early-Down Pass Rate', description: 'Pass share on 1st and 2nd down in neutral game state', unit: 'pct' },
  { key: 'sec_per_play', label: 'Seconds Per Play', description: 'Pace of play — lower means more snaps, more fantasy points', unit: 'seconds' },
  { key: 'shotgun_rate', label: 'Shotgun Rate', description: 'Share of snaps taken out of shotgun', unit: 'pct' },
  { key: 'no_huddle_rate', label: 'No-Huddle Rate', description: 'Share of snaps run without huddling', unit: 'pct' },
  { key: 'deep_rate', label: 'Deep Pass Rate', description: 'Share of throws travelling 15+ air yards', unit: 'pct' },
  { key: 'rz_pass_rate', label: 'Red-Zone Pass Rate', description: 'Pass share inside the opponent 20 — where touchdowns come from', unit: 'pct' },
  { key: 'run_outside_rate', label: 'Outside Run Rate', description: 'Share of carries off tackle rather than between the guards', unit: 'pct' },
  { key: 'play_action_rate', label: 'Play-Action Rate', description: 'Share of dropbacks using play action', unit: 'pct' },
  { key: 'motion_rate', label: 'Pre-Snap Motion Rate', description: 'Share of snaps with a man in motion', unit: 'pct' },
  { key: 'screen_rate', label: 'Screen Rate', description: 'Share of dropbacks thrown as screens', unit: 'pct' },
  { key: 'rpo_rate', label: 'RPO Rate', description: 'Share of snaps that are run-pass options', unit: 'pct' },
  { key: 'wr_target_share', label: 'WR Target Share', description: 'Share of this offense’s targets going to receivers', unit: 'pct' },
  { key: 'te_target_share', label: 'TE Target Share', description: 'Share of targets going to tight ends', unit: 'pct' },
  { key: 'rb_target_share', label: 'RB Target Share', description: 'Share of targets going to running backs', unit: 'pct' },
];

/** Defensive tendencies. */
export const DEFENSE_TENDENCIES: TendencyMetric[] = [
  { key: 'blitz_rate', label: 'Blitz Rate', description: 'Share of dropbacks facing five or more rushers', unit: 'pct' },
  { key: 'pressure_rate', label: 'Pressure Rate', description: 'Share of dropbacks pressured, blitzing or not', unit: 'pct', higherIsBetter: true },
  { key: 'light_box_rate', label: 'Light Box Rate', description: 'Share of snaps with six or fewer in the box', unit: 'pct' },
  { key: 'heavy_box_rate', label: 'Heavy Box Rate', description: 'Share of snaps with eight or more in the box', unit: 'pct' },
  { key: 'epa_allowed_pass', label: 'EPA Allowed / Dropback', description: 'Expected points surrendered per pass play', unit: 'epa', higherIsBetter: false },
  { key: 'epa_allowed_rush', label: 'EPA Allowed / Rush', description: 'Expected points surrendered per run play', unit: 'epa', higherIsBetter: false },
  { key: 'explosive_allowed_rate', label: 'Explosive Play Rate Allowed', description: 'Share of plays surrendering 20+ yards', unit: 'pct', higherIsBetter: false },
  { key: 'pass_rate_faced', label: 'Pass Rate Faced', description: 'How pass-heavy opponents choose to be against this defense', unit: 'pct' },
];

export const TENDENCIES_BY_SIDE: Record<Side, TendencyMetric[]> = {
  offense: OFFENSE_TENDENCIES,
  defense: DEFENSE_TENDENCIES,
};

export function tendencyMetric(side: Side, key: string): TendencyMetric | undefined {
  return TENDENCIES_BY_SIDE[side].find((m) => m.key === key);
}

/**
 * Defense-versus-position metrics.
 *
 * All are "allowed" figures, so lower is better for the defense. The lane
 * scoring inverts them, which is why `lowerIsBetter` is stated explicitly here
 * rather than assumed at the call site.
 */
export interface DvpMetric {
  key: string;
  label: string;
  lowerIsBetter: boolean;
}

export const DVP_METRICS: DvpMetric[] = [
  { key: 'fp_allowed', label: 'PPR Points Allowed/G', lowerIsBetter: true },
  { key: 'yards_allowed', label: 'Yards Allowed/G', lowerIsBetter: true },
  { key: 'tds_allowed', label: 'TDs Allowed/G', lowerIsBetter: true },
  { key: 'targets_allowed', label: 'Targets Allowed/G', lowerIsBetter: true },
];

/** Positions that get a defense-versus-position profile. */
export const DVP_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export type LaneKey = 'qb_pass' | 'wr' | 'te' | 'rb_rush' | 'rb_recv' | 'ol_pass_pro';

export interface Lane {
  key: LaneKey;
  label: string;
  /** Short form for the list-row headline. */
  shortLabel: string;
  /** Offensive positions that make up the unit. */
  offensePositions: Position[];
  /**
   * How many depth-chart slots count. A fourth receiver matters; a fourth tight
   * end does not, and averaging him in would flatten every team toward the mean.
   */
  maxRank: number;
  /** Position whose defense-versus-position profile grades this lane. */
  dvpPosition: Position | null;
  /** Coach offensive tendency that raises or lowers this lane's usage. */
  usageMetric: string | null;
  /**
   * Coach defensive tendencies that contribute to suppressing this lane.
   *
   * Scheme only, since `dvoaMetric` arrived. These used to carry the raw
   * `epa_allowed_*` figures too, which put a *result* in the bucket meant for
   * dispositions and left it schedule-biased besides. Results now have their
   * own component; what is left here is genuinely how a defense chooses to
   * play — how often it pressures, blitzes, loads the box.
   */
  defenseMetrics: string[];
  /**
   * Opponent-adjusted efficiency allowed on the play type this lane runs, from
   * `team_dvoa`.
   *
   * The honest version of what `epa_allowed_*` was doing in `defenseMetrics`.
   * A defense's raw EPA allowed is partly a fact about the offenses it drew;
   * this is the same measure with that taken out. See shared/src/dvoa.ts.
   */
  dvoaMetric: string | null;
  /** Opposing positions shown as context alongside players in this lane. */
  defensePositions: Position[];
}

/**
 * The six lanes a game is decomposed into, each evaluated in both directions.
 *
 * These are deliberately fantasy-shaped rather than football-shaped: there is
 * no "linebacker corps" lane, because no DFS decision hangs on it. `ol_pass_pro`
 * earns its place only because pressure allowed is what turns a good passing
 * matchup into a bad one.
 */
export const LANES: Lane[] = [
  {
    key: 'qb_pass',
    label: 'Passing game',
    shortLabel: 'pass game',
    offensePositions: ['QB'],
    maxRank: 1,
    dvpPosition: 'QB',
    usageMetric: 'proe',
    defenseMetrics: ['pressure_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['CB', 'S'],
  },
  {
    key: 'wr',
    label: 'Receivers vs coverage',
    shortLabel: 'WRs',
    offensePositions: ['WR'],
    maxRank: 4,
    dvpPosition: 'WR',
    usageMetric: 'wr_target_share',
    defenseMetrics: ['explosive_allowed_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['CB', 'S'],
  },
  {
    key: 'te',
    label: 'Tight ends vs linebackers and safeties',
    shortLabel: 'TEs',
    offensePositions: ['TE'],
    maxRank: 2,
    dvpPosition: 'TE',
    usageMetric: 'te_target_share',
    defenseMetrics: ['explosive_allowed_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['LB', 'S'],
  },
  {
    key: 'rb_rush',
    label: 'Run game vs front seven',
    shortLabel: 'run game',
    offensePositions: ['RB', 'FB'],
    maxRank: 2,
    dvpPosition: 'RB',
    usageMetric: null,
    defenseMetrics: ['heavy_box_rate'],
    dvoaMetric: 'epa_allowed_rush_adj',
    defensePositions: ['DT', 'DE', 'EDGE', 'LB'],
  },
  {
    key: 'rb_recv',
    label: 'Backs in the passing game',
    shortLabel: 'pass-catching backs',
    offensePositions: ['RB'],
    maxRank: 2,
    dvpPosition: 'RB',
    usageMetric: 'rb_target_share',
    defenseMetrics: ['blitz_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['LB'],
  },
  {
    key: 'ol_pass_pro',
    label: 'Pass protection vs rush',
    shortLabel: 'pass protection',
    offensePositions: ['OT', 'OG', 'C'],
    maxRank: 5,
    // No defense-versus-position profile exists for the line; suppression here
    // is entirely the opposing front's pressure profile.
    dvpPosition: null,
    usageMetric: null,
    defenseMetrics: ['pressure_rate', 'blitz_rate'],
    dvoaMetric: 'epa_allowed_pass_adj',
    defensePositions: ['EDGE', 'DE', 'DT'],
  },
];

export const LANES_BY_KEY: Record<LaneKey, Lane> = Object.fromEntries(
  LANES.map((l) => [l.key, l]),
) as Record<LaneKey, Lane>;

/** The lane a given position is graded in, for the player view. */
export function laneForPosition(position: Position): LaneKey | null {
  switch (position) {
    case 'QB': return 'qb_pass';
    case 'WR': return 'wr';
    case 'TE': return 'te';
    case 'RB': case 'FB': return 'rb_rush';
    case 'OT': case 'OG': case 'C': return 'ol_pass_pro';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Lane arithmetic
// ---------------------------------------------------------------------------

/**
 * How much a depth-chart slot counts toward its unit's strength.
 *
 * Decays geometrically rather than linearly, because snap and target
 * distribution does: a WR1 is worth far more than twice a WR3.
 *
 * The decay continues past `maxRank` rather than flattening there. Clamping the
 * rank instead — which an earlier version did — gave every quarterback on the
 * roster the weight of the starter, because the quarterback lane counts one
 * slot, and duly ranked a fourth-string passer among the best plays on the
 * slate. `maxRank` decides who is counted, not how steeply weight falls off.
 *
 * An unknown rank is treated as the last counted slot rather than dropped, so
 * an unlisted player contributes a little instead of silently vanishing.
 */
export function roleWeight(posRank: number | null | undefined, maxRank: number): number {
  const rank = posRank == null || posRank < 1 ? maxRank : posRank;
  return 0.5 ** (rank - 1);
}

export interface LaneEdgeInput {
  lane: Lane;
  /** Role-weighted mean composite of the offensive unit, 0-100. Null if unknown. */
  offenseStrength: number | null;
  /** How well the defense suppresses this lane, 0-100. Null if unknown. */
  defenseStrength: number | null;
  /**
   * Percentile of the offensive coach's usage tendency for this lane, 0-100.
   * A coach who force-feeds tight ends makes a tight-end mismatch matter more.
   */
  usagePercentile?: number | null;
}

export interface LaneEdge {
  lane: LaneKey;
  label: string;
  /**
   * The two sides of this lane.
   *
   * The label reads `SEA WRs vs NE` and carries the same information, but a
   * caller grouping edges by offense should not have to parse a sentence to do
   * it. Optional because rows computed before this field existed do not have
   * it, and a stale row is a thing to read, not a thing to crash on.
   */
  offense?: string;
  defense?: string;
  offenseStrength: number | null;
  defenseStrength: number | null;
  /** Positive means the offense holds the advantage. Null when ungradeable. */
  edge: number | null;
  /** How much the coach's usage tendency shifted the raw edge. */
  usageAdjustment: number;
}

/**
 * How far a usage tendency can move a lane edge, in percentile points.
 *
 * Capped low on purpose. Scheme decides how often a mismatch is targeted, not
 * whether it exists, so it modulates the edge rather than creating one.
 */
export const MAX_USAGE_ADJUSTMENT = 10;

export function computeLaneEdge(input: LaneEdgeInput): LaneEdge {
  const { lane, offenseStrength, defenseStrength } = input;

  if (offenseStrength == null || defenseStrength == null) {
    return {
      lane: lane.key,
      label: lane.label,
      offenseStrength,
      defenseStrength,
      edge: null,
      usageAdjustment: 0,
    };
  }

  const usage = input.usagePercentile;
  const usageAdjustment =
    usage == null ? 0 : ((usage - 50) / 50) * MAX_USAGE_ADJUSTMENT;

  const raw = offenseStrength - defenseStrength + usageAdjustment;

  return {
    lane: lane.key,
    label: lane.label,
    offenseStrength,
    defenseStrength,
    edge: clamp(raw, -100, 100),
    usageAdjustment,
  };
}

/**
 * Most a quarterback's rushing may move his lane edge, in percentile points.
 *
 * The quarterback lane grades pass defense, which is the right frame for most
 * of the position and blind for the part of it that matters most in DraftKings:
 * a quarterback who runs is exploiting the front seven, not the coverage, and
 * nothing in `epa_allowed_pass` or `pressure_rate` knows that. This reconnects
 * the two, bounded so it stays a modifier on the passing matchup rather than a
 * second matchup pretending to be one.
 */
export const MAX_QB_RUSH_ADJUSTMENT = 12;

/** Carries per game at which a quarterback is a pure pocket passer. */
export const QB_POCKET_CARRIES = 2;

/** Carries per game at which he is a full designed-run threat. */
export const QB_RUNNER_CARRIES = 8;

/**
 * How much a quarterback's legs are worth against this particular defense.
 *
 * Two terms multiplied, because both have to be true. A quarterback who does
 * not run gets nothing regardless of how porous the front is, and the best
 * running quarterback alive gets nothing against a defense that stops the run —
 * which is exactly the asymmetry a single lane edge cannot express.
 *
 * `runSuppression` is the opposing defense's percentile against the run, on the
 * same scale as every other suppression figure: 100 is a defense that erases
 * running games, 0 is one that cannot tackle.
 */
export function qbRushAdjustment(
  carriesPerGame: number | null | undefined,
  runSuppression: number | null | undefined,
): number {
  if (carriesPerGame == null || runSuppression == null) return 0;

  const lean = clamp(
    (carriesPerGame - QB_POCKET_CARRIES) / (QB_RUNNER_CARRIES - QB_POCKET_CARRIES),
    0,
    1,
  );
  const opportunity = clamp((50 - runSuppression) / 50, -1, 1);

  return lean * opportunity * MAX_QB_RUSH_ADJUSTMENT;
}

/**
 * An edge at or beyond this magnitude is what the UI calls a mismatch.
 *
 * Set at the 75th percentile of observed lane edges across a full season, so
 * "mismatch" means genuinely lopsided rather than merely uneven. At this value
 * a game averages about three of them and roughly one game in 27 has none —
 * which is the point: a slate where every game has mismatches is a slate where
 * the word has stopped carrying information.
 */
export const EDGE_THRESHOLD = 45;

/** How many of the biggest edges feed the game's score. */
export const TOP_EDGES = 4;

/**
 * How much a defense-favourable edge counts toward the mismatch score.
 *
 * Both directions are real information, but they are not equally actionable.
 * A +90 lane is an offense to attack; a -90 lane is one to fade, and fading
 * scores no fantasy points. Weighting them identically — which taking the
 * absolute value did — put games at the top of the slate whose defining
 * feature was that almost nobody in them should be rostered.
 *
 * Not zero, because a one-sided beating still concentrates whatever scoring
 * the game produces on the side doing the beating, and that side is worth
 * surfacing. Set below half so a lane has to be roughly twice as lopsided in
 * the defense's favour to outrank an offensive one.
 */
export const DEFENSE_EDGE_WEIGHT = 0.45;

/**
 * A lane's contribution to the mismatch score, in percentile points.
 *
 * The one place the sign convention is applied. Lane selection, the score and
 * the list-row headline all read through this, so they cannot disagree about
 * which lane in a game matters most.
 */
export function edgeWeight(edge: number): number {
  return edge >= 0 ? edge : -edge * DEFENSE_EDGE_WEIGHT;
}

export interface EdgeAggregate {
  edgeScore: number;
  edgeCount: number;
  /**
   * The lane that most defines the game, for the list-row headline. Ranked by
   * `edgeWeight`, not raw magnitude, so the headline names the same lane the
   * score was mostly built from. Null if none graded.
   */
  top: LaneEdge | null;
  graded: number;
}

/**
 * Collapse a game's lane edges into one 0-100 score.
 *
 * Root-mean-square of the four largest weights, not the mean of all twelve:
 * one severe mismatch is a better DFS spot than four mild ones, and averaging
 * across every lane would let six neutral matchups bury a single exploitable
 * one.
 *
 * "Weight" rather than "magnitude" is the whole distinction — see
 * `DEFENSE_EDGE_WEIGHT`. Selecting the top four on raw magnitude and then
 * squaring them made the score direction-blind, so a game defined by two
 * defenses erasing two offenses scored the same as one defined by two offenses
 * running free. Both are lopsided; only one is a slate to attack.
 *
 * The RMS is used unscaled. Both sides of an edge are percentiles within their
 * own league population, so their difference already lives on a 0-100 scale.
 * An earlier version doubled it to "use the full range" and merely flattened
 * the top of the table into a row of hundreds — which is exactly where a list
 * sorted by mismatch most needs to discriminate.
 */
export function aggregateEdges(edges: LaneEdge[]): EdgeAggregate {
  const graded = edges.filter((e) => e.edge != null);
  if (graded.length === 0) {
    return { edgeScore: 0, edgeCount: 0, top: null, graded: 0 };
  }

  const byWeight = [...graded].sort(
    (a, b) => edgeWeight(b.edge!) - edgeWeight(a.edge!),
  );
  const top = byWeight.slice(0, TOP_EDGES);
  const meanSquare =
    top.reduce((acc, e) => acc + edgeWeight(e.edge!) ** 2, 0) / top.length;

  return {
    edgeScore: clamp(Math.sqrt(meanSquare), 0, 100),
    edgeCount: graded.filter((e) => edgeWeight(e.edge!) >= EDGE_THRESHOLD).length,
    top: byWeight[0] ?? null,
    graded: graded.length,
  };
}

// ---------------------------------------------------------------------------
// The league total distribution
// ---------------------------------------------------------------------------

/**
 * League-typical game total, and the points either side of it that cover
 * essentially the whole market. Totals cluster tightly, so the pivot is stable.
 *
 * These describe the distribution itself, which is why they outlived the capped
 * multiplier they were introduced for. The showdown game-script read uses them
 * to tilt a game with no clear side toward or away from scoring, where a signed
 * distance from the middle is the natural shape. `computeShootout` wants an
 * unsigned 0-100 ramp instead and has its own floor and ceiling.
 */
export const NEUTRAL_TOTAL = 44.5;
export const TOTAL_RANGE = 10.5;

// ---------------------------------------------------------------------------
// Scoring projection
// ---------------------------------------------------------------------------
//
// Deliberately not called "environment". In football that word already means
// roof, surface, weather, rest and travel — all of which this project stores on
// `games` and none of which this reads. What follows is one question only: how
// much fantasy scoring does the game itself project.

/**
 * The shootout score answers a different question from the mismatch score, and
 * the two disagree often enough that collapsing them was the mistake.
 *
 * Mismatch asks "where is the largest talent gap". Shootout asks "where will
 * the fantasy points be". A great defense strangling a bad offense is a huge
 * mismatch and a dead game; two mediocre offenses behind two broken lines with
 * a 48.5 total is a small mismatch and a live one. Neither score is wrong —
 * they were never measuring the same thing, and only one of them was ever
 * shown.
 */

/** Totals at or below this are the deadest games on a typical slate. */
export const SHOOTOUT_TOTAL_FLOOR = 38;

/** Totals at or above this are the top of the market. */
export const SHOOTOUT_TOTAL_CEILING = 52;

/**
 * How much of the offensive component the weaker of the two offenses carries.
 *
 * Above half on purpose. A shootout needs both teams to score. One great
 * offense against one broken one is a blowout — it yields a single usable side
 * rather than a game worth stacking — and averaging the two would score it
 * identically to a game where both can move the ball.
 */
export const WEAKER_OFFENSE_WEIGHT = 0.6;

/** Percentile points between the two offenses before a game counts as leaning. */
export const LEAN_TOLERANCE = 10;

/**
 * What each part of the scoring environment is worth.
 *
 * The total leads because it is a market price on the whole game, and the
 * market has already seen everything the other three components are made of.
 * They earn their place anyway because the market prices *points*, not fantasy
 * points: it is indifferent to whether the scoring is concentrated in one
 * offense, and a game that reaches 48 on one team's back is a different DFS
 * problem than one that splits it.
 */
export const SHOOTOUT_WEIGHTS = {
  total: 0.4,
  offense: 0.25,
  defense: 0.2,
  pace: 0.15,
} as const;

export interface ShootoutInput {
  edges: LaneEdge[];
  totalLine: number | null;
  pacePercentile?: number | null;
}

/**
 * What kind of game this is, for a list that groups rather than ranks.
 *
 * A single ordered list forces two different questions into one axis and makes
 * the reader infer which one produced it. Four named shapes say it outright,
 * and the distinction they draw is the one that changes how a lineup uses a
 * game: stack it, attack one side of it, or leave it alone — and if leaving it
 * alone, whether that is because the defenses are good or because nobody
 * involved can move the ball.
 */
export type GameShape = 'shootout' | 'one_sided' | 'low_scoring' | 'defensive';

/**
 * Shootout score at or above which a game projects real fantasy scoring.
 *
 * Below it the game is not worth attacking from either side, so the lean stops
 * mattering and the question becomes why it is quiet.
 */
export const LIVE_GAME_FLOOR = 50;

/**
 * Defensive component at or below which the defenses are the story.
 *
 * The component counts upward toward exploitable defenses, so a low value means
 * two units that actually stop people. It is what separates a quiet game with a
 * reason from one where both offenses are simply bad — a distinction the score
 * alone cannot draw, because those two land in the same place.
 */
export const STRONG_DEFENSE_CEILING = 40;

export interface Shootout {
  /** 0-100. How much fantasy scoring the game itself projects. */
  score: number;
  /** Which of the four shapes this game is, for grouping the weekly list. */
  shape: GameShape;
  /**
   * False when no total was published. The score is then the model's own view
   * with the market's missing, which is worth saying out loud rather than
   * presenting at the same confidence as a priced game.
   */
  applied: boolean;
  /** Each component on a common 0-100 scale. Null where unmeasurable. */
  components: {
    total: number | null;
    offense: number | null;
    defense: number | null;
    pace: number | null;
  };
  /**
   * The team whose offense carries the game, or null when the two are within
   * `LEAN_TOLERANCE` of each other. A high score with a lean is a game to
   * attack from one side; a high score without one is a game to stack.
   */
  leanTeam: string | null;
  /** Percentile points separating the stronger offense from the weaker. */
  lean: number;
}

interface TeamOffense {
  team: string;
  strength: number;
}

/**
 * Mean offensive percentile per team, taken from the edges themselves.
 *
 * Reading it back off the edges keeps this function pure and keeps the two
 * scores fed from one source. `offense` is optional on `LaneEdge` because rows
 * written before that field existed do not carry it; those collapse into a
 * single unnamed bucket, which costs the lean and leaves the score intact.
 */
function offenseByTeam(edges: LaneEdge[]): TeamOffense[] {
  const book = new Map<string, number[]>();
  for (const edge of edges) {
    if (edge.offenseStrength == null) continue;
    const key = edge.offense ?? '';
    const bucket = book.get(key);
    if (bucket) bucket.push(edge.offenseStrength);
    else book.set(key, [edge.offenseStrength]);
  }
  return [...book].map(([team, values]) => ({ team, strength: mean(values) }));
}

/** How much fantasy scoring a game projects, independent of who is favoured. */
export function computeShootout(input: ShootoutInput): Shootout {
  const offenses = offenseByTeam(input.edges).sort((a, b) => b.strength - a.strength);
  const strongest = offenses[0] ?? null;
  const weakest = offenses.length > 1 ? offenses[offenses.length - 1]! : strongest;

  const offense =
    strongest == null || weakest == null
      ? null
      : WEAKER_OFFENSE_WEIGHT * weakest.strength +
        (1 - WEAKER_OFFENSE_WEIGHT) * strongest.strength;

  // Inverted: this component asks how exploitable the defenses are, and
  // defenseStrength counts upward toward a defense that erases its lane.
  const suppression = input.edges
    .map((e) => e.defenseStrength)
    .filter((v): v is number => v != null);
  const defense = suppression.length === 0 ? null : 100 - mean(suppression);

  const total =
    input.totalLine == null || !Number.isFinite(input.totalLine)
      ? null
      : clamp(
          ((input.totalLine - SHOOTOUT_TOTAL_FLOOR) /
            (SHOOTOUT_TOTAL_CEILING - SHOOTOUT_TOTAL_FLOOR)) *
            100,
          0,
          100,
        );

  const pace = input.pacePercentile ?? null;

  // Renormalised over whatever was measurable, matching how a lane edge blends
  // its own components: a missing total shifts weight onto the rest rather than
  // scoring the game as neutral, which would be a claim we cannot make.
  const parts: Array<[number | null, number]> = [
    [total, SHOOTOUT_WEIGHTS.total],
    [offense, SHOOTOUT_WEIGHTS.offense],
    [defense, SHOOTOUT_WEIGHTS.defense],
    [pace, SHOOTOUT_WEIGHTS.pace],
  ];
  let weighted = 0;
  let weight = 0;
  for (const [value, share] of parts) {
    if (value == null) continue;
    weighted += value * share;
    weight += share;
  }

  const lean = strongest && weakest ? strongest.strength - weakest.strength : 0;

  const score = weight > 0 ? clamp(weighted / weight, 0, 100) : 0;
  const leanTeam =
    strongest && strongest.team && lean >= LEAN_TOLERANCE ? strongest.team : null;

  return {
    score,
    shape: classifyGame(score, leanTeam, defense),
    applied: total != null,
    components: { total, offense, defense, pace },
    leanTeam,
    lean,
  };
}

/**
 * Sort a game into one of the four shapes.
 *
 * Order matters. A game that projects scoring is a game to play, and whether it
 * splits or leans decides how — so that question is asked first and the state of
 * the defenses never enters. Only once a game is quiet does it become worth
 * saying why, and the honest default when the defenses could not be graded is
 * the weaker claim: quiet, reason unstated.
 */
export function classifyGame(
  score: number,
  leanTeam: string | null,
  defenseComponent: number | null,
): GameShape {
  if (score >= LIVE_GAME_FLOOR) return leanTeam == null ? 'shootout' : 'one_sided';
  if (defenseComponent != null && defenseComponent <= STRONG_DEFENSE_CEILING) {
    return 'defensive';
  }
  return 'low_scoring';
}

export interface MismatchInput {
  edges: LaneEdge[];
  totalLine: number | null;
  pacePercentile?: number | null;
}

export interface Mismatch extends EdgeAggregate {
  /**
   * Identical to `edgeScore`, and kept as its own field because the two names
   * mean different things to a caller: one is the arithmetic, the other is the
   * published figure. They were not always equal — the score used to be scaled
   * by a capped game-environment multiplier, which made it a hybrid of talent
   * gap and scoring projection and therefore a clean answer to neither. That
   * job now belongs to `shootout`, which does it without a cap.
   */
  mismatchScore: number;
  /**
   * The same game read for scoring projection instead of talent gap. Carried
   * alongside rather than folded in, because a slate ordered by one is a
   * genuinely different list from the same slate ordered by the other.
   */
  shootout: Shootout;
}

/** Both readings of one game: how large the gaps are, and how much it scores. */
export function computeMismatch(input: MismatchInput): Mismatch {
  const aggregate = aggregateEdges(input.edges);

  return {
    ...aggregate,
    mismatchScore: aggregate.edgeScore,
    shootout: computeShootout(input),
  };
}

// ---------------------------------------------------------------------------
// Player-level grade
// ---------------------------------------------------------------------------

export interface MatchupFactor {
  key: 'composite' | 'lane_edge' | 'volume';
  label: string;
  /** 0-100 after conversion onto a common scale. Null when unavailable. */
  value: number | null;
  /** Share of the grade this factor was worth, after renormalization. */
  weight: number;
  /** Plain-language reason, shown under the player row. */
  note: string;
}

export interface PlayerMatchupInput {
  /** The player's own ranking composite, 0-100. */
  composite: number | null;
  /** Their lane's edge for this game, -100 to 100. */
  laneEdge: number | null;
  /** Projected usage, 0-100: pace and pass rate crossed with their own role. */
  volume: number | null;
}

export interface PlayerMatchupScore {
  score: number;
  /** Share of the intended weight that was actually measurable, 0-1. */
  confidence: number;
  factors: MatchupFactor[];
}

/**
 * Intended factor weights.
 *
 * The lane edge leads, because this grade answers "how good is this spot",
 * not "how good is this player" — the rankings already answer the latter, and
 * a great player in a terrible spot is precisely what a DFS tool must be able
 * to say out loud.
 */
export const FACTOR_WEIGHTS = { composite: 0.3, lane_edge: 0.4, volume: 0.3 } as const;

/** Put a lane edge on the same 0-100 footing as the other factors. */
export function edgeToScale(edge: number): number {
  return clamp(50 + edge / 2, 0, 100);
}

/**
 * Grade one player's matchup.
 *
 * Missing factors reduce the weight rather than scoring zero, matching how the
 * ranking engine treats an unmeasured drill: absence is uncertainty, not a
 * finding. `confidence` reports how much of the intended weight survived.
 */
export function gradePlayerMatchup(input: PlayerMatchupInput): PlayerMatchupScore {
  const factors: MatchupFactor[] = [
    {
      key: 'composite',
      label: 'Player quality',
      value: input.composite,
      weight: FACTOR_WEIGHTS.composite,
      note: 'Season-long ranking composite',
    },
    {
      key: 'lane_edge',
      label: 'Matchup edge',
      value: input.laneEdge == null ? null : edgeToScale(input.laneEdge),
      weight: FACTOR_WEIGHTS.lane_edge,
      note: 'His unit against this opponent',
    },
    {
      key: 'volume',
      label: 'Projected volume',
      value: input.volume,
      weight: FACTOR_WEIGHTS.volume,
      note: 'Scheme pace and target share for his role',
    },
  ];

  const present = factors.filter((f) => f.value != null);
  const totalWeight = present.reduce((acc, f) => acc + f.weight, 0);

  if (totalWeight === 0) {
    return {
      score: 50,
      confidence: 0,
      factors: factors.map((f) => ({ ...f, weight: 0 })),
    };
  }

  const score = present.reduce((acc, f) => acc + f.value! * (f.weight / totalWeight), 0);

  return {
    score: clamp(score, 0, 100),
    confidence: totalWeight,
    factors: factors.map((f) => ({
      ...f,
      weight: f.value == null ? 0 : f.weight / totalWeight,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tendency resolution
// ---------------------------------------------------------------------------

/** Head-coaching games below which a coach profile is not trusted on its own. */
export const MIN_COACH_GAMES = 8;

export interface TendencyCandidate {
  source: TendencySource;
  values: Record<string, number>;
  nGames: number;
}

export interface ResolvedTendencies {
  source: TendencySource;
  values: Record<string, number>;
  nGames: number;
  /**
   * 1.0 for a well-sampled coach profile, tapering through the team fallback to
   * 0 for a bare league average. Carried into the UI so a profile built from a
   * new hire's predecessor is never presented as if it were his own.
   */
  confidence: number;
}

const SOURCE_CONFIDENCE: Record<TendencySource, number> = {
  coach: 1,
  team: 0.5,
  league: 0,
};

/**
 * Pick the best available tendency profile.
 *
 * Order is coach, then the franchise's own recent profile, then league average.
 * A coach with fewer than `MIN_COACH_GAMES` as a head coach is skipped: a
 * first-time hire has no head-coaching record to profile, and his coordinator
 * years cannot be attributed from play-by-play, which carries only the head
 * coach of each side.
 */
export function resolveTendencies(
  candidates: TendencyCandidate[],
): ResolvedTendencies | null {
  const order: TendencySource[] = ['coach', 'team', 'league'];

  for (const source of order) {
    const candidate = candidates.find(
      (c) =>
        c.source === source &&
        Object.keys(c.values).length > 0 &&
        (source !== 'coach' || c.nGames >= MIN_COACH_GAMES),
    );
    if (!candidate) continue;

    // A thin coach sample is still worth using, just not at full strength.
    const sampleFactor =
      source === 'coach' ? clamp(candidate.nGames / 34, 0.5, 1) : 1;

    return {
      source,
      values: candidate.values,
      nGames: candidate.nGames,
      confidence: SOURCE_CONFIDENCE[source] * sampleFactor,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Percentiles for non-positional scopes
// ---------------------------------------------------------------------------

/**
 * Mean/sd for one metric across a population of coaches, teams or defenses.
 *
 * The ranking engine's `buildBaselines` cannot be reused here: it emits scopes
 * keyed by position and cohort, which is exactly right for players and
 * meaningless for a coach. The distribution primitives underneath are the same.
 */
export interface Distribution {
  mean: number;
  sd: number;
  n: number;
}

/** Build one distribution per metric from flat observations. */
export function buildDistributions(
  rows: Array<{ metric: string; value: number }>,
): Record<string, Distribution> {
  const byMetric = new Map<string, number[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    const list = byMetric.get(row.metric);
    if (list) list.push(row.value);
    else byMetric.set(row.metric, [row.value]);
  }

  const out: Record<string, Distribution> = {};
  for (const [metric, values] of byMetric) {
    out[metric] = { mean: mean(values), sd: stdDev(values), n: values.length };
  }
  return out;
}

/** Smallest population that gets a percentile. Below this, sd is noise. */
export const MIN_DISTRIBUTION_N = 8;

/**
 * Where a value sits in its distribution, 0-100.
 *
 * Returns null rather than a neutral 50 when the metric cannot be placed, so
 * callers can drop it from a blend instead of diluting the blend with a
 * fabricated average.
 */
export function percentileOf(
  value: number | null | undefined,
  dist: Distribution | undefined,
  lowerIsBetter = false,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!dist || dist.n < MIN_DISTRIBUTION_N || dist.sd <= 0) return null;

  const z = (value - dist.mean) / dist.sd;
  return clamp(normalCdf(lowerIsBetter ? -z : z) * 100, 0, 100);
}
