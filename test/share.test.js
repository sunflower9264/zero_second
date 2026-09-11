import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText, shareOrCopy } from '../src/share.js';

test('share text describes the run without carrying anything identifying', () => {
  const text = buildShareText({ levelName: '静默直线', stars: 3, moves: 4, par: 4, hits: 0, maxCombo: 2, seconds: 12.34, score: 1970 });
  assert.match(text, /《零秒特工》静默直线/);
  assert.match(text, /★★★/);
  assert.match(text, /4\/4 步/);
  assert.match(text, /无伤/);
  assert.match(text, /连击 2×/);
  assert.match(text, /12\.3 秒/);
  assert.match(text, /得分 1970/);
});

test('share text flags a run that took damage', () => {
  const text = buildShareText({ levelName: 'x', stars: 1, moves: 9, par: 4, hits: 2, maxCombo: 0, seconds: 3, score: 10 });
  assert.match(text, /★☆☆/);
  assert.ok(!text.includes('无伤'));
});

test('share prefers the native sheet, then the clipboard, then a manual hint', async () => {
  const shared = [];
  assert.equal(await shareOrCopy({ text: 'hi', nav: { share: async payload => shared.push(payload) } }), 'shared');
  assert.deepEqual(shared, [{ text: 'hi' }]);
  const copied = [];
  assert.equal(await shareOrCopy({ text: 'hi', nav: { clipboard: { writeText: async value => copied.push(value) } } }), 'copied');
  assert.deepEqual(copied, ['hi']);
  assert.equal(await shareOrCopy({ text: 'hi', nav: {} }), 'manual');
});

test('cancelling the share sheet does not dump the text into the clipboard', async () => {
  const copied = [];
  const nav = {
    share: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; },
    clipboard: { writeText: async value => copied.push(value) },
  };
  assert.equal(await shareOrCopy({ text: 'hi', nav }), 'cancelled');
  assert.deepEqual(copied, [], 'a deliberate cancel must not silently copy');
});

test('the clipboard is used when the share sheet fails for any other reason', async () => {
  const copied = [];
  const nav = {
    share: async () => { throw new Error('not allowed'); },
    clipboard: { writeText: async value => copied.push(value) },
  };
  assert.equal(await shareOrCopy({ text: 'hi', nav }), 'copied');
  assert.deepEqual(copied, ['hi']);
});

test('a file is only attached when the platform reports it can share files', async () => {
  const payloads = [];
  const file = { name: 'a.png' };
  const record = async payload => payloads.push(payload);
  await shareOrCopy({ text: 't', file, nav: { share: record, canShare: () => true } });
  await shareOrCopy({ text: 't', file, nav: { share: record, canShare: () => false } });
  await shareOrCopy({ text: 't', file, nav: { share: record } });
  assert.deepEqual(payloads[0], { files: [file], text: 't' });
  assert.deepEqual(payloads[1], { text: 't' });
  assert.deepEqual(payloads[2], { text: 't' });
});
