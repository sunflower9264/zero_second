import test from 'node:test';
import assert from 'node:assert/strict';
import { bestSingleLevelScore, calculateStars, createDefaultProgress, isRecordBetter, sanitizeProgress, totalStars } from '../src/progress.js';

test('rating uses only moves and damage', () => {
  assert.equal(calculateStars(5, 5, 0), 3);
  assert.equal(calculateStars(5, 6, 0), 2);
  assert.equal(calculateStars(5, 5, 1), 2);
  assert.equal(calculateStars(5, 6, 1), 1);
});

test('records prefer stars, then hits, then moves', () => {
  assert.equal(isRecordBetter({ stars: 3, hits: 2, moves: 9 }, { stars: 2, hits: 0, moves: 4 }), true);
  assert.equal(isRecordBetter({ stars: 2, hits: 0, moves: 8 }, { stars: 2, hits: 1, moves: 5 }), true);
  assert.equal(isRecordBetter({ stars: 2, hits: 0, moves: 6 }, { stars: 2, hits: 0, moves: 7 }), true);
  assert.equal(isRecordBetter({ stars: 2, hits: 1, moves: 6 }, { stars: 3, hits: 2, moves: 10 }), false);
});

test('progress sanitization clamps values and ignores unknown levels', () => {
  const result = sanitizeProgress({ version: 2, unlockedThrough: 99, levels: { f01: { stars: 9, moves: -2, hits: '1' }, nope: { stars: 3 } } }, ['f01', 'f02']);
  assert.equal(result.version, 2);
  assert.equal(result.unlockedThrough, 2);
  assert.deepEqual(result.levels, { f01: { stars: 3, moves: 0, hits: 1, bestScore: 0 } });
});

test('a current save round-trips and every absent field is defaulted', () => {
  const parsed = sanitizeProgress({ version: 2, unlockedThrough: 3, levels: { f01: { stars: 2, moves: 5, hits: 1 } } }, ['f01', 'f02', 'f03']);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.unlockedThrough, 3);
  assert.deepEqual(parsed.levels.f01, { stars: 2, moves: 5, hits: 1, bestScore: 0 });
  assert.deepEqual(parsed.daily, { last: '', streak: 0, bestStreak: 0, entries: {} });
  assert.deepEqual(parsed.endless, { bestFloor: 0, bestScore: 0, runs: 0 });
  assert.deepEqual(sanitizeProgress(parsed, ['f01', 'f02', 'f03']), parsed, 'sanitizing twice must be a no-op');
});

test('a save from any other schema generation is discarded', () => {
  assert.deepEqual(sanitizeProgress({ version: 1 }, ['f01']), createDefaultProgress());
  assert.deepEqual(sanitizeProgress({ version: 99 }, ['f01']), createDefaultProgress());
  assert.deepEqual(sanitizeProgress(null, ['f01']), createDefaultProgress());
});

test('daily entries are capped and malformed values are clamped', () => {
  const entries = {};
  for (let day = 1; day <= 90; day += 1) entries[`2026-01-${String(day).padStart(2, '0')}`] = { stars: 9, moves: 4, hits: 0, bestScore: 100 };
  const result = sanitizeProgress({ version: 2, unlockedThrough: 1, levels: {}, daily: { last: 'nope', streak: -5, bestStreak: 3, entries } }, ['f01']);
  assert.equal(Object.keys(result.daily.entries).length, 60);
  assert.equal(result.daily.entries['2026-01-90'].stars, 3);
  assert.equal(result.daily.entries['2026-01-01'], undefined);
  assert.equal(result.daily.last, '');
  assert.equal(result.daily.streak, 0);
  assert.equal(result.daily.bestStreak, 3);
});

test('best single level score and total stars read across levels', () => {
  const progress = { levels: { f01: { stars: 3, bestScore: 1200 }, f02: { stars: 2, bestScore: 3400 }, f03: { stars: 1 } } };
  assert.equal(bestSingleLevelScore(progress), 3400);
  assert.equal(totalStars(progress), 6);
  assert.equal(bestSingleLevelScore({ levels: {} }), 0);
  assert.equal(totalStars({ levels: {} }), 0);
});
