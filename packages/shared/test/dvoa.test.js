import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEASON_DECAY,
  SUCCESS_THRESHOLD_BY_DOWN,
  blendSeasons,
  fitTwoWay,
  isSuccessfulPlay,
  valueOverAverage,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Success, in the DVOA sense
// ---------------------------------------------------------------------------

test('first down needs 45 percent of the yards to go', () => {
  assert.equal(isSuccessfulPlay({ down: 1, yardsToGo: 10, yardsGained: 5 }), true);
  assert.equal(isSuccessfulPlay({ down: 1, yardsToGo: 10, yardsGained: 4 }), false);
});

test('second down needs 60 percent', () => {
  assert.equal(isSuccessfulPlay({ down: 2, yardsToGo: 10, yardsGained: 6 }), true);
  assert.equal(isSuccessfulPlay({ down: 2, yardsToGo: 10, yardsGained: 5 }), false);
});

test('third and fourth down need the conversion and nothing less', () => {
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 4, yardsGained: 4 }), true);
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 4, yardsGained: 3 }), false);
  assert.equal(isSuccessfulPlay({ down: 4, yardsToGo: 1, yardsGained: 1 }), true);
});

test('the same gain is graded differently by situation', () => {
  // The whole point of a situational baseline: five yards is a success on
  // third-and-4 and a failure on third-and-12.
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 4, yardsGained: 5 }), true);
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 12, yardsGained: 5 }), false);
});

test('a touchdown is a success even when it falls short of the yardage test', () => {
  // Third-and-goal from the two, scored from the one yard line: half the
  // distance, all of the points.
  assert.equal(
    isSuccessfulPlay({ down: 3, yardsToGo: 2, yardsGained: 1, touchdown: true }),
    true,
  );
});

test('a turnover is a failure however far the ball travelled', () => {
  assert.equal(
    isSuccessfulPlay({ down: 1, yardsToGo: 10, yardsGained: 40, turnover: true }),
    false,
  );
});

test('goal-to-go with zero yards to go still resolves', () => {
  // Regression guard: a zero denominator made every such snap a success.
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 0, yardsGained: 0 }), false);
  assert.equal(isSuccessfulPlay({ down: 3, yardsToGo: 0, yardsGained: 1 }), true);
});

test('an unknown situation is unknown, not a failure', () => {
  assert.equal(isSuccessfulPlay({ down: null, yardsToGo: 10, yardsGained: 3 }), null);
  assert.equal(isSuccessfulPlay({ down: 1, yardsToGo: 10, yardsGained: null }), null);
  // Two-point conversions arrive with no down at all.
  assert.equal(isSuccessfulPlay({ down: 5, yardsToGo: 2, yardsGained: 2 }), null);
});

test('the published thresholds are the Football Outsiders ones', () => {
  assert.equal(SUCCESS_THRESHOLD_BY_DOWN[1], 0.45);
  assert.equal(SUCCESS_THRESHOLD_BY_DOWN[2], 0.6);
  assert.equal(SUCCESS_THRESHOLD_BY_DOWN[3], 1);
  assert.equal(SUCCESS_THRESHOLD_BY_DOWN[4], 1);
});

// ---------------------------------------------------------------------------
// Two-way opponent adjustment
// ---------------------------------------------------------------------------

/**
 * A synthetic round-robin league with known coefficients.
 *
 * Every offense plays every defense the same number of times, so the schedule
 * carries no bias at all and the fit has nothing to correct — this is the
 * control case that proves the estimator is unbiased before it is asked to
 * remove a real imbalance.
 */
function roundRobin(offStrength, defStrength, league, n) {
  const cells = [];
  for (const [o, os] of Object.entries(offStrength)) {
    for (const [d, ds] of Object.entries(defStrength)) {
      cells.push({ offense: o, defense: d, n, sum: n * (league + os + ds) });
    }
  }
  return cells;
}

test('recovers known coefficients from a balanced schedule', () => {
  const off = { A: 0.2, B: 0, C: -0.2 };
  const def = { X: 0.15, Y: 0, Z: -0.15 };
  const fit = fitTwoWay(roundRobin(off, def, 0.05, 400), { shrinkage: 0 });

  assert.ok(Math.abs(fit.league - 0.05) < 1e-9, `league ${fit.league}`);
  for (const [team, expected] of Object.entries(off)) {
    assert.ok(
      Math.abs(fit.offense.get(team) - expected) < 1e-6,
      `offense ${team}: ${fit.offense.get(team)} vs ${expected}`,
    );
  }
  for (const [team, expected] of Object.entries(def)) {
    assert.ok(
      Math.abs(fit.defense.get(team) - expected) < 1e-6,
      `defense ${team}: ${fit.defense.get(team)} vs ${expected}`,
    );
  }
});

test('separates a soft schedule from a good defense', () => {
  // The bias this whole module exists to remove. Both defenses are exactly
  // league average, but SOFT only ever faces the worst offense in the league
  // and HARD only ever faces the best. A raw average allowed would call SOFT
  // elite and HARD terrible; the fit must call them equal.
  const league = 0.05;
  const cells = [
    { offense: 'GOOD', defense: 'HARD', n: 500, sum: 500 * (league + 0.25) },
    { offense: 'BAD', defense: 'SOFT', n: 500, sum: 500 * (league - 0.25) },
    // A few connecting games, without which the two halves of the league are
    // not comparable at all.
    { offense: 'GOOD', defense: 'SOFT', n: 100, sum: 100 * (league + 0.25) },
    { offense: 'BAD', defense: 'HARD', n: 100, sum: 100 * (league - 0.25) },
  ];

  const raw = {
    HARD: (500 * (league + 0.25) + 100 * (league - 0.25)) / 600,
    SOFT: (500 * (league - 0.25) + 100 * (league + 0.25)) / 600,
  };
  // Raw averages are far apart and in opposite directions...
  assert.ok(raw.HARD - raw.SOFT > 0.3, `raw gap ${raw.HARD - raw.SOFT}`);

  // ...but neither defense is actually any good or any bad.
  const fit = fitTwoWay(cells, { shrinkage: 0 });
  assert.ok(Math.abs(fit.defense.get('HARD')) < 1e-6, `HARD ${fit.defense.get('HARD')}`);
  assert.ok(Math.abs(fit.defense.get('SOFT')) < 1e-6, `SOFT ${fit.defense.get('SOFT')}`);
});

test('coefficients are centred, so zero means league average', () => {
  const fit = fitTwoWay(roundRobin({ A: 0.3, B: -0.1 }, { X: 0.2, Y: -0.4 }, 0.02, 300), {
    shrinkage: 0,
  });
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(fit.offense)) < 1e-6, `offense sum ${sum(fit.offense)}`);
  assert.ok(Math.abs(sum(fit.defense)) < 1e-6, `defense sum ${sum(fit.defense)}`);
});

test('shrinkage pulls a thin sample toward league average', () => {
  const cells = roundRobin({ A: 0.4, B: -0.4 }, { X: 0.3, Y: -0.3 }, 0, 10);
  const shrunk = fitTwoWay(cells, { shrinkage: 200 });
  const full = fitTwoWay(cells, { shrinkage: 0 });

  // Same sign, materially smaller: a twenty-play sample should not move a
  // player's grade as far as a full season's would.
  assert.ok(shrunk.defense.get('X') > 0);
  assert.ok(
    Math.abs(shrunk.defense.get('X')) < Math.abs(full.defense.get('X')) / 2,
    `shrunk ${shrunk.defense.get('X')} vs full ${full.defense.get('X')}`,
  );
});

test('an empty set of cells is not an error', () => {
  const fit = fitTwoWay([]);
  assert.equal(fit.league, 0);
  assert.equal(fit.offense.size, 0);
  assert.equal(fit.iterations, 0);
});

test('cells with no observations are ignored rather than counted as zero', () => {
  const withEmpties = fitTwoWay(
    [
      ...roundRobin({ A: 0.2, B: -0.2 }, { X: 0.1, Y: -0.1 }, 0.05, 300),
      { offense: 'A', defense: 'X', n: 0, sum: 0 },
    ],
    { shrinkage: 0 },
  );
  assert.ok(Math.abs(withEmpties.league - 0.05) < 1e-9);
});

test('convergence is measured after centring, on an unbalanced schedule', () => {
  /*
   * Regression. Movement used to be measured inside the half-step, comparing
   * each freshly estimated coefficient against the *centred* value it replaced
   * — so the centring offset stayed in the difference forever. On a balanced
   * schedule that offset is zero and the bug is invisible, which is exactly why
   * every test above missed it. On real 2024 play-by-play the reported delta
   * settled at 1.3e-3 and stopped moving while the coefficients themselves were
   * converging to machine precision, so the tolerance never fired and every fit
   * silently ran its full iteration budget.
   *
   * This schedule is deliberately lopsided, which is what makes the centring
   * offset non-zero and the regression detectable.
   */
  const cells = [
    { offense: 'A', defense: 'X', n: 700, sum: 700 * 0.3 },
    { offense: 'A', defense: 'Y', n: 90, sum: 90 * 0.1 },
    { offense: 'B', defense: 'X', n: 80, sum: 80 * -0.1 },
    { offense: 'B', defense: 'Y', n: 620, sum: 620 * -0.25 },
    { offense: 'C', defense: 'X', n: 200, sum: 200 * 0.05 },
    { offense: 'C', defense: 'Z', n: 540, sum: 540 * 0.02 },
    { offense: 'A', defense: 'Z', n: 110, sum: 110 * 0.28 },
  ];

  const at = (maxIterations) =>
    fitTwoWay(cells, { shrinkage: 300, maxIterations, tolerance: 0 });

  // The property the bug violated: reported movement has to keep shrinking.
  // Under the old measurement these three were all the same number.
  const early = at(2).delta;
  const mid = at(6).delta;
  const late = at(14).delta;
  assert.ok(mid < early / 10, `delta barely moved: ${early} -> ${mid}`);
  assert.ok(late < mid / 10, `delta plateaued: ${mid} -> ${late}`);

  // And the tolerance must actually be reachable, which is what makes the
  // early exit more than decoration.
  const fit = fitTwoWay(cells, { shrinkage: 300, maxIterations: 40, tolerance: 1e-6 });
  assert.ok(fit.iterations < 40, `never hit tolerance: ${fit.iterations} iterations`);

  // Stopping early must not mean stopping at the wrong answer.
  const converged = at(400);
  for (const [team, value] of fit.defense) {
    assert.ok(
      Math.abs(value - converged.defense.get(team)) < 1e-5,
      `${team}: ${value} vs converged ${converged.defense.get(team)}`,
    );
  }
});

test('the fit converges rather than running out its iteration budget', () => {
  const fit = fitTwoWay(
    roundRobin({ A: 0.2, B: 0, C: -0.2 }, { X: 0.1, Y: 0, Z: -0.1 }, 0.05, 400),
    { shrinkage: 0 },
  );
  assert.ok(fit.iterations < 12, `took ${fit.iterations} iterations`);
  assert.ok(fit.delta < 1e-6);
});

// ---------------------------------------------------------------------------
// Value over average
// ---------------------------------------------------------------------------

test('value over average reports a percentage of the baseline', () => {
  assert.equal(valueOverAverage(22, 20), 10);
  assert.equal(valueOverAverage(18, 20), -10);
});

test('value over average declines to divide by a vanishing baseline', () => {
  // Per-play EPA sits near zero and can cross it; a percentage against that
  // denominator is noise dressed as a number.
  assert.equal(valueOverAverage(0.1, 0), null);
  assert.equal(valueOverAverage(0.1, -0.02), null);
  assert.equal(valueOverAverage(0.1, 1e-9), null);
});

// ---------------------------------------------------------------------------
// Blending per-season fits into current form
// ---------------------------------------------------------------------------

test('an empty newest season leaves last year carrying the estimate', () => {
  // The preseason case. There are no plays in the coming year, so the newest
  // season must contribute nothing rather than dragging the estimate toward a
  // zero it has no evidence for.
  const blended = blendSeasons(
    [
      { season: 2024, value: 0.10, weight: 600 },
      { season: 2025, value: -0.05, weight: 600 },
      { season: 2026, value: 0, weight: 0 },
    ],
    { latestSeason: 2026 },
  );
  // 2025 outweighs 2024 by the decay factor alone, since samples are equal.
  const expected = (0.1 * 600 * SEASON_DECAY ** 2 + -0.05 * 600 * SEASON_DECAY) /
    (600 * SEASON_DECAY ** 2 + 600 * SEASON_DECAY);
  assert.ok(Math.abs(blended - expected) < 1e-12, `${blended} vs ${expected}`);
  // And it must sit nearer last season than the year before it.
  assert.ok(Math.abs(blended - -0.05) < Math.abs(blended - 0.1));
});

test('a season in progress takes over as it accrues plays', () => {
  const prior = [{ season: 2025, value: -0.05, weight: 600 }];
  const week3 = blendSeasons([...prior, { season: 2026, value: 0.2, weight: 120 }], { latestSeason: 2026 });
  const week17 = blendSeasons([...prior, { season: 2026, value: 0.2, weight: 600 }], { latestSeason: 2026 });

  // Both move toward the new season, but December should have moved much further.
  assert.ok(week3 > -0.05 && week3 < week17, `week3 ${week3}, week17 ${week17}`);
  assert.ok(week17 > 0.1, `late season barely moved: ${week17}`);
});

test('recency decay makes a stale season count for less than a current one', () => {
  // Same sample size, opposite values, three years apart: the recent one wins.
  const blended = blendSeasons(
    [
      { season: 2023, value: 1, weight: 500 },
      { season: 2025, value: -1, weight: 500 },
    ],
    { latestSeason: 2025 },
  );
  assert.ok(blended < 0, `stale season dominated: ${blended}`);
});

test('sample size still counts, so a thin recent season cannot run away with it', () => {
  const blended = blendSeasons(
    [
      { season: 2024, value: 0, weight: 1000 },
      { season: 2025, value: 1, weight: 20 },
    ],
    { latestSeason: 2025 },
  );
  assert.ok(blended < 0.1, `twenty plays moved it to ${blended}`);
});

test('a team with no plays anywhere is unknown rather than average', () => {
  // Returning 0 here would read as "exactly league average", which is a claim
  // the data does not support.
  assert.equal(blendSeasons([]), null);
  assert.equal(blendSeasons([{ season: 2025, value: 0.2, weight: 0 }]), null);
});

test('a season newer than the reference is not given a bonus', () => {
  const a = blendSeasons([{ season: 2026, value: 0.3, weight: 100 }], { latestSeason: 2025 });
  assert.ok(Math.abs(a - 0.3) < 1e-12);
});
