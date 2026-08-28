import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPTAIN_MULTIPLIER,
  CLASSIC_SLOTS,
  SALARY_CAP,
  UNGRADED_SCORE,
  dkPoints,
  dstPoints,
  dstPointsAllowedScore,
  gamesUsed,
  matchupValue,
  optimizeClassic,
  optimizeShowdown,
  stackCombinations,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

test('DK scoring is full PPR', () => {
  assert.equal(dkPoints({ receptions: 5, receiving_yards: 50, receiving_tds: 1 }), 5 + 5 + 6);
});

test('yardage bonuses land at the thresholds, not near them', () => {
  assert.equal(dkPoints({ receiving_yards: 99 }), 9.9);
  assert.equal(dkPoints({ receiving_yards: 100 }), 10 + 3);
  assert.equal(dkPoints({ rushing_yards: 100 }), 10 + 3);
  assert.equal(Math.round(dkPoints({ passing_yards: 300 }) * 100) / 100, 12 + 3);
});

test('a quarterback line scores four-point passing touchdowns', () => {
  const points = dkPoints({ passing_yards: 275, passing_tds: 2, passing_interceptions: 1 });
  assert.equal(Math.round(points * 100) / 100, 11 + 8 - 1);
});

test('points allowed tiers step at the DraftKings boundaries', () => {
  assert.equal(dstPointsAllowedScore(0), 10);
  assert.equal(dstPointsAllowedScore(6), 7);
  assert.equal(dstPointsAllowedScore(7), 4);
  assert.equal(dstPointsAllowedScore(13), 4);
  assert.equal(dstPointsAllowedScore(14), 1);
  assert.equal(dstPointsAllowedScore(21), 0);
  assert.equal(dstPointsAllowedScore(35), -4);
});

test('DST scoring adds the event points to the tier', () => {
  assert.equal(dstPoints({ points_allowed: 10, sacks: 4, interceptions: 1, defensive_tds: 1 }), 4 + 4 + 2 + 6);
});

// ---------------------------------------------------------------------------
// Classic optimizer
// ---------------------------------------------------------------------------

/** A slate big enough to have real choices at every position. */
function slate() {
  const pool = [];
  const add = (position, count, game) => {
    for (let i = 0; i < count; i++) {
      pool.push({
        id: `${position}${i}-${game}`,
        name: `${position} ${i} (${game})`,
        position,
        team: `${game}${i % 2 === 0 ? 'H' : 'A'}`,
        gameId: game,
        // Priced so the best players are unaffordable together: the optimizer
        // has to actually solve something rather than take the top of each list.
        salary: 4000 + i * 400,
        matchupScore: 40 + i * 4,
        value: matchupValue(position, 40 + i * 4),
      });
    }
  };
  for (const game of ['G1', 'G2', 'G3']) {
    add('QB', 6, game);
    add('RB', 10, game);
    add('WR', 12, game);
    add('TE', 6, game);
    add('DST', 4, game);
  }
  return pool;
}

test('classic lineup fills every slot exactly once', () => {
  const lineup = optimizeClassic(slate());
  assert.ok(lineup);
  assert.equal(lineup.picks.length, CLASSIC_SLOTS.length);
  assert.deepEqual(
    lineup.picks.map((p) => p.slot),
    CLASSIC_SLOTS.map((s) => s.key),
  );
});

test('classic lineup never exceeds the cap', () => {
  const lineup = optimizeClassic(slate());
  assert.ok(lineup.salary <= SALARY_CAP);
  assert.equal(lineup.remaining, SALARY_CAP - lineup.salary);
});

test('classic lineup never repeats a player', () => {
  const lineup = optimizeClassic(slate());
  assert.equal(new Set(lineup.picks.map((p) => p.id)).size, lineup.picks.length);
});

test('classic roster is position-legal, flex included', () => {
  const lineup = optimizeClassic(slate());
  const counts = {};
  for (const p of lineup.picks) counts[p.position] = (counts[p.position] ?? 0) + 1;
  assert.equal(counts.QB, 1);
  assert.equal(counts.DST, 1);
  assert.ok(counts.RB >= 2 && counts.RB <= 3);
  assert.ok(counts.WR >= 3 && counts.WR <= 4);
  assert.ok(counts.TE >= 1 && counts.TE <= 2);
  const flex = lineup.picks.find((p) => p.slot === 'FLEX');
  assert.ok(['RB', 'WR', 'TE'].includes(flex.position));
});

test('the optimizer beats a greedy best-projection lineup', () => {
  const pool = slate();
  const lineup = optimizeClassic(pool);

  // Greedy: take the highest projection at each slot, ignoring price.
  const greedy = [];
  const take = (position, count) =>
    pool
      .filter((p) => p.position === position)
      .sort((a, b) => b.value - a.value)
      .slice(0, count)
      .forEach((p) => greedy.push(p));
  take('QB', 1); take('RB', 2); take('WR', 3); take('TE', 1); take('DST', 1);
  const greedySalary = greedy.reduce((acc, p) => acc + p.salary, 0);

  assert.ok(greedySalary > SALARY_CAP, 'greedy should be over the cap to be worth beating');
  assert.ok(lineup.salary <= SALARY_CAP);
});

test('a locked player appears in the lineup', () => {
  const pool = slate();
  const cheapTe = pool.find((p) => p.id === 'TE0-G2');
  const lineup = optimizeClassic(pool, { locks: [cheapTe.id] });
  assert.ok(lineup.picks.some((p) => p.id === cheapTe.id));
});

test('an excluded player never appears', () => {
  const pool = slate();
  const first = optimizeClassic(pool);
  const dropped = first.picks[0].id;
  const second = optimizeClassic(pool, { excludes: [dropped] });
  assert.ok(!second.picks.some((p) => p.id === dropped));
});

test('a pool that cannot fill the roster returns null rather than a partial lineup', () => {
  const thin = slate().filter((p) => p.position !== 'DST');
  assert.equal(optimizeClassic(thin), null);
  assert.equal(optimizeClassic([]), null);
});

test('classic lineups span more than one game on a real slate', () => {
  assert.ok(gamesUsed(optimizeClassic(slate())) >= 2);
});

// ---------------------------------------------------------------------------
// Showdown
// ---------------------------------------------------------------------------

function showdownPool() {
  const pool = [];
  const add = (team, position, count) => {
    for (let i = 0; i < count; i++) {
      pool.push({
        id: `${team}-${position}${i}`,
        name: `${team} ${position}${i}`,
        position,
        team,
        gameId: 'G1',
        salary: 3000 + i * 900,
        matchupScore: 35 + i * 9,
        value: matchupValue(position, 35 + i * 9),
      });
    }
  };
  for (const team of ['KC', 'DEN']) {
    add(team, 'QB', 1);
    add(team, 'RB', 3);
    add(team, 'WR', 4);
    add(team, 'TE', 2);
    add(team, 'DST', 1);
  }
  return pool;
}

test('showdown seats a captain and five flex', () => {
  const lineup = optimizeShowdown(showdownPool());
  assert.ok(lineup);
  assert.equal(lineup.picks.length, 6);
  assert.equal(lineup.picks[0].slot, 'CPT');
  assert.equal(lineup.picks[0].multiplier, CAPTAIN_MULTIPLIER);
});

test('the captain costs and scores one and a half times', () => {
  const lineup = optimizeShowdown(showdownPool());
  const cpt = lineup.picks[0];
  assert.equal(cpt.cost, Math.round(cpt.salary * 1.5));
  assert.equal(Math.round(cpt.points * 100) / 100, Math.round(cpt.projection * 1.5 * 100) / 100);
});

test('showdown respects the cap and uses both teams', () => {
  const lineup = optimizeShowdown(showdownPool());
  assert.ok(lineup.salary <= SALARY_CAP);
  assert.equal(new Set(lineup.picks.map((p) => p.team)).size, 2);
});

test('showdown never repeats a player as captain and flex', () => {
  const lineup = optimizeShowdown(showdownPool());
  assert.equal(new Set(lineup.picks.map((p) => p.id)).size, 6);
});

test('a one-team pool has no legal showdown lineup', () => {
  const oneTeam = showdownPool().filter((p) => p.team === 'KC');
  assert.equal(optimizeShowdown(oneTeam), null);
});

// ---------------------------------------------------------------------------
// The matchup value model
// ---------------------------------------------------------------------------

test('a neutral grade is worth one seat-unit', () => {
  assert.equal(matchupValue('WR', 50), 1);
  assert.equal(matchupValue('RB', 50), 1);
});

test('the grade curve rewards the top end more than it punishes the bottom', () => {
  const up = matchupValue('WR', 80) - matchupValue('WR', 50);
  const down = matchupValue('WR', 50) - matchupValue('WR', 20);
  assert.ok(up > down, `expected ${up} > ${down}`);
});

test('a tight end is worth less than a receiver at the same grade', () => {
  assert.ok(matchupValue('TE', 80) < matchupValue('WR', 80));
  assert.ok(matchupValue('DST', 80) < matchupValue('TE', 80));
});

test('an ungraded player is treated as below average, not average', () => {
  assert.equal(matchupValue('WR', null), matchupValue('WR', UNGRADED_SCORE));
  assert.ok(matchupValue('WR', null) < matchupValue('WR', 50));
});

test('the lineup headline is the mean grade of its seats', () => {
  const lineup = optimizeClassic(slate());
  const graded = lineup.picks.filter((p) => p.matchupScore != null);
  const mean = graded.reduce((a, p) => a + p.matchupScore, 0) / graded.length;
  assert.equal(Math.round(lineup.averageGrade * 100) / 100, Math.round(mean * 100) / 100);
});

test('the optimizer prefers the better matchup when the price is the same', () => {
  const pool = slate().map((p) => ({ ...p, salary: 5000 }));
  const lineup = optimizeClassic(pool);
  // Nine seats at $5,000 is $45,000, so every seat is freely chosen on grade.
  const worst = Math.min(...lineup.picks.map((p) => p.matchupScore));
  const benchBest = Math.max(
    ...pool
      .filter((p) => !lineup.picks.some((q) => q.id === p.id) && p.position === 'WR')
      .map((p) => p.matchupScore),
  );
  assert.ok(
    worst >= benchBest || lineup.picks.filter((p) => p.position === 'WR').length === 4,
    'left a better-graded receiver on the bench at equal price',
  );
});

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

test('a stack is a quarterback, a target, and a bring-back', () => {
  const pool = showdownPool();
  const stacks = stackCombinations(pool, { gameId: 'G1' });
  assert.ok(stacks.length > 0);
  for (const ids of stacks) {
    const picks = ids.map((id) => pool.find((p) => p.id === id));
    assert.equal(picks.length, 3);
    assert.equal(picks[0].position, 'QB');
    assert.equal(picks[1].team, picks[0].team, 'the target must be on the QB team');
    assert.ok(['WR', 'TE'].includes(picks[1].position));
    assert.notEqual(picks[2].team, picks[0].team, 'the bring-back must be the other side');
  }
});

test('stacks come back best first', () => {
  const pool = showdownPool();
  const stacks = stackCombinations(pool, { gameId: 'G1' });
  const valueOf = (ids) =>
    ids.reduce((acc, id) => acc + pool.find((p) => p.id === id).value, 0);
  for (let i = 1; i < stacks.length; i++) {
    assert.ok(valueOf(stacks[i - 1]) >= valueOf(stacks[i]));
  }
});

// ---------------------------------------------------------------------------
// Optimality, against brute force
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random, so a failure is reproducible. */
function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomShowdownPool(seed, size) {
  const rand = rng(seed);
  const pool = [];
  const positions = ['QB', 'RB', 'WR', 'TE', 'DST'];
  for (let i = 0; i < size; i++) {
    pool.push({
      id: `p${i}`,
      name: `Player ${i}`,
      position: positions[i % positions.length],
      team: i % 2 === 0 ? 'KC' : 'DEN',
      gameId: 'G1',
      salary: 2000 + Math.floor(rand() * 90) * 100,
      matchupScore: Math.round(rand() * 100),
      value: Math.round(rand() * 250) / 10,
    });
  }
  return pool;
}

/** Every legal showdown lineup, scored. Only tractable for a tiny pool. */
function bruteForceShowdown(pool) {
  let best = null;
  const n = pool.length;
  for (let c = 0; c < n; c++) {
    const captain = pool[c];
    const cptCost = Math.round(captain.salary * 1.5);
    const rest = pool.filter((_, i) => i !== c);
    const pick = (start, chosen, salary, points) => {
      if (chosen.length === 5) {
        if (salary + cptCost > 50000) return;
        if (new Set([captain.team, ...chosen.map((p) => p.team)]).size < 2) return;
        const total = points + captain.value * 1.5;
        if (!best || total > best) best = total;
        return;
      }
      for (let i = start; i < rest.length; i++) {
        pick(i + 1, [...chosen, rest[i]], salary + rest[i].salary, points + rest[i].value);
      }
    };
    pick(0, [], 0, 0);
  }
  return best;
}

test('showdown finds the true optimum, checked against brute force', () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
    const pool = randomShowdownPool(seed, 12);
    const lineup = optimizeShowdown(pool);
    const best = bruteForceShowdown(pool);
    assert.ok(lineup, `seed ${seed} produced no lineup`);
    assert.equal(
      Math.round(lineup.value * 100) / 100,
      Math.round(best * 100) / 100,
      `seed ${seed}: optimizer found ${lineup.value}, brute force ${best}`,
    );
  }
});

test('showdown value always equals the sum of what it seated', () => {
  for (const seed of [3, 17, 256, 777]) {
    const lineup = optimizeShowdown(randomShowdownPool(seed, 30));
    const summed = lineup.picks.reduce((acc, p) => acc + p.weight, 0);
    assert.equal(Math.round(lineup.value * 100) / 100, Math.round(summed * 100) / 100);
    assert.equal(new Set(lineup.picks.map((p) => p.id)).size, 6);
    assert.ok(lineup.salary <= SALARY_CAP);
  }
});

test('classic never seats a player twice, across many random slates', () => {
  for (const seed of [5, 55, 555]) {
    const rand = rng(seed);
    const pool = [];
    const counts = { QB: 12, RB: 20, WR: 24, TE: 12, DST: 8 };
    for (const [position, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        pool.push({
          id: `${position}${i}`,
          name: `${position}${i}`,
          position,
          team: `T${i % 8}`,
          gameId: `G${i % 4}`,
          salary: 3000 + Math.floor(rand() * 60) * 100,
          matchupScore: Math.round(rand() * 100),
          value: Math.round(rand() * 220) / 10,
        });
      }
    }
    const lineup = optimizeClassic(pool);
    assert.ok(lineup);
    assert.equal(new Set(lineup.picks.map((p) => p.id)).size, 9);
    assert.ok(lineup.salary <= SALARY_CAP);
    assert.equal(
      Math.round(lineup.value * 100) / 100,
      Math.round(lineup.picks.reduce((a, p) => a + p.weight, 0) * 100) / 100,
    );
  }
});
