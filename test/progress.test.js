import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStars, isRecordBetter, sanitizeProgress } from '../src/progress.js';

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

test('progress sanitization clamps and ignores unknown levels', () => {
  const result = sanitizeProgress({ version: 1, unlockedThrough: 99, levels: { f01: { stars: 9, moves: -2, hits: '1' }, nope: { stars: 3 } } }, ['f01', 'f02']);
  assert.deepEqual(result, { version: 1, unlockedThrough: 2, levels: { f01: { stars: 3, moves: 0, hits: 1 } } });
  assert.deepEqual(sanitizeProgress({ version: 2 }, ['f01']), { version: 1, unlockedThrough: 1, levels: {} });
});
