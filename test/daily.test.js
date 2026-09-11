import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, dailyIndex, dayKey, daysSinceEpoch, previousDayKey } from '../src/daily.js';
import { DAILY_LEVELS, DAILY_ROUTES } from '../src/daily-levels.js';
import { createRuntime } from './helpers/runtime.js';

test('the daily calendar uses a fixed UTC+8 boundary', () => {
  assert.equal(dayKey(Date.parse('2026-09-11T00:00:00Z')), '2026-09-11');
  assert.equal(dayKey(Date.parse('2026-09-11T15:59:59Z')), '2026-09-11');
  // 16:00Z is midnight in UTC+8, so it already belongs to the next day.
  assert.equal(dayKey(Date.parse('2026-09-11T16:00:00Z')), '2026-09-12');
  assert.equal(dayKey(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01');
  assert.equal(dayKey(Date.parse('2028-02-28T16:00:00Z')), '2028-02-29', 'leap day must roll over correctly');
});

test('day arithmetic is stable across month and year boundaries', () => {
  assert.equal(daysSinceEpoch('2026-09-12') - daysSinceEpoch('2026-09-11'), 1);
  assert.equal(daysSinceEpoch('2027-01-01') - daysSinceEpoch('2026-12-31'), 1);
  assert.equal(previousDayKey('2026-09-01'), '2026-08-31');
  assert.equal(previousDayKey('2027-01-01'), '2026-12-31');
});

test('the daily index cycles through the pool without going negative', () => {
  assert.equal(dailyIndex('2026-09-11', 90), dailyIndex('2026-09-11', 90));
  assert.notEqual(dailyIndex('2026-09-11', 90), dailyIndex('2026-09-12', 90));
  // 2026-12-10 is exactly 90 days after 2026-09-11, so the rotation must land on the same entry.
  assert.equal(dailyIndex('2026-12-10', 90), dailyIndex('2026-09-11', 90), 'the pool repeats after one full cycle');
  assert.equal(dailyIndex('2026-09-11', 0), 0);
  const index = dailyIndex('2026-09-11', 90);
  assert.ok(index >= 0 && index < 90);
});

test('the generated pool shipped with a route for every level', () => {
  assert.equal(DAILY_LEVELS.length, 90);
  assert.equal(DAILY_ROUTES.length, DAILY_LEVELS.length);
  for (const level of DAILY_LEVELS) {
    assert.ok(level.parMoves > 0, `${level.id} must carry a measured par`);
    assert.ok(level.enemies.length > 0 && level.chips.length > 0, `${level.id} must have objectives`);
    assert.ok(Number.isFinite(level.difficultyTier), `${level.id} must carry a difficulty tier`);
  }
});

test('every generated level clears without damage through the real game loop', () => {
  const game = createRuntime();
  for (const [index, level] of DAILY_LEVELS.entries()) {
    game.startLevelData(level);
    for (const [x, y] of DAILY_ROUTES[index]) { game.touch(x, y, .7); game.step(.08); }
    assert.equal(game.state.mode, 'floorClear', `${level.id} must clear`);
    assert.equal(game.state.floorHits, 0, `${level.id} must be damage-free`);
    assert.ok(game.state.floorMoves <= level.parMoves, `${level.id} must fit inside its par`);
  }
});

test('the same calendar day always serves the same generated level', () => {
  const first = createRuntime();
  const second = createRuntime();
  first.startDaily('2026-09-11');
  second.startDaily('2026-09-11');
  assert.equal(first.state.floor, second.state.floor);
  assert.equal(first.activeLevel().id, second.activeLevel().id);
  second.startDaily('2026-09-12');
  assert.notEqual(first.activeLevel().id, second.activeLevel().id);
});

test('daily clears are recorded with a streak that survives consecutive days', () => {
  const game = createRuntime();
  game.startDaily('2026-09-11'); game.finishFloor();
  assert.equal(game.state.progress.daily.last, '2026-09-11');
  assert.equal(game.state.progress.daily.streak, 1);
  assert.ok(game.state.progress.daily.entries['2026-09-11'].bestScore > 0);
  game.startDaily('2026-09-12'); game.finishFloor();
  assert.equal(game.state.progress.daily.streak, 2);
  assert.equal(game.state.progress.daily.bestStreak, 2);
  game.startDaily('2026-09-15'); game.finishFloor();
  assert.equal(game.state.progress.daily.streak, 1, 'a missed day restarts the streak');
  assert.equal(game.state.progress.daily.bestStreak, 2);
});

test('a daily clear never touches campaign progress', () => {
  const game = createRuntime();
  const before = JSON.stringify(game.state.progress.levels);
  const unlockedBefore = game.state.progress.unlockedThrough;
  game.startDaily('2026-09-11'); game.finishFloor();
  assert.equal(JSON.stringify(game.state.progress.levels), before, 'generated ids must not land in the campaign save');
  assert.equal(game.state.progress.unlockedThrough, unlockedBefore);
});

test('endless mode chains floors and records the run on death', () => {
  const game = createRuntime();
  game.startEndless();
  assert.equal(game.state.runMode, 'endless');
  assert.equal(game.state.endlessIndex, 0);
  game.finishFloor();
  game.continueResult();
  assert.equal(game.state.endlessIndex, 1);
  assert.equal(game.state.mode, 'playing');
  assert.ok(game.state.score > 0, 'the run score carries across floors');
  for (let i = 0; i < 3; i += 1) { game.damagePlayer(0, 0, 'hunter'); game.state.player.invuln = 0; }
  assert.equal(game.state.mode, 'gameOver');
  assert.equal(game.state.progress.endless.runs, 1);
  assert.equal(game.state.progress.endless.bestFloor, 1);
  assert.ok(game.state.progress.endless.bestScore > 0);
});
