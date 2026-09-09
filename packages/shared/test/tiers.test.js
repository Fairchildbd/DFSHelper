import test from 'node:test';
import assert from 'node:assert/strict';

import { assignTiers } from '../dist/index.js';

function player(id, position, team, salary, extra = {}) {
  return {
    id,
    position,
    team,
    salary,
    posRank: extra.posRank ?? null,
    targetsPerGame: extra.targetsPerGame ?? null,
    touchesPerGame: extra.touchesPerGame ?? null,
    status: extra.status ?? null,
  };
}

function tiers(players) {
  return new Map(assignTiers(players).map((p) => [p.id, p.tier]));
}

test('the expensive slot starters are tier 1', () => {
  const t = tiers([
    player('qb', 'QB', 'NE', 11400, { posRank: 1 }),
    player('wr1', 'WR', 'NE', 9000, { posRank: 1, targetsPerGame: 9 }),
    player('rb1', 'RB', 'NE', 8000, { posRank: 1, touchesPerGame: 17 }),
  ]);
  assert.deepEqual([t.get('qb'), t.get('wr1'), t.get('rb1')], [1, 1, 1]);
});

test('a starter priced under the band falls to tier 2', () => {
  const t = tiers([
    player('qb', 'QB', 'NE', 11400, { posRank: 1 }),
    player('te1', 'TE', 'NE', 4200, { posRank: 1, targetsPerGame: 4 }),
  ]);
  assert.equal(t.get('te1'), 2);
});

test('a cheap receiver with real target share is tier 2, not tier 4', () => {
  const t = tiers([
    player('wr1', 'WR', 'NE', 9000, { posRank: 1, targetsPerGame: 9 }),
    player('wr3', 'WR', 'NE', 3400, { posRank: 2, targetsPerGame: 5 }),
  ]);
  assert.equal(t.get('wr3'), 2);
});

test('a back with touches and no starting slot is tier 2', () => {
  const t = tiers([
    player('rb1', 'RB', 'NE', 8000, { posRank: 1, touchesPerGame: 17 }),
    player('rb2', 'RB', 'NE', 2600, { posRank: 2, touchesPerGame: 7 }),
  ]);
  assert.equal(t.get('rb2'), 2);
});

test('kickers and defenses are tier 3 whatever they cost', () => {
  const t = tiers([
    player('qb', 'QB', 'NE', 11400, { posRank: 1 }),
    player('k', 'K', 'NE', 4600, { posRank: 1 }),
    player('dst', 'DST', 'NE', 4400),
  ]);
  assert.deepEqual([t.get('k'), t.get('dst')], [3, 3]);
});

test('a cheap player with no role is tier 4 rather than a value play', () => {
  const t = tiers([
    player('qb', 'QB', 'SEA', 11000, { posRank: 1 }),
    player('fb', 'RB', 'SEA', 200, { posRank: 2, touchesPerGame: 0.2 }),
  ]);
  assert.equal(t.get('fb'), 4);
});

test('a fullback who leads his own depth ladder is still tier 4', () => {
  const t = tiers([
    player('qb', 'QB', 'SEA', 9400, { posRank: 1 }),
    player('fb', 'RB', 'SEA', 200, { posRank: 1, targetsPerGame: 1, touchesPerGame: 0 }),
  ]);
  assert.equal(t.get('fb'), 4);
});

test('a backup quarterback priced high is tier 5, never tier 1', () => {
  const t = tiers([
    player('starter', 'QB', 'NE', 10000, { posRank: 1 }),
    player('backup', 'QB', 'NE', 8000, { posRank: null }),
  ]);
  assert.deepEqual([t.get('starter'), t.get('backup')], [1, 5]);
});

test('the starting quarterback is tier 2 when he is priced under the band', () => {
  const t = tiers([
    player('wr1', 'WR', 'NE', 12000, { posRank: 1, targetsPerGame: 10 }),
    player('qb', 'QB', 'NE', 5000, { posRank: 1 }),
  ]);
  assert.equal(t.get('qb'), 2);
});

test('the tier 1 band is measured against the player own team', () => {
  const t = tiers([
    player('rich-qb', 'QB', 'NE', 12000, { posRank: 1 }),
    player('rich-wr', 'WR', 'NE', 5000, { posRank: 1, targetsPerGame: 6 }),
    player('poor-qb', 'QB', 'SEA', 7000, { posRank: 1 }),
    player('poor-wr', 'WR', 'SEA', 5000, { posRank: 1, targetsPerGame: 6 }),
  ]);
  assert.equal(t.get('rich-wr'), 2);
  assert.equal(t.get('poor-wr'), 1);
});

test('kickers and defenses do not set the tier 1 band', () => {
  const t = tiers([
    player('dst', 'DST', 'NE', 20000),
    player('qb', 'QB', 'NE', 11400, { posRank: 1 }),
  ]);
  assert.equal(t.get('qb'), 1);
});

test('IR, OUT and PUP are tier 6 whatever the player is worth', () => {
  const t = tiers([
    player('wr1', 'WR', 'NE', 9600, { posRank: 1, targetsPerGame: 9, status: 'OUT' }),
    player('wr2', 'WR', 'NE', 5600, { posRank: 2, targetsPerGame: 6, status: 'IR' }),
    player('te1', 'TE', 'NE', 4800, { posRank: 1, targetsPerGame: 5, status: 'PUP' }),
    player('k', 'K', 'NE', 5000, { status: 'OUT' }),
  ]);
  assert.deepEqual([t.get('wr1'), t.get('wr2'), t.get('te1'), t.get('k')], [6, 6, 6, 6]);
});

test('a questionable player is not sidelined', () => {
  const t = tiers([
    player('qb', 'QB', 'NE', 10000, { posRank: 1 }),
    player('rb', 'RB', 'NE', 7600, { posRank: 2, touchesPerGame: 12, status: 'Q' }),
  ]);
  assert.equal(t.get('rb'), 2);
});

test('a sidelined star does not set the tier 1 band', () => {
  const t = tiers([
    player('hurt', 'WR', 'NE', 20000, { posRank: 1, targetsPerGame: 10, status: 'IR' }),
    player('qb', 'QB', 'NE', 9000, { posRank: 1 }),
  ]);
  assert.deepEqual([t.get('hurt'), t.get('qb')], [6, 1]);
});

test('the backup inherits the job when the starter is out', () => {
  const t = tiers([
    player('starter', 'QB', 'NE', 10000, { posRank: 1, status: 'OUT' }),
    player('heir', 'QB', 'NE', 8000, { posRank: 2 }),
    player('third', 'QB', 'NE', 6000, { posRank: 3 }),
    player('wr1', 'WR', 'NE', 9600, { posRank: 1, targetsPerGame: 9 }),
  ]);
  assert.deepEqual([t.get('starter'), t.get('heir'), t.get('third')], [6, 1, 5]);
});

test('an inherited job that is priced cheaply lands in tier 2', () => {
  const t = tiers([
    player('starter', 'QB', 'SEA', 9400, { posRank: 1, status: 'PUP' }),
    player('heir', 'QB', 'SEA', 3000, { posRank: 2 }),
    player('wr1', 'WR', 'SEA', 10600, { posRank: 1, targetsPerGame: 10 }),
  ]);
  assert.equal(t.get('heir'), 2);
});

test('a healthy starter leaves every backup in tier 5', () => {
  const t = tiers([
    player('starter', 'QB', 'NE', 10000, { posRank: 1 }),
    player('second', 'QB', 'NE', 8000, { posRank: 2 }),
    player('third', 'QB', 'NE', 6000, { posRank: 3 }),
  ]);
  assert.deepEqual([t.get('second'), t.get('third')], [5, 5]);
});

test('a sidelined backup cannot inherit the job', () => {
  const t = tiers([
    player('starter', 'QB', 'NE', 10000, { posRank: 1, status: 'IR' }),
    player('second', 'QB', 'NE', 8000, { posRank: 2, status: 'OUT' }),
    player('third', 'QB', 'NE', 6000, { posRank: 3 }),
  ]);
  assert.deepEqual([t.get('second'), t.get('third')], [6, 1]);
});
