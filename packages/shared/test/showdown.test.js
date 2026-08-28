import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPTAIN_MULTIPLIER,
  SALARY_CAP,
  LOW_SCORING_MAX_PER_TEAM,
  SHOOTOUT_MAX_PER_TEAM,
  buildShowdownSet,
  matchupValue,
  optimizeShowdownShape,
  showdownShapes,
} from '../dist/index.js';

const TEAMS = ['SEA', 'NE'];

/**
 * A pool shaped like the one that produced the bug: one team's receivers are
 * the best grades on the board, so an optimizer with no correlation rules
 * seats four of them.
 */
function pool({ kicker = true, defense = true } = {}) {
  const players = [];
  const add = (team, position, count, { salary, grade, step = -6 }) => {
    for (let i = 0; i < count; i++) {
      const score = grade + i * step;
      players.push({
        id: `${team}-${position}${i}`,
        name: `${team} ${position}${i}`,
        position,
        team,
        gameId: 'G1',
        salary: salary - i * 1200,
        matchupScore: score,
        value: matchupValue(position, score),
      });
    }
  };

  add('SEA', 'QB', 2, { salary: 10000, grade: 68 });
  add('SEA', 'WR', 4, { salary: 10600, grade: 81 });
  add('SEA', 'RB', 3, { salary: 8200, grade: 58 });
  add('SEA', 'TE', 2, { salary: 4600, grade: 52 });
  add('NE', 'QB', 2, { salary: 9600, grade: 66 });
  add('NE', 'WR', 3, { salary: 9400, grade: 70 });
  add('NE', 'RB', 3, { salary: 7600, grade: 60 });
  add('NE', 'TE', 2, { salary: 4200, grade: 48 });
  if (kicker) {
    add('SEA', 'K', 1, { salary: 4200, grade: 55 });
    add('NE', 'K', 1, { salary: 4000, grade: 50 });
  }
  if (defense) {
    add('SEA', 'DST', 1, { salary: 4400, grade: 72 });
    add('NE', 'DST', 1, { salary: 3800, grade: 60 });
  }
  return players;
}

const builds = () => buildShowdownSet(pool(), TEAMS);
const at = (key) => builds().find((b) => b.key === key);
const countBy = (lineup, fn) => lineup.picks.filter(fn).length;

// ---------------------------------------------------------------------------
// The rules every build obeys
// ---------------------------------------------------------------------------

test('four builds come back: one per team, a shootout and a rock fight', () => {
  const set = builds();
  assert.deepEqual(
    set.map((b) => b.key),
    ['lean-SEA', 'lean-NE', 'shootout', 'low-scoring'],
  );
  for (const build of set) assert.ok(build.lineup, `${build.key} produced no lineup`);
});

test('no build seats more than two receivers from one team', () => {
  for (const build of builds()) {
    for (const team of TEAMS) {
      const wrs = countBy(build.lineup, (p) => p.team === team && p.position === 'WR');
      assert.ok(wrs <= 2, `${build.key} seated ${wrs} ${team} receivers`);
    }
  }
});

test('a second receiver only ever comes with his quarterback', () => {
  for (const build of builds()) {
    for (const team of TEAMS) {
      const wrs = countBy(build.lineup, (p) => p.team === team && p.position === 'WR');
      if (wrs < 2) continue;
      const qb = countBy(build.lineup, (p) => p.team === team && p.position === 'QB');
      assert.equal(qb, 1, `${build.key} paired ${team} receivers with no quarterback`);
    }
  }
});

test('no build is forced to spend a seat on a running back', () => {
  // Backs are available, never required: a build that wants one takes one, and
  // a game whose best six hold none is allowed to say so. The rule that would
  // force one is what puts a two-hundred-dollar fullback in a lineup.
  const players = pool().filter((p) => p.position !== 'RB');
  const set = buildShowdownSet(players, TEAMS);
  for (const build of set) {
    assert.ok(build.lineup, `${build.key} could not be built without a running back`);
  }
});

test('every build is six legal seats under the cap, from both sides', () => {
  for (const build of builds()) {
    const { lineup } = build;
    assert.equal(lineup.picks.length, 6);
    assert.equal(new Set(lineup.picks.map((p) => p.id)).size, 6);
    assert.equal(new Set(lineup.picks.map((p) => p.team)).size, 2);
    assert.ok(lineup.salary <= SALARY_CAP, `${build.key} spent ${lineup.salary}`);
    assert.equal(lineup.picks[0].slot, 'CPT');
    assert.equal(lineup.picks[0].multiplier, CAPTAIN_MULTIPLIER);
    assert.equal(lineup.picks[0].cost, Math.round(lineup.picks[0].salary * CAPTAIN_MULTIPLIER));
  }
});

// ---------------------------------------------------------------------------
// What makes each build itself
// ---------------------------------------------------------------------------

test('a lean build captains the team it is betting on and rosters its quarterback', () => {
  for (const team of TEAMS) {
    const { lineup } = at(`lean-${team}`);
    assert.equal(lineup.picks[0].team, team);
    assert.ok(lineup.picks.some((p) => p.position === 'QB' && p.team === team));
  }
});

test('a lean build spends nothing on the kicker or the defense', () => {
  for (const team of TEAMS) {
    const { lineup } = at(`lean-${team}`);
    assert.equal(countBy(lineup, (p) => p.position === 'K' || p.position === 'DST'), 0);
  }
});

test('a lean build brings one receiver back, not a second stack', () => {
  for (const [team, other] of [['SEA', 'NE'], ['NE', 'SEA']]) {
    const { lineup } = at(`lean-${team}`);
    const back = countBy(lineup, (p) => p.team === other && p.position === 'WR');
    assert.ok(back <= 1, `lean-${team} seated ${back} ${other} receivers`);
  }
});

test('the slow build takes a kicker or a defense, and no quarterback', () => {
  const { lineup } = at('low-scoring');
  assert.ok(lineup.picks.some((p) => p.position === 'K' || p.position === 'DST'));
  assert.equal(countBy(lineup, (p) => p.position === 'QB'), 0);
});

test('the slow build never captains a receiver', () => {
  const { lineup } = at('low-scoring');
  assert.ok(['RB', 'TE', 'K', 'DST'].includes(lineup.picks[0].position));
});

test('the slow build splits evenly rather than leaning', () => {
  const { lineup } = at('low-scoring');
  for (const team of TEAMS) {
    assert.ok(countBy(lineup, (p) => p.team === team) <= LOW_SCORING_MAX_PER_TEAM);
  }
});

test('the shootout build rosters both quarterbacks and no kicker or defense', () => {
  const { lineup } = at('shootout');
  for (const team of TEAMS) {
    assert.ok(
      lineup.picks.some((p) => p.position === 'QB' && p.team === team),
      `no ${team} quarterback in the shootout build`,
    );
    assert.ok(countBy(lineup, (p) => p.team === team) <= SHOOTOUT_MAX_PER_TEAM);
  }
  assert.equal(countBy(lineup, (p) => p.position === 'K' || p.position === 'DST'), 0);
});

test('the low-scoring build reports itself unbuildable when nothing kicks or defends', () => {
  const set = buildShowdownSet(pool({ kicker: false, defense: false }), TEAMS);
  const slow = set.find((b) => b.key === 'low-scoring');
  assert.equal(slow.lineup, null);
  assert.match(slow.problem, /kicker or defense/);
  // The other two are unaffected, and are still returned.
  assert.ok(set.filter((b) => b.team).every((b) => b.lineup));
});

test('the four builds are actually different lineups', () => {
  const rosters = builds().map((b) => b.lineup.picks.map((p) => p.id).sort().join(','));
  assert.equal(new Set(rosters).size, 4);
});

// ---------------------------------------------------------------------------
// Locks and excludes
// ---------------------------------------------------------------------------

test('an excluded player never appears in any build', () => {
  const dropped = 'SEA-WR0';
  for (const build of buildShowdownSet(pool(), TEAMS, { excludes: [dropped] })) {
    assert.ok(!build.lineup.picks.some((p) => p.id === dropped));
  }
});

test('a locked player is seated in every build that can hold him', () => {
  const locked = 'NE-RB0';
  for (const build of buildShowdownSet(pool(), TEAMS, { locks: [locked] })) {
    if (!build.lineup) continue;
    assert.ok(
      build.lineup.picks.some((p) => p.id === locked),
      `${build.key} dropped the locked player`,
    );
  }
});

test('a lock that contradicts a build reports rather than quietly ignoring it', () => {
  // A kicker cannot be in a lean build at all, since those bar the position.
  const set = buildShowdownSet(pool(), TEAMS, { locks: ['SEA-K0'] });
  const lean = set.find((b) => b.key === 'lean-SEA');
  assert.equal(lean.lineup, null);
  assert.ok(set.find((b) => b.key === 'low-scoring').lineup);
});

// ---------------------------------------------------------------------------
// Optimality, against a brute force that knows the rules independently
// ---------------------------------------------------------------------------

function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomPool(seed, size) {
  const rand = rng(seed);
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
  const players = [];
  for (let i = 0; i < size; i++) {
    const position = positions[i % positions.length];
    const grade = Math.round(rand() * 100);
    players.push({
      id: `p${i}`,
      name: `Player ${i}`,
      position,
      team: i % 2 === 0 ? 'SEA' : 'NE',
      gameId: 'G1',
      salary: 2000 + Math.floor(rand() * 60) * 100,
      matchupScore: grade,
      value: matchupValue(position, grade),
    });
  }
  return players;
}

/**
 * The rules again, written out longhand.
 *
 * Deliberately a second implementation rather than a call into the engine: a
 * check that agrees with the thing it is checking proves only that the code
 * runs.
 */
function legal(shape, roster, captain) {
  const teams = new Set(roster.map((p) => p.team));
  if (teams.size < 2) return false;
  if (roster.reduce((acc, p) => acc + (p === captain ? Math.round(p.salary * 1.5) : p.salary), 0) > SALARY_CAP) {
    return false;
  }
  for (const team of TEAMS) {
    const wr = roster.filter((p) => p.team === team && p.position === 'WR').length;
    const qb = roster.some((p) => p.team === team && p.position === 'QB');
    if (wr > 2) return false;
    if (wr >= 2 && !qb) return false;
    if (roster.filter((p) => p.team === team).length > (shape.rules.maxPerTeam ?? 5)) return false;
    const cap = shape.rules.wrCapByTeam?.[team];
    if (cap != null && wr > cap) return false;
  }
  for (const barred of shape.rules.bar ?? []) {
    if (roster.some((p) => p.position === barred)) return false;
  }
  if (shape.rules.captainTeam && captain.team !== shape.rules.captainTeam) return false;
  if (shape.rules.captainPositions && !shape.rules.captainPositions.includes(captain.position)) {
    return false;
  }
  for (const team of shape.rules.requireQbTeams ?? []) {
    if (!roster.some((p) => p.position === 'QB' && p.team === team)) return false;
  }
  if (shape.rules.requireOneOf) {
    if (!roster.some((p) => shape.rules.requireOneOf.includes(p.position))) return false;
  }
  return true;
}

/** Every legal roster of this shape, scored. Only tractable for a tiny pool. */
function bruteForce(shape, players) {
  let best = null;
  const choose = (start, roster) => {
    if (roster.length === 6) {
      for (const captain of roster) {
        if (!legal(shape, roster, captain)) continue;
        const value = roster.reduce(
          (acc, p) => acc + (p === captain ? p.value * 1.5 : p.value),
          0,
        );
        if (best == null || value > best) best = value;
      }
      return;
    }
    for (let i = start; i < players.length; i++) choose(i + 1, [...roster, players[i]]);
  };
  choose(0, []);
  return best;
}

test('each build is the true optimum of its own rules, checked against brute force', () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
    const players = randomPool(seed, 13);
    for (const shape of showdownShapes(TEAMS)) {
      const lineup = optimizeShowdownShape(players, shape);
      const best = bruteForce(shape, players);
      if (best == null) {
        assert.equal(lineup, null, `seed ${seed} ${shape.key}: built an illegal lineup`);
        continue;
      }
      assert.ok(lineup, `seed ${seed} ${shape.key}: found nothing, brute force found ${best}`);
      assert.equal(
        Math.round(lineup.value * 1e6) / 1e6,
        Math.round(best * 1e6) / 1e6,
        `seed ${seed} ${shape.key}`,
      );
    }
  }
});

test('a build values exactly what it seated', () => {
  for (const build of builds()) {
    const summed = build.lineup.picks.reduce((acc, p) => acc + p.weight, 0);
    assert.equal(Math.round(build.lineup.value * 1e6), Math.round(summed * 1e6));
    assert.equal(
      build.lineup.salary,
      build.lineup.picks.reduce((acc, p) => acc + p.cost, 0),
    );
  }
});

test('a one-sided pool has no legal showdown lineup', () => {
  const set = buildShowdownSet(
    pool().filter((p) => p.team === 'SEA'),
    TEAMS,
  );
  assert.ok(set.every((b) => b.lineup == null));
});
