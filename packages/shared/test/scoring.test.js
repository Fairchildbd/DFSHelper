import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBaselines,
  cohortFor,
  compareForRanking,
  componentWeights,
  normalizePosition,
  rankPlayers,
  scorePlayer,
} from '../dist/index.js';

/**
 * A synthetic baseline table. Values are loosely realistic so failures read
 * like football rather than like arithmetic.
 */
function baselines() {
  return {
    'pos:CB': {
      forty: { mean: 4.5, sd: 0.09, n: 400 },
      vertical: { mean: 35, sd: 3.5, n: 300 },
      shuttle: { mean: 4.25, sd: 0.15, n: 160 },
      cone: { mean: 6.95, sd: 0.2, n: 150 },
      def_pass_defended: { mean: 0.5, sd: 0.3, n: 200 },
      def_interceptions: { mean: 0.08, sd: 0.07, n: 200 },
      def_tackles: { mean: 3.5, sd: 1.4, n: 200 },
      def_tackles_for_loss: { mean: 0.2, sd: 0.15, n: 200 },
    },
    'cohort:SPEED': {
      forty: { mean: 4.48, sd: 0.1, n: 1200 },
      vertical: { mean: 35.5, sd: 3.6, n: 900 },
      shuttle: { mean: 4.24, sd: 0.16, n: 500 },
      cone: { mean: 6.92, sd: 0.21, n: 480 },
    },
  };
}

const basePlayer = {
  playerId: 'p1',
  name: 'Test Corner',
  position: 'CB',
  team: 'KC',
  age: 24,
  yearsExperience: 0,
  measurableSource: 'combine',
  production: {},
  gamesPlayed: 0,
};

test('position normalization folds messy source labels onto the canonical set', () => {
  assert.equal(normalizePosition('olb'), 'EDGE');
  assert.equal(normalizePosition(' HB '), 'RB');
  assert.equal(normalizePosition('FS'), 'S');
  assert.equal(normalizePosition('NT'), 'DT');
  assert.equal(normalizePosition('punter'), null);
  assert.equal(normalizePosition(null), null);
});

test('cohorts route positions to the right drill weighting', () => {
  assert.equal(cohortFor('WR'), 'SPEED');
  assert.equal(cohortFor('LB'), 'POWER');
  assert.equal(cohortFor('EDGE'), 'DL');
  assert.equal(cohortFor('C'), 'OL');
  assert.equal(cohortFor('K'), 'SPEC');
});

test('a fully measured elite athlete scores near the top with full confidence', () => {
  const score = scorePlayer(
    {
      ...basePlayer,
      // Roughly +2 SD on every drill that matters for a corner.
      measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 },
    },
    baselines(),
  );

  assert.equal(score.athletic.confidence, 1);
  assert.ok(score.athletic.score > 90, `expected >90, got ${score.athletic.score}`);
  // With no NFL snaps there is nothing to blend against, so the composite is
  // athletic-only — but a workout alone is still short of the evidence floor,
  // so it lands below the component score rather than equal to it.
  assert.equal(score.productionWeight, 0);
  assert.ok(score.composite < score.athletic.score);
  assert.ok(score.composite > 70, `a full elite workout should still rate well, got ${score.composite}`);
});

test('a partial workout earns partial weight, not a discounted score', () => {
  const table = baselines();

  const fullyMeasured = scorePlayer(
    { ...basePlayer, measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 } },
    table,
  );
  const fortyOnly = scorePlayer({ ...basePlayer, measurables: { forty: 4.32 } }, table);

  // The component score reports only what was recorded — an elite 40 reads
  // elite whether or not the other drills happened.
  assert.equal(fortyOnly.athletic.confidence, 0.25);
  assert.ok(fortyOnly.athletic.score > 90, `got ${fortyOnly.athletic.score}`);
  assert.equal(fullyMeasured.athletic.confidence, 1);

  // Uncertainty shows up as weight instead.
  assert.ok(fortyOnly.weights.athletic < fullyMeasured.weights.athletic);

  // And with no other evidence, thin evidence still cannot post an elite
  // composite — the evidence floor fills the gap with the positional average.
  assert.ok(
    fortyOnly.composite < 70,
    `one drill alone should not be elite, got ${fortyOnly.composite}`,
  );
});

/**
 * Regression: shrinking a component score toward 50 for missing drills meant a
 * player who ran one elite drill scored *worse* than one who skipped the
 * workout entirely — turning absent data into a penalty. Missing measurables
 * must be neutral.
 */
test('never working out does not count against a player', () => {
  const table = receiverBaselines();
  const withCollege = {
    ...ROOKIE_WR,
    collegeProduction: BIG_COLLEGE_LINE,
    collegeSeasons: 3,
  };

  const noWorkout = scorePlayer({ ...withCollege, measurables: {} }, table);
  const oneEliteDrill = scorePlayer({ ...withCollege, measurables: { forty: 4.3 } }, table);
  const fullEliteWorkout = scorePlayer(
    { ...withCollege, measurables: { forty: 4.3, vertical: 42, shuttle: 3.95, cone: 6.55 } },
    table,
  );

  assert.equal(noWorkout.athletic.score, null);
  assert.equal(noWorkout.weights.athletic, 0);
  assert.equal(noWorkout.weights.college, 1, 'college must carry the whole score');

  // Measuring an elite drill can only help.
  assert.ok(
    oneEliteDrill.composite >= noWorkout.composite,
    `an elite drill must not cost points (${oneEliteDrill.composite} vs ${noWorkout.composite})`,
  );
  assert.ok(fullEliteWorkout.composite >= oneEliteDrill.composite, 'more elite evidence, more gain');

  // A poor drill is real evidence and is allowed to hurt, in proportion.
  const oneBadDrill = scorePlayer({ ...withCollege, measurables: { forty: 4.75 } }, table);
  assert.ok(oneBadDrill.composite < noWorkout.composite);
  assert.ok(
    oneBadDrill.composite > noWorkout.composite - 15,
    'a single drill must not dominate an elite college profile',
  );
});

test('a veteran scores identically with or without a workout', () => {
  const table = receiverBaselines();
  const nfl = {
    ...ROOKIE_WR,
    yearsExperience: 6,
    gamesPlayed: 17,
    production: { fantasy_points_ppr: 19, target_share: 0.28, receiving_epa: 5.2, receiving_yards: 88 },
  };
  const bare = scorePlayer({ ...nfl, measurables: {} }, table);
  const workout = scorePlayer(
    { ...nfl, measurables: { forty: 4.3, vertical: 42, shuttle: 3.95, cone: 6.55 } },
    table,
  );
  assert.equal(bare.composite, workout.composite);
});

test('a player with no measurables at all is scored, not crashed', () => {
  const score = scorePlayer({ ...basePlayer, measurables: {} }, baselines());
  assert.equal(score.athletic.score, null);
  assert.equal(score.athletic.confidence, 0);
  assert.equal(score.composite, 50);
});

test('lower-is-better drills invert correctly', () => {
  const table = baselines();
  const fast = scorePlayer({ ...basePlayer, measurables: { forty: 4.3 } }, table);
  const slow = scorePlayer({ ...basePlayer, measurables: { forty: 4.7 } }, table);
  assert.ok(
    fast.athletic.score > slow.athletic.score,
    'a faster 40 must outscore a slower one',
  );

  const highJump = scorePlayer({ ...basePlayer, measurables: { vertical: 42 } }, table);
  const lowJump = scorePlayer({ ...basePlayer, measurables: { vertical: 28 } }, table);
  assert.ok(highJump.athletic.score > lowJump.athletic.score);
});

test('stats always outweigh measurables, at every experience level', () => {
  for (let exp = 0; exp <= 12; exp++) {
    const w = componentWeights(exp);
    const stats = w.college + w.nfl;
    assert.ok(
      stats > w.athletic,
      `year ${exp}: stats ${stats} must outweigh measurables ${w.athletic}`,
    );
    assert.ok(
      Math.abs(w.athletic + w.college + w.nfl - 1) < 1e-9,
      `year ${exp}: weights must sum to 1`,
    );
  }
});

test('college counts for three years, then stops entirely', () => {
  for (const exp of [0, 1, 2, 3]) {
    assert.ok(componentWeights(exp).college > 0, `year ${exp} should still count college`);
  }
  for (const exp of [4, 5, 9, 15]) {
    const w = componentWeights(exp);
    assert.equal(w.college, 0, `year ${exp} must not count college`);
    assert.equal(w.athletic, 0, `year ${exp} must not count measurables`);
    assert.equal(w.nfl, 1, `year ${exp} must be NFL production alone`);
  }
});

test('college production declines and NFL production rises across the first years', () => {
  const college = [0, 1, 2, 3].map((e) => componentWeights(e).college);
  const nfl = [0, 1, 2, 3].map((e) => componentWeights(e).nfl);
  for (let i = 1; i < college.length; i++) {
    assert.ok(college[i] < college[i - 1], 'college weight must decline');
    assert.ok(nfl[i] > nfl[i - 1], 'NFL weight must rise');
  }
});

test('a veteran is graded on production, a rookie on measurables', () => {
  const table = baselines();
  const measurables = { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 };
  const weakProduction = {
    def_pass_defended: 0.1,
    def_interceptions: 0.0,
    def_tackles: 1.5,
    def_tackles_for_loss: 0.0,
  };

  const rookie = scorePlayer(
    { ...basePlayer, measurables, yearsExperience: 0, gamesPlayed: 0, production: {} },
    table,
  );
  const veteran = scorePlayer(
    {
      ...basePlayer,
      measurables,
      yearsExperience: 6,
      gamesPlayed: 17,
      production: weakProduction,
    },
    table,
  );

  assert.ok(veteran.productionWeight > 0.8, `got ${veteran.productionWeight}`);
  assert.ok(
    veteran.composite < rookie.composite,
    'six years of weak tape should outweigh a great combine',
  );
});

const ELITE_CB_PRODUCTION = {
  def_pass_defended: 1.4,
  def_interceptions: 0.35,
  def_tackles: 6.0,
  def_tackles_for_loss: 0.6,
};

test('a short production sample is damped inside the production score itself', () => {
  const table = baselines();

  const oneGame = scorePlayer(
    {
      ...basePlayer,
      measurables: {},
      yearsExperience: 4,
      gamesPlayed: 1,
      production: ELITE_CB_PRODUCTION,
    },
    table,
  );
  const fullSeason = scorePlayer(
    {
      ...basePlayer,
      measurables: {},
      yearsExperience: 4,
      gamesPlayed: 17,
      production: ELITE_CB_PRODUCTION,
    },
    table,
  );

  // The measured rates are identical; only the sample behind them differs, so
  // the component score matches and the weight does not.
  assert.equal(oneGame.production.score, fullSeason.production.score);
  assert.equal(oneGame.production.sampleConfidence, 0.125);
  assert.ok(oneGame.weights.nfl < fullSeason.weights.nfl);
  assert.ok(
    oneGame.composite < 70,
    `one elite game must not read as an elite season, got ${oneGame.composite}`,
  );
  assert.ok(fullSeason.composite > 90, `got ${fullSeason.composite}`);
});

/**
 * Regression: a player with no combine data falls through to a production-only
 * composite. Damping that lived solely in the blend weight was skipped on that
 * path, letting a one-game call-up outrank an All-Pro at the same position.
 */
test('sample damping still applies when there are no measurables to blend against', () => {
  const table = baselines();

  const callUp = scorePlayer(
    {
      ...basePlayer,
      playerId: 'callup',
      measurables: {},
      yearsExperience: 1,
      gamesPlayed: 1,
      production: ELITE_CB_PRODUCTION,
    },
    table,
  );
  const allPro = scorePlayer(
    {
      ...basePlayer,
      playerId: 'allpro',
      measurables: {},
      yearsExperience: 8,
      gamesPlayed: 31,
      // Materially lower per-game rates, sustained over two full seasons.
      production: {
        def_pass_defended: 0.9,
        def_interceptions: 0.2,
        def_tackles: 4.2,
        def_tackles_for_loss: 0.35,
      },
    },
    table,
  );

  assert.equal(callUp.athletic.score, null);
  assert.ok(
    allPro.composite > callUp.composite,
    `31 games must outrank 1 game (${allPro.composite} vs ${callUp.composite})`,
  );
});

test('with no measurables the composite falls back entirely to production', () => {
  const table = baselines();
  const score = scorePlayer(
    {
      ...basePlayer,
      measurables: {},
      yearsExperience: 4,
      gamesPlayed: 17,
      production: ELITE_CB_PRODUCTION,
    },
    table,
  );
  assert.equal(score.athletic.score, null);
  assert.equal(score.productionWeight, 1);
  assert.equal(score.composite, score.production.score);
});

/**
 * Regression: quarterback drills describe mobility, not quarterbacking. Without
 * a cap, an unproven QB with a fast 40 outranked every established starter,
 * because the production floor cannot fire for a player with no production.
 */
test('quarterback measurables cannot carry a composite on their own', () => {
  const table = {
    'pos:QB': {
      forty: { mean: 4.8, sd: 0.22, n: 190 },
      broad: { mean: 112, sd: 7, n: 185 },
      fantasy_points_ppr: { mean: 14, sd: 6, n: 60 },
      passing_epa: { mean: 0.5, sd: 4, n: 60 },
      passing_first_downs: { mean: 11, sd: 5, n: 60 },
      interception_rate: { mean: 0.022, sd: 0.008, n: 60 },
    },
  };

  const athleticUnproven = scorePlayer(
    {
      ...basePlayer,
      position: 'QB',
      yearsExperience: 0,
      gamesPlayed: 0,
      production: {},
      measurables: { forty: 4.38, broad: 128 },
    },
    table,
  );

  const provenStarter = scorePlayer(
    {
      ...basePlayer,
      position: 'QB',
      yearsExperience: 7,
      gamesPlayed: 30,
      opportunities: 900, // pass attempts — the unit that gates a QB's sample
      measurables: {},
      production: {
        fantasy_points_ppr: 22,
        passing_epa: 6.5,
        passing_first_downs: 18,
        interception_rate: 0.012,
      },
    },
    table,
  );

  assert.equal(athleticUnproven.lowSignalMeasurables, true);
  assert.equal(athleticUnproven.athleticSignal, 0.3);
  // The raw athletic percentile is still reported honestly...
  assert.ok(athleticUnproven.athletic.score > 90, `got ${athleticUnproven.athletic.score}`);
  // ...it just is not allowed to dominate the composite.
  assert.ok(
    athleticUnproven.composite < 70,
    `a fast 40 should not make an elite QB, got ${athleticUnproven.composite}`,
  );
  assert.ok(
    provenStarter.composite > athleticUnproven.composite,
    'a proven starter must outrank an unproven athlete',
  );
});

test('non-quarterback cohorts keep full athletic signal', () => {
  const score = scorePlayer(
    { ...basePlayer, measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 } },
    baselines(),
  );
  assert.equal(score.athleticSignal, 1);
  assert.equal(score.lowSignalMeasurables, false);
  // Full signal means the drills reach the composite undiminished; the gap to
  // the component score is the evidence floor, not a cohort penalty.
  assert.ok(score.composite > 70);
});

/** Baselines covering the college metrics a receiver is graded on. */
function receiverBaselines() {
  return {
    'pos:WR': {
      forty: { mean: 4.5, sd: 0.09, n: 500 },
      vertical: { mean: 35, sd: 3.5, n: 400 },
      shuttle: { mean: 4.25, sd: 0.15, n: 200 },
      cone: { mean: 6.95, sd: 0.2, n: 200 },
      cfb_receiving_yards: { mean: 55, sd: 25, n: 300 },
      cfb_receiving_tds: { mean: 0.4, sd: 0.3, n: 300 },
      cfb_receptions: { mean: 4.0, sd: 1.8, n: 300 },
      cfb_yards_per_reception: { mean: 13.5, sd: 3, n: 300 },
      fantasy_points_ppr: { mean: 9, sd: 5, n: 300 },
      target_share: { mean: 0.15, sd: 0.07, n: 300 },
      receiving_epa: { mean: 0.5, sd: 3, n: 300 },
      receiving_yards: { mean: 45, sd: 25, n: 300 },
    },
  };
}

const ROOKIE_WR = {
  playerId: 'wr1',
  name: 'Test Receiver',
  position: 'WR',
  team: 'LA',
  age: 22,
  yearsExperience: 0,
  measurableSource: 'combine',
  measurables: {},
  production: {},
  gamesPlayed: 0,
  collegeSeasons: 3,
};

const BIG_COLLEGE_LINE = {
  cfb_receiving_yards: 110,
  cfb_receiving_tds: 1.1,
  cfb_receptions: 7.5,
  cfb_yards_per_reception: 16.2,
};

test('college production drives a rookie, and outweighs the workout', () => {
  const table = receiverBaselines();
  // A pedestrian workout paired with a dominant college career.
  const measurables = { forty: 4.58, vertical: 32, shuttle: 4.4, cone: 7.15 };

  const productive = scorePlayer(
    { ...ROOKIE_WR, measurables, collegeProduction: BIG_COLLEGE_LINE },
    table,
  );

  assert.ok(productive.college.score > 85, `college score ${productive.college.score}`);
  assert.ok(productive.athletic.score < 40, `athletic score ${productive.athletic.score}`);
  // Stats outweigh the workout, so the composite lands on the college side.
  assert.equal(productive.weights.college, 0.7);
  assert.equal(productive.weights.athletic, 0.3);
  assert.ok(
    productive.composite > 65,
    `production should carry the rookie, got ${productive.composite}`,
  );

  // The mirror image: great workout, unproductive in college.
  const athletic = scorePlayer(
    {
      ...ROOKIE_WR,
      measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 },
      collegeProduction: {
        cfb_receiving_yards: 18,
        cfb_receiving_tds: 0.05,
        cfb_receptions: 1.4,
        cfb_yards_per_reception: 9.8,
      },
    },
    table,
  );
  assert.ok(
    productive.composite > athletic.composite,
    `college production must beat a workout (${productive.composite} vs ${athletic.composite})`,
  );
});

test('college production is ignored once a player is four years in', () => {
  const table = receiverBaselines();
  const nflLine = {
    fantasy_points_ppr: 9,
    target_share: 0.15,
    receiving_epa: 0.5,
    receiving_yards: 45,
  };

  const withCollege = scorePlayer(
    {
      ...ROOKIE_WR,
      yearsExperience: 4,
      gamesPlayed: 17,
      opportunities: 150,
      production: nflLine,
      collegeProduction: BIG_COLLEGE_LINE,
      measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 },
    },
    table,
  );
  const withoutCollege = scorePlayer(
    {
      ...ROOKIE_WR,
      yearsExperience: 4,
      gamesPlayed: 17,
      opportunities: 150,
      production: nflLine,
      measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 },
    },
    table,
  );

  assert.equal(withCollege.weights.college, 0);
  assert.equal(withCollege.weights.athletic, 0);
  assert.equal(
    withCollege.composite,
    withoutCollege.composite,
    'a fourth-year player must score the same with or without college stats',
  );
  assert.equal(withCollege.composite, withCollege.production.score);
});

/**
 * Regression: a veteran with no NFL production used to fall back to his combine
 * numbers at full weight, which re-broke the "year 4+ is NFL only" rule and let
 * career backups outrank starters on a workout.
 */
test('a veteran with no NFL production is anchored below average, not scored on his workout', () => {
  const table = receiverBaselines();
  const eliteWorkout = { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 };

  const veteran = scorePlayer(
    {
      ...ROOKIE_WR,
      yearsExperience: 7,
      gamesPlayed: 0,
      production: {},
      measurables: eliteWorkout,
      collegeProduction: BIG_COLLEGE_LINE,
    },
    table,
  );

  assert.equal(veteran.noRecentProduction, true);
  assert.ok(veteran.athletic.score > 90, 'the workout is still reported honestly');
  assert.ok(veteran.composite < 40, `must not ride the workout, got ${veteran.composite}`);
  assert.equal(veteran.weights.athletic, 0);
  assert.equal(veteran.weights.college, 0);
  assert.equal(veteran.weights.nfl, 0);

  // A rookie in the same position is a genuine unknown, not a negative result.
  const rookie = scorePlayer({ ...ROOKIE_WR, measurables: eliteWorkout }, table);
  assert.equal(rookie.noRecentProduction, false);
  assert.ok(rookie.composite > veteran.composite);
});

test('a missing component renormalizes rather than dragging the composite down', () => {
  const table = receiverBaselines();

  // With college present, the two components split the whole score between them.
  const withCollege = scorePlayer(
    {
      ...ROOKIE_WR,
      collegeProduction: BIG_COLLEGE_LINE,
      collegeSeasons: 3,
      measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 },
    },
    table,
  );
  assert.ok(
    Math.abs(withCollege.weights.athletic + withCollege.weights.college - 1) < 1e-6,
    'present components must renormalize to the full score',
  );

  // A rookie with no college data falls back to the workout alone. That is
  // below the evidence floor, so the shortfall is filled with the positional
  // average rather than letting one component speak for everything.
  const noCollege = scorePlayer(
    { ...ROOKIE_WR, measurables: { forty: 4.32, vertical: 42, shuttle: 3.95, cone: 6.55 } },
    table,
  );
  assert.ok(noCollege.weights.athletic < 1);
  assert.ok(noCollege.composite < noCollege.athletic.score);
});

/**
 * Regression: sample confidence used to count games played, so a reserve who
 * appeared in ten blowouts scored a "full" sample on eighty attempts and
 * outranked a full-time starter. Opportunity, not attendance, gates trust.
 */
test('a reserve does not earn a starter-sized sample from garbage time', () => {
  const table = {
    'pos:QB': {
      fantasy_points_ppr: { mean: 14, sd: 6, n: 60 },
      adj_passing_epa_per_dropback: { mean: 0.0, sd: 0.15, n: 60 },
      passing_first_downs: { mean: 11, sd: 5, n: 60 },
      interception_rate: { mean: 0.022, sd: 0.008, n: 60 },
    },
  };
  const qb = (opportunities, production) => ({
    playerId: 'q', name: 'QB', position: 'QB', team: 'TEN', age: 24,
    yearsExperience: 2, measurables: {}, collegeProduction: {}, collegeSeasons: 0,
    gamesPlayed: 17, opportunities, production,
  });

  // A reserve: efficient on a tiny number of attempts.
  const reserve = scorePlayer(
    qb(89, { fantasy_points_ppr: 5, adj_passing_epa_per_dropback: 0.35, passing_first_downs: 3, interception_rate: 0.018 }),
    table,
  );
  // A full-time starter having a mediocre year.
  const starter = scorePlayer(
    qb(540, { fantasy_points_ppr: 11, adj_passing_epa_per_dropback: -0.05, passing_first_downs: 9, interception_rate: 0.013 }),
    table,
  );

  assert.ok(reserve.production.sampleConfidence < 0.5, `reserve sample ${reserve.production.sampleConfidence}`);
  assert.equal(starter.production.sampleConfidence, 1);
  assert.equal(starter.qualified, true);
  assert.ok(
    starter.weights.nfl > reserve.weights.nfl,
    'the starter must carry more production weight than the reserve',
  );
});

test('a player with almost no opportunity is not ranked as qualified', () => {
  const table = {
    'pos:QB': {
      fantasy_points_ppr: { mean: 14, sd: 6, n: 60 },
      adj_passing_epa_per_dropback: { mean: 0.0, sd: 0.15, n: 60 },
      passing_first_downs: { mean: 11, sd: 5, n: 60 },
      interception_rate: { mean: 0.022, sd: 0.008, n: 60 },
    },
  };
  const base = {
    playerId: 'q', name: 'QB', position: 'QB', team: 'X', age: 26,
    yearsExperience: 3, measurables: {}, collegeProduction: {}, collegeSeasons: 0,
    gamesPlayed: 2,
    production: { fantasy_points_ppr: 6, adj_passing_epa_per_dropback: 0.1, passing_first_downs: 4, interception_rate: 0.02 },
  };
  assert.equal(scorePlayer({ ...base, opportunities: 11 }, table).qualified, false);
  assert.equal(scorePlayer({ ...base, opportunities: 400 }, table).qualified, true);
});

/**
 * Regression: interceptions were scored per game, which rewards a quarterback
 * for throwing less rather than for protecting the ball. Rate is the measure.
 */
test('interceptions are judged as a rate, not a per-game count', () => {
  const table = {
    'pos:QB': {
      fantasy_points_ppr: { mean: 14, sd: 6, n: 60 },
      adj_passing_epa_per_dropback: { mean: 0.0, sd: 0.15, n: 60 },
      passing_first_downs: { mean: 11, sd: 5, n: 60 },
      interception_rate: { mean: 0.022, sd: 0.008, n: 60 },
    },
  };
  const qb = (rate) => scorePlayer({
    playerId: 'q', name: 'QB', position: 'QB', team: 'X', age: 26,
    yearsExperience: 4, measurables: {}, collegeProduction: {}, collegeSeasons: 0,
    gamesPlayed: 17, opportunities: 500,
    production: {
      fantasy_points_ppr: 14, adj_passing_epa_per_dropback: 0.0,
      passing_first_downs: 11, interception_rate: rate,
    },
  }, table);

  const careful = qb(0.011);
  const careless = qb(0.033);
  const pct = (s) => s.production.metrics.find((m) => m.metric === 'interception_rate').percentile;
  assert.ok(pct(careful) > pct(careless), 'a lower interception rate must score better');
  assert.ok(careful.composite > careless.composite);
});

/**
 * There are 32 starting quarterback jobs and no rotation, so a backup listed
 * above a starter is never useful information — the worst starter in the league
 * is still a starter. Quarterback is the only position gated this way; every
 * other position rotates, and a committee back must stay comparable to a
 * nominal starter.
 */
test('a starting quarterback outranks a backup regardless of score', () => {
  const table = {
    'pos:QB': {
      fantasy_points_ppr: { mean: 14, sd: 6, n: 60 },
      adj_passing_epa_per_dropback: { mean: 0.0, sd: 0.15, n: 60 },
      passing_first_downs: { mean: 11, sd: 5, n: 60 },
      interception_rate: { mean: 0.022, sd: 0.008, n: 60 },
    },
  };
  const qb = (name, starts, opportunities, production) => ({
    playerId: name, name, position: 'QB', team: 'X', age: 25,
    yearsExperience: 3, measurables: {}, collegeProduction: {}, collegeSeasons: 0,
    gamesPlayed: 17, opportunities, starts, production,
  });

  // A poor but full-time starter.
  const starter = scorePlayer(
    qb('starter', 16, 540, {
      fantasy_points_ppr: 11, adj_passing_epa_per_dropback: -0.2,
      passing_first_downs: 9, interception_rate: 0.013,
    }),
    table,
  );
  // An efficient backup on a fraction of the workload.
  const backup = scorePlayer(
    qb('backup', 2, 89, {
      fantasy_points_ppr: 6, adj_passing_epa_per_dropback: 0.45,
      passing_first_downs: 4, interception_rate: 0.011,
    }),
    table,
  );

  assert.equal(starter.rankTier, 0);
  assert.equal(backup.rankTier, 1);
  assert.ok(backup.composite > starter.composite, 'the backup does score higher');
  assert.ok(
    compareForRanking(starter, backup) < 0,
    'but the starter must still be listed first',
  );
});

test('starter gating applies to quarterbacks only', () => {
  const table = {
    'pos:RB': {
      fantasy_points_ppr: { mean: 9, sd: 5, n: 100 },
      adj_rushing_epa_per_carry: { mean: 0, sd: 0.15, n: 100 },
      rushing_yards: { mean: 40, sd: 25, n: 100 },
      receptions: { mean: 2, sd: 1.5, n: 100 },
    },
  };
  const rb = (starts) => scorePlayer({
    playerId: 'rb' + starts, name: 'RB', position: 'RB', team: 'X', age: 24,
    yearsExperience: 3, measurables: {}, collegeProduction: {}, collegeSeasons: 0,
    gamesPlayed: 17, opportunities: 200, starts,
    production: {
      fantasy_points_ppr: 14, adj_rushing_epa_per_carry: 0.1,
      rushing_yards: 70, receptions: 3,
    },
  }, table);

  // A committee back who never "starts" is not tiered beneath one who does.
  assert.equal(rb(0).rankTier, 0);
  assert.equal(rb(17).rankTier, 0);
});

test('buildBaselines produces both position and cohort scopes', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({ position: 'WR', metric: 'forty', value: 4.4 + i * 0.005 });
    rows.push({ position: 'CB', metric: 'forty', value: 4.45 + i * 0.005 });
  }
  const table = buildBaselines(rows);

  assert.equal(table['pos:WR'].forty.n, 60);
  assert.equal(table['pos:CB'].forty.n, 60);
  assert.equal(table['cohort:SPEED'].forty.n, 120);
  assert.ok(table['pos:WR'].forty.sd > 0);
  assert.ok(Math.abs(table['pos:WR'].forty.mean - 4.5475) < 0.01);
});

test('baselines below the sample threshold fall back to the cohort scope', () => {
  const table = baselines();
  // pos:CB has no broad-jump baseline and SPEED has none either, so the drill
  // is simply unmeasurable rather than silently mis-scoped.
  const thin = {
    'pos:CB': { forty: { mean: 4.5, sd: 0.09, n: 5 } },
    'cohort:SPEED': { forty: { mean: 4.48, sd: 0.1, n: 1200 } },
  };
  const score = scorePlayer({ ...basePlayer, measurables: { forty: 4.3 } }, thin);
  const fortyMetric = score.athletic.metrics.find((m) => m.metric === 'forty');
  assert.equal(fortyMetric.scope, 'cohort:SPEED', 'thin position baseline must fall back');

  // And with the healthy table it uses the tighter position scope.
  const scoped = scorePlayer({ ...basePlayer, measurables: { forty: 4.3 } }, table);
  assert.equal(scoped.athletic.metrics.find((m) => m.metric === 'forty').scope, 'pos:CB');
});

test('rankPlayers sorts by composite descending', () => {
  const table = baselines();
  const ranked = rankPlayers(
    [
      { ...basePlayer, playerId: 'slow', measurables: { forty: 4.7, vertical: 30, shuttle: 4.5, cone: 7.3 } },
      { ...basePlayer, playerId: 'fast', measurables: { forty: 4.3, vertical: 41, shuttle: 3.98, cone: 6.6 } },
      { ...basePlayer, playerId: 'mid', measurables: { forty: 4.5, vertical: 35, shuttle: 4.25, cone: 6.95 } },
    ],
    table,
  );
  assert.deepEqual(ranked.map((p) => p.playerId), ['fast', 'mid', 'slow']);
  assert.ok(ranked[0].composite > ranked[2].composite);
});
