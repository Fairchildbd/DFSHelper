import test from 'node:test';
import assert from 'node:assert/strict';

import { CLIMATE_BAR, LEAN_GAP, MIN_LANES_FOR_READ, readGameScript } from '../dist/index.js';

/**
 * Real games, from the 2026 week 1 board.
 *
 * Fixtures rather than invented numbers on purpose: the thresholds were
 * calibrated against these five, so they are the cases that say whether the
 * calibration still holds after anyone moves a constant.
 */
const LANES = ['pass game', 'WRs', 'TEs', 'run game', 'pass-catching backs', 'pass protection'];

const game = (teams, away, home, totalLine, pacePercentile) => ({
  teams,
  totalLine,
  pacePercentile,
  edges: [
    ...away.map((edge, i) => ({ label: `${teams[0]} ${LANES[i]} vs ${teams[1]}`, edge })),
    ...home.map((edge, i) => ({ label: `${teams[1]} ${LANES[i]} vs ${teams[0]}`, edge })),
  ],
});

const WAS_PHI = game(
  ['WAS', 'PHI'],
  [3.0, 1.7, -89.0, -32.6, -52.9, -44.1],
  [65.1, 27.2, 32.0, 74.0, 52.2, 66.0],
  46.5,
  38,
);
const ARI_LAC = game(
  ['ARI', 'LAC'],
  [-66.8, -38.5, 16.1, -54.1, -66.4, -27.6],
  [42.1, 20.7, -14.5, -3.7, 30.3, 68.3],
  46.5,
  40,
);
const TB_CIN = game(
  ['TB', 'CIN'],
  [48.2, 35.8, 35.2, 59.9, 63.0, 56.4],
  [61.3, 72.0, 5.9, 13.1, 13.6, 42.3],
  50.5,
  27,
);
const CLE_JAX = game(
  ['CLE', 'JAX'],
  [-38.2, -58.4, -26.2, -34.8, -54.0, -10.4],
  [-11.7, 21.1, -7.2, -85.3, -89.7, -78.7],
  40.5,
  64,
);
const NE_SEA = game(
  ['NE', 'SEA'],
  [1.8, -3.5, 15.6, -33.7, -40.6, 26.9],
  [-2.8, 42.3, -23.6, -42.7, -50.3, -3.0],
  44.5,
  15,
);

test('a game with a side reads as that side', () => {
  const phi = readGameScript(WAS_PHI);
  assert.equal(phi.scenario, 'lean-PHI');
  assert.equal(phi.team, 'PHI');
  assert.equal(phi.confidence, 'strong');
  assert.match(phi.why, /88-point gap/);

  const lac = readGameScript(ARI_LAC);
  assert.equal(lac.scenario, 'lean-LAC');
  // A 63-point gap is a side, but not the 88 Philadelphia had.
  assert.equal(lac.confidence, 'slight');
});

test('two offenses both positioned well into a high total read as a shootout', () => {
  const read = readGameScript(TB_CIN);
  assert.equal(read.scenario, 'shootout');
  assert.equal(read.team, null);
  assert.match(read.why, /50.5 total/);
});

test('two offenses both positioned badly into a low total read as a rock fight', () => {
  assert.equal(readGameScript(CLE_JAX).scenario, 'low-scoring');
});

test('a neutral total with slow pace and flat lanes still reads low-scoring', () => {
  // NE @ SEA: nobody owns it, the total is exactly league-average, and the two
  // offenses are the slowest pair on the board. The pace is what decides it.
  const read = readGameScript(NE_SEA);
  assert.equal(read.scenario, 'low-scoring');
  assert.match(read.why, /15th percentile/);
});

test('pace and total only tilt a read, they cannot make one', () => {
  // The same flat lanes with nothing else known: no read at all.
  const flat = { ...NE_SEA, totalLine: null, pacePercentile: null };
  assert.equal(readGameScript(flat), null);
});

test('a side that is not graded enough gets no read', () => {
  const thin = {
    ...WAS_PHI,
    edges: WAS_PHI.edges.map((e, i) =>
      e.label.startsWith('PHI') && i % 2 === 0 ? { ...e, edge: null } : e,
    ),
  };
  assert.equal(readGameScript(thin), null);
});

test('the read reports the lane means it decided on', () => {
  const read = readGameScript(WAS_PHI);
  assert.equal(Math.round(read.lanes[0]), -36);
  assert.equal(Math.round(read.lanes[1]), 53);
});

test('the thresholds are the ones the calibration assumed', () => {
  assert.equal(LEAN_GAP, 40);
  assert.equal(CLIMATE_BAR, 15);
  assert.equal(MIN_LANES_FOR_READ, 4);
});
