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
  const result = sanitizeProgress({ version: 2, levels: { f01: { stars: 9, moves: -2, hits: '1' }, nope: { stars: 3 } } }, ['f01', 'f02']);
  assert.equal(result.version, 2);
  assert.deepEqual(result.levels, { f01: { stars: 3, moves: 0, hits: 1, bestScore: 0 } });
});

test('a current save round-trips and every absent field is defaulted', () => {
  const parsed = sanitizeProgress({ version: 2, levels: { f01: { stars: 2, moves: 5, hits: 1 } } }, ['f01', 'f02', 'f03']);
  assert.deepEqual(parsed, { version: 2, levels: { f01: { stars: 2, moves: 5, hits: 1, bestScore: 0 } } });
  assert.deepEqual(sanitizeProgress(parsed, ['f01', 'f02', 'f03']), parsed, 'sanitizing twice must be a no-op');
});

test('a leftover unlock gate in an old save is simply ignored', () => {
  const parsed = sanitizeProgress({ version: 2, unlockedThrough: 7, levels: { f01: { stars: 1, moves: 3, hits: 0 } } }, ['f01', 'f02']);
  assert.deepEqual(parsed, { version: 2, levels: { f01: { stars: 1, moves: 3, hits: 0, bestScore: 0 } } });
});

test('a save from any other schema generation is discarded', () => {
  assert.deepEqual(sanitizeProgress({ version: 1 }, ['f01']), createDefaultProgress());
  assert.deepEqual(sanitizeProgress({ version: 99 }, ['f01']), createDefaultProgress());
  assert.deepEqual(sanitizeProgress(null, ['f01']), createDefaultProgress());
});

test('best single level score and total stars read across levels', () => {
  const progress = { levels: { f01: { stars: 3, bestScore: 1200 }, f02: { stars: 2, bestScore: 3400 }, f03: { stars: 1 } } };
  assert.equal(bestSingleLevelScore(progress), 3400);
  assert.equal(totalStars(progress), 6);
  assert.equal(bestSingleLevelScore({ levels: {} }), 0);
  assert.equal(totalStars({ levels: {} }), 0);
});
