import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDGE_THRESHOLD,
  LANES,
  LANES_BY_KEY,
  DEFENSE_EDGE_WEIGHT,
  LEAN_TOLERANCE,
  LIVE_GAME_FLOOR,
  STRONG_DEFENSE_CEILING,
  aggregateEdges,
  computeLaneEdge,
  computeMismatch,
  classifyGame,
  computeShootout,
  edgeWeight,
  edgeToScale,
  gradePlayerMatchup,
  laneForPosition,
  percentileOf,
  qbRushAdjustment,
  resolveTendencies,
  roleWeight,
  MAX_QB_RUSH_ADJUSTMENT,
  QB_POCKET_CARRIES,
} from '../dist/index.js';

const edge = (lane, value) => ({ lane, label: lane, edge: value, usageAdjustment: 0 });

/** A lane carrying the two unit strengths, for the scoring-environment read. */
const sided = (lane, offense, defense, off, def) => ({
  lane,
  label: `${offense} ${lane} vs ${defense}`,
  offense,
  defense,
  offenseStrength: off,
  defenseStrength: def,
  edge: off - def,
  usageAdjustment: 0,
});

/** Six lanes each way, both teams flat at the given strengths. */
const game = (a, aOff, b, bOff, aDef = 50, bDef = 50) =>
  ['qb_pass', 'wr', 'te', 'rb_rush', 'rb_recv', 'ol_pass_pro'].flatMap((lane) => [
    sided(lane, a, b, aOff, bDef),
    sided(lane, b, a, bOff, aDef),
  ]);

// ---------------------------------------------------------------------------
// Lane wiring for the opponent adjustment
// ---------------------------------------------------------------------------

test('every lane names an opponent-adjusted efficiency metric', () => {
  // Including the offensive line lane, which has no defense-versus-position
  // profile — this is the only results-based signal it gets.
  for (const lane of LANES) {
    assert.ok(lane.dvoaMetric, `${lane.key} has no dvoaMetric`);
    assert.match(lane.dvoaMetric, /_adj$/, `${lane.key} points at an unadjusted metric`);
  }
});

test('scheme metrics no longer carry raw efficiency allowed', () => {
  // These moved to `dvoaMetric` when the opponent adjustment arrived. Leaving a
  // raw copy behind would put the schedule bias back into the grade through the
  // scheme bucket, and double-count the same evidence besides.
  for (const lane of LANES) {
    for (const metric of lane.defenseMetrics) {
      assert.ok(
        !/^epa_allowed_(pass|rush)$/.test(metric),
        `${lane.key} still grades on raw ${metric}`,
      );
    }
  }
});

test('run and pass lanes are adjusted against their own play type', () => {
  // A defense that cannot stop the run is not thereby bad against the pass, so
  // the run lane must not be graded on passing efficiency allowed.
  assert.equal(LANES_BY_KEY.rb_rush.dvoaMetric, 'epa_allowed_rush_adj');
  assert.equal(LANES_BY_KEY.qb_pass.dvoaMetric, 'epa_allowed_pass_adj');
  assert.equal(LANES_BY_KEY.rb_recv.dvoaMetric, 'epa_allowed_pass_adj');
});

// ---------------------------------------------------------------------------
// Role weighting
// ---------------------------------------------------------------------------

test('role weight halves with each step down the depth chart', () => {
  assert.equal(roleWeight(1, 4), 1);
  assert.equal(roleWeight(2, 4), 0.5);
  assert.equal(roleWeight(3, 4), 0.25);
});

test('role weight keeps decaying past the lane cutoff', () => {
  // Regression: clamping rank to maxRank gave every quarterback on the roster
  // the starter's weight, because the quarterback lane counts a single slot —
  // which put fourth-string passers among the best plays on the slate.
  const qb = LANES_BY_KEY.qb_pass;
  assert.equal(qb.maxRank, 1);
  assert.equal(roleWeight(1, qb.maxRank), 1);
  assert.equal(roleWeight(2, qb.maxRank), 0.5);
  assert.equal(roleWeight(4, qb.maxRank), 0.125);
  assert.ok(roleWeight(4, qb.maxRank) < roleWeight(1, qb.maxRank));
});

test('an unknown depth rank is treated as the last counted slot', () => {
  assert.equal(roleWeight(null, 4), roleWeight(4, 4));
  assert.equal(roleWeight(undefined, 2), roleWeight(2, 2));
});

// ---------------------------------------------------------------------------
// Lane edges
// ---------------------------------------------------------------------------

test('a lane edge is the offense percentile minus the defense percentile', () => {
  const result = computeLaneEdge({
    lane: LANES_BY_KEY.wr,
    offenseStrength: 80,
    defenseStrength: 30,
  });
  assert.equal(result.edge, 50);
  assert.equal(result.usageAdjustment, 0);
});

test('an ungradeable side leaves the edge null rather than assuming average', () => {
  const missingOffense = computeLaneEdge({
    lane: LANES_BY_KEY.te,
    offenseStrength: null,
    defenseStrength: 40,
  });
  assert.equal(missingOffense.edge, null);

  const missingDefense = computeLaneEdge({
    lane: LANES_BY_KEY.te,
    offenseStrength: 70,
    defenseStrength: null,
  });
  assert.equal(missingDefense.edge, null);
});

test('a coach usage tendency shifts an edge but cannot manufacture one', () => {
  const heavy = computeLaneEdge({
    lane: LANES_BY_KEY.te,
    offenseStrength: 50,
    defenseStrength: 50,
    usagePercentile: 100,
  });
  const light = computeLaneEdge({
    lane: LANES_BY_KEY.te,
    offenseStrength: 50,
    defenseStrength: 50,
    usagePercentile: 0,
  });

  assert.equal(heavy.edge, 10);
  assert.equal(light.edge, -10);
  // Scheme decides how often a mismatch is attacked, not whether it exists,
  // so it must stay small next to the units themselves.
  assert.ok(Math.abs(heavy.edge) < EDGE_THRESHOLD);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('one severe mismatch outranks several mild ones', () => {
  const severe = aggregateEdges([edge('wr', 80), edge('te', 5), edge('rb_rush', 5)]);
  const mild = aggregateEdges([
    edge('wr', 30),
    edge('te', 30),
    edge('rb_rush', 30),
    edge('qb_pass', 30),
  ]);
  assert.ok(severe.edgeScore > mild.edgeScore);
});

test('only the four largest edges count toward the score', () => {
  const four = aggregateEdges([edge('a', 50), edge('b', 50), edge('c', 50), edge('d', 50)]);
  const eight = aggregateEdges([
    edge('a', 50), edge('b', 50), edge('c', 50), edge('d', 50),
    edge('e', 1), edge('f', 1), edge('g', 1), edge('h', 1),
  ]);
  // The four trailing near-zero lanes must not dilute the score.
  assert.equal(four.edgeScore, eight.edgeScore);
});

test('an offense-favourable edge outscores the identical edge for the defense', () => {
  // The bug this replaces: taking the absolute value made these equal, so a
  // slate could be topped by a game whose defining feature was that nobody in
  // it should be rostered.
  const forOffense = aggregateEdges([edge('wr', 60), edge('te', 40)]);
  const forDefense = aggregateEdges([edge('wr', -60), edge('te', -40)]);
  assert.ok(forOffense.edgeScore > forDefense.edgeScore);
  assert.equal(
    forDefense.edgeScore,
    forOffense.edgeScore * DEFENSE_EDGE_WEIGHT,
  );
});

test('a defensive edge still counts for something', () => {
  // Weighted down, not discarded: a one-sided beating concentrates whatever
  // scoring happens on the side doing the beating.
  const lopsided = aggregateEdges([edge('wr', -80)]);
  assert.ok(lopsided.edgeScore > 0);
  assert.equal(edgeWeight(-80), 80 * DEFENSE_EDGE_WEIGHT);
  assert.equal(edgeWeight(80), 80);
});

test('the headline lane is the one the score was built from', () => {
  // A larger defensive edge next to a smaller offensive one: the headline has
  // to name whichever the score actually weighted highest, or the list row
  // describes a different game from the one it ranked.
  const result = aggregateEdges([edge('wr', 50), edge('te', -80)]);
  assert.equal(result.top.lane, 'wr');
  assert.equal(edgeWeight(-80) < edgeWeight(50), true);
});

test('mismatch count applies the threshold to the weighted edge', () => {
  const result = aggregateEdges([
    edge('a', EDGE_THRESHOLD + 1),
    // Past the threshold in raw magnitude, short of it once weighted, which is
    // the whole point: it is a lane to fade, not a spot to attack.
    edge('b', -(EDGE_THRESHOLD + 1)),
    edge('c', EDGE_THRESHOLD - 1),
  ]);
  assert.equal(result.edgeCount, 1);
});

test('the score never saturates on realistic input', () => {
  // Every lane maximally lopsided is the theoretical ceiling; anything short of
  // that has to stay strictly below 100 or the sort loses its top end.
  const extreme = aggregateEdges([edge('a', 90), edge('b', 85), edge('c', 80), edge('d', 75)]);
  assert.ok(extreme.edgeScore < 100, `expected < 100, got ${extreme.edgeScore}`);
  assert.ok(extreme.edgeScore > 70);
});

test('ungradeable lanes are skipped, not scored as zero', () => {
  const withNulls = aggregateEdges([edge('a', 60), edge('b', null), edge('c', null)]);
  const without = aggregateEdges([edge('a', 60)]);
  assert.equal(withNulls.edgeScore, without.edgeScore);
  assert.equal(withNulls.graded, 1);
});

test('a game with no gradeable lane scores zero rather than throwing', () => {
  const empty = aggregateEdges([edge('a', null)]);
  assert.equal(empty.edgeScore, 0);
  assert.equal(empty.top, null);
});

// ---------------------------------------------------------------------------
// Scoring projection
// ---------------------------------------------------------------------------

test('a high total with two live offenses beats a high total with one', () => {
  // The distinction the mismatch score cannot make: both games price the same
  // in Vegas, and only one of them is a game to stack.
  const even = computeShootout({ edges: game('AAA', 70, 'BBB', 70), totalLine: 49 });
  const lopsided = computeShootout({ edges: game('AAA', 95, 'BBB', 45), totalLine: 49 });
  assert.ok(even.score > lopsided.score);
  assert.equal(even.leanTeam, null);
  assert.equal(lopsided.leanTeam, 'AAA');
});

test('a lane gap inside the tolerance is not called a lean', () => {
  const close = computeShootout({
    edges: game('AAA', 55, 'BBB', 55 - (LEAN_TOLERANCE - 1)),
    totalLine: 45,
  });
  assert.equal(close.leanTeam, null);
  assert.ok(close.lean > 0);
});

test('weak defenses raise the score and strong ones lower it', () => {
  const soft = computeShootout({ edges: game('AAA', 60, 'BBB', 60, 20, 20), totalLine: 45 });
  const stingy = computeShootout({ edges: game('AAA', 60, 'BBB', 60, 85, 85), totalLine: 45 });
  assert.ok(soft.score > stingy.score);
});

test('the total leads but does not decide alone', () => {
  const edges = game('AAA', 60, 'BBB', 60);
  const high = computeShootout({ edges, totalLine: 52 });
  const low = computeShootout({ edges, totalLine: 38 });
  assert.ok(high.score > low.score);

  // A dead-total game with two good offenses behind two bad defenses still
  // outscores a priced game with nothing behind it — which is exactly the case
  // the environment multiplier, capped at 15%, could never express.
  const liveButCheap = computeShootout({
    edges: game('AAA', 75, 'BBB', 72, 25, 25),
    totalLine: 41,
  });
  const pricedButEmpty = computeShootout({
    edges: game('AAA', 25, 'BBB', 22, 80, 80),
    totalLine: 46,
  });
  assert.ok(liveButCheap.score > pricedButEmpty.score);
});

test('pace moves the score in the right direction', () => {
  const edges = game('AAA', 60, 'BBB', 60);
  const fast = computeShootout({ edges, totalLine: 45, pacePercentile: 90 });
  const slow = computeShootout({ edges, totalLine: 45, pacePercentile: 10 });
  assert.ok(fast.score > slow.score);
});

test('a missing total renormalises rather than scoring the game as neutral', () => {
  const edges = game('AAA', 80, 'BBB', 78, 20, 20);
  const priced = computeShootout({ edges, totalLine: 50 });
  const unpriced = computeShootout({ edges, totalLine: null });

  assert.equal(priced.applied, true);
  assert.equal(unpriced.applied, false);
  assert.equal(unpriced.components.total, null);
  // Renormalised over the three remaining components, so a game the model
  // likes stays liked when the line has not been published yet.
  assert.ok(unpriced.score > 60);
});

test('a live game is a shootout when it splits and one-sided when it leans', () => {
  assert.equal(classifyGame(LIVE_GAME_FLOOR, null, 50), 'shootout');
  assert.equal(classifyGame(LIVE_GAME_FLOOR, 'AAA', 50), 'one_sided');
  // The defenses do not enter the question while a game still projects points:
  // a game worth playing is worth playing whoever it is played against.
  assert.equal(classifyGame(80, null, 5), 'shootout');
  assert.equal(classifyGame(80, 'AAA', 95), 'one_sided');
});

test('a quiet game is defensive only when the defenses earned it', () => {
  const quiet = LIVE_GAME_FLOOR - 1;
  assert.equal(classifyGame(quiet, null, STRONG_DEFENSE_CEILING), 'defensive');
  assert.equal(classifyGame(quiet, null, STRONG_DEFENSE_CEILING + 1), 'low_scoring');
  // Two bad offenses behind two bad defenses is not a defensive game, however
  // few points it projects — nobody stopped anybody.
  assert.equal(classifyGame(30, null, 70), 'low_scoring');
  // And a lean cannot rescue a quiet game into the playable half.
  assert.equal(classifyGame(quiet, 'AAA', 70), 'low_scoring');
});

test('an ungradeable defense makes the weaker claim, not the stronger one', () => {
  assert.equal(classifyGame(30, null, null), 'low_scoring');
});

test('computeShootout labels the game it just scored', () => {
  const live = computeShootout({ edges: game('AAA', 75, 'BBB', 73, 25, 25), totalLine: 50 });
  assert.equal(live.shape, 'shootout');
  assert.ok(live.score >= LIVE_GAME_FLOOR);

  const dead = computeShootout({ edges: game('AAA', 20, 'BBB', 22, 85, 85), totalLine: 38 });
  assert.equal(dead.shape, 'defensive');

  const lopsided = computeShootout({ edges: game('AAA', 92, 'BBB', 46, 25, 25), totalLine: 50 });
  assert.equal(lopsided.shape, 'one_sided');
  assert.equal(lopsided.leanTeam, 'AAA');
});

test('a game with no gradeable lane scores zero rather than throwing', () => {
  const blank = computeShootout({ edges: [edge('a', null)], totalLine: null });
  assert.equal(blank.score, 0);
  assert.equal(blank.leanTeam, null);
});

test('edges without team fields still score, minus the lean', () => {
  // Rows written before `offense` existed on a lane edge. A stale row is a
  // thing to read, not a thing to crash on.
  const legacy = computeShootout({
    edges: [edge('wr', 20), edge('te', 10)].map((e) => ({
      ...e,
      offenseStrength: 60,
      defenseStrength: 40,
    })),
    totalLine: 47,
  });
  assert.ok(legacy.score > 0);
  assert.equal(legacy.leanTeam, null);
  assert.equal(legacy.lean, 0);
});

test('computeMismatch carries both readings of the same game', () => {
  const result = computeMismatch({
    edges: game('AAA', 70, 'BBB', 68, 30, 30),
    totalLine: 49,
  });
  assert.ok(result.mismatchScore > 0);
  assert.ok(result.shootout.score > 0);
  assert.equal(result.shootout.applied, true);
});

test('the mismatch score is the edge score, unscaled by anything', () => {
  // It used to be multiplied by a capped game-environment term, which made one
  // number a blend of two questions and left a slate of unpriced games ranked
  // by a different formula from the priced ones. The total now reaches the
  // product through the shootout score instead.
  const edges = game('AAA', 70, 'BBB', 68, 30, 30);
  const priced = computeMismatch({ edges, totalLine: 52, pacePercentile: 90 });
  const unpriced = computeMismatch({ edges, totalLine: null });

  assert.equal(priced.mismatchScore, priced.edgeScore);
  assert.equal(priced.mismatchScore, unpriced.mismatchScore);
  // And the total still moves the product — on the axis that is about scoring.
  assert.ok(priced.shootout.score > unpriced.shootout.score);
});

// ---------------------------------------------------------------------------
// Quarterback rushing
// ---------------------------------------------------------------------------

test('a pocket passer gets nothing from a soft run defense', () => {
  assert.equal(qbRushAdjustment(1.5, 10), 0);
  assert.equal(qbRushAdjustment(QB_POCKET_CARRIES, 0), 0);
});

test('a runner is rewarded against a bad run defense and punished against a good one', () => {
  assert.ok(qbRushAdjustment(9, 10) > 0);
  assert.ok(qbRushAdjustment(9, 90) < 0);
  assert.equal(qbRushAdjustment(9, 50), 0);
});

test('the rushing adjustment is bounded', () => {
  assert.equal(qbRushAdjustment(20, 0), MAX_QB_RUSH_ADJUSTMENT);
  assert.equal(qbRushAdjustment(20, 100), -MAX_QB_RUSH_ADJUSTMENT);
});

test('more carries means more of the adjustment', () => {
  const some = qbRushAdjustment(5, 20);
  const lots = qbRushAdjustment(8, 20);
  assert.ok(lots > some && some > 0);
});

test('missing rushing data or an ungraded run defense is neutral, not a penalty', () => {
  assert.equal(qbRushAdjustment(null, 20), 0);
  assert.equal(qbRushAdjustment(9, null), 0);
  assert.equal(qbRushAdjustment(undefined, undefined), 0);
});
