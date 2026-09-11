import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_VERSION, createTracker, defaultSend, newSessionId } from '../src/analytics.js';
import { createRuntime } from './helpers/runtime.js';

test('defaultSend never throws and always reports a boolean', () => {
  assert.equal(typeof defaultSend('/api/collect', '{}'), 'boolean');
});

test('session ids differ between draws', () => {
  const first = [0.1, 0.2]; const second = [0.8, 0.9];
  assert.notEqual(newSessionId(() => first.shift() ?? 0.5), newSessionId(() => second.shift() ?? 0.5));
});

test('tracker flushes at the batch threshold and preserves event order', () => {
  const sent = [];
  const tracker = createTracker({ sessionId: 'test', transport: body => { sent.push(JSON.parse(body)); return true; }, flushAt: 3 });
  tracker.track('a', { x: 1 }); tracker.track('b'); tracker.track('c');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].v, ANALYTICS_VERSION);
  assert.equal(sent[0].sid, 'test');
  assert.deepEqual(sent[0].events.map(event => event.n), ['a', 'b', 'c']);
  assert.equal(sent[0].events[0].p.x, 1);
  assert.equal(tracker.pending(), 0);
});

test('a throwing transport never escapes and is counted as dropped', () => {
  const tracker = createTracker({ sessionId: 'test', transport: () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => tracker.track('level_start'));
  assert.equal(tracker.flush(), false);
  assert.equal(tracker.dropped().failed, 1);
  assert.equal(tracker.pending(), 0);
});

test('a full queue drops the oldest events instead of growing without bound', () => {
  const tracker = createTracker({ sessionId: 'test', transport: () => true, capacity: 3, flushAt: 99 });
  for (let i = 0; i < 6; i += 1) tracker.track(`e${i}`);
  assert.equal(tracker.pending(), 3);
  assert.equal(tracker.dropped().overflow, 3);
});

test('disabling collection stops new events and clears the queue', () => {
  const tracker = createTracker({ sessionId: 'test', transport: () => true });
  tracker.track('a');
  tracker.setEnabled(false);
  assert.equal(tracker.pending(), 0);
  assert.equal(tracker.track('b'), false);
});

test('clearing a level emits session_start, level_start, first_dash and a scored level_end', () => {
  const game = createRuntime();
  game.startAtLevel(0);
  assert.deepEqual(game.events(), [], 'events are batched and only sent at an explicit flush point');
  for (const [x, y] of [[360, 620], [360, 380], [360, 170], [360, 170]]) { game.touch(x, y, .7); game.step(.08); }
  assert.equal(game.state.mode, 'floorClear');
  assert.deepEqual(game.events(), ['session_start', 'level_start', 'first_dash', 'level_end']);
  const clear = game.eventsNamed('level_end')[0];
  assert.equal(clear.p.outcome, 'clear');
  assert.equal(clear.p.levelId, 'f01');
  assert.equal(clear.p.stars, 3);
  assert.equal(clear.p.moves, 4);
});

test('a death reports its cause and the remaining objective state', () => {
  const game = createRuntime();
  game.startAtLevel(0);
  for (let i = 0; i < 3; i += 1) { game.damagePlayer(0, 0, 'hunter'); game.state.player.invuln = 0; }
  assert.equal(game.state.mode, 'gameOver');
  const death = game.eventsNamed('death')[0];
  assert.equal(death.p.cause, 'hunter');
  assert.equal(death.p.tally.hunter, 3);
  assert.equal(death.p.guardsLeft, 2);
  assert.equal(death.p.dataLeft, 1);
  assert.equal(game.eventsNamed('level_end')[0].p.outcome, 'gameOver');
});

test('telemetry survives blocked storage', () => {
  const game = createRuntime({ storageBlocked: true });
  game.startAtLevel(0); game.finishFloor();
  assert.equal(game.state.mode, 'floorClear');
  assert.ok(game.events().includes('level_start'), 'the level event still reaches the sink with storage blocked');
});
