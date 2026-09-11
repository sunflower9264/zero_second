import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './helpers/runtime.js';

test('mission waits for the first touch without moving enemies or firing', () => {
  const game = createRuntime(); game.startAtLevel(18);
  const before = JSON.stringify(game.state.enemies);
  game.step(10);
  assert.equal(JSON.stringify(game.state.enemies), before);
  assert.equal(game.state.hp, 3);
  assert.equal(game.state.bullets.length, 0);
  game.touch(120, 1000);
  assert.equal(game.state.floorMoves, 1);
});

test('touch released during cooldown executes once ready; pause cancels it', () => {
  const game = createRuntime(); game.startAtLevel(0);
  game.touch(140, 1100); game.touch(140, 880, .02); game.step(.7);
  assert.equal(game.state.floorMoves, 2);
  game.touch(140, 660, .02); game.pauseGame(true); game.step(1); game.pauseGame(false); game.step(.7);
  assert.equal(game.state.floorMoves, 2);
});

test('blocked local storage does not prevent startup or level completion', () => {
  const game = createRuntime({ storageBlocked: true }); game.startAtLevel(0);
  game.finishFloor();
  assert.equal(game.state.mode, 'floorClear');
});

test('existing records receive the stars earned under rebalanced move targets', () => {
  const game = createRuntime({ savedProgress: { version: 2, levels: { f09: { stars: 2, moves: 6, hits: 0 } } } });
  assert.equal(game.state.progress.levels.f09.stars, 3);
  assert.equal(game.state.progress.levels.f09.moves, 6);
});

test('armored preview predicts the actual recoil landing and preserves health', () => {
  const game = createRuntime(); game.startAtLevel(11);
  game.state.player.x = 250; game.state.player.y = 1050;
  game.state.ready = false;
  const plan = game.planDash(260, 850);
  assert.equal(plan.hits[0].type, 'armored');
  game.dashToward(260, 850);
  assert.equal(game.state.enemies[0].hp, 1);
  assert.ok(Math.hypot(game.state.player.x - plan.landing.x, game.state.player.y - plan.landing.y) < .01);
  game.step(.64);
  assert.equal(game.state.hp, 3);
});

test('turret announces a locked direction and EMP cancels its pending shot', () => {
  const game = createRuntime(); game.startAtLevel(4); game.state.ready = false;
  game.step(.52);
  const turret = game.state.enemies[0];
  assert.ok(turret.lockedAim);
  const target = { ...turret.lockedAim };
  game.state.player.x = 620; game.state.player.y = 1100;
  game.step(.45);
  const bullet = game.state.bullets[0];
  assert.ok(bullet);
  assert.ok(Math.abs(bullet.vx / bullet.vy - (target.x - turret.x) / (target.y - turret.y)) < .001);
  game.collectItem({ type: 'jammer', x: 620, y: 1100 });
  assert.equal(game.state.bullets.length, 0);
  assert.equal(turret.lockedAim, null);
  assert.ok(turret.fire > 1.6);
});

test('touch cancellation, secondary fingers and mouse do not cause unintended moves', () => {
  const game = createRuntime(); game.startAtLevel(0);
  game.onPointerDown({ pointerType: 'mouse', pointerId: 1, clientX: 360, clientY: 860 });
  assert.equal(game.state.aiming, false);
  const touch = { pointerType: 'touch', pointerId: 2, clientX: 360, clientY: 860 };
  game.onPointerDown(touch);
  game.onPointerUp({ ...touch, pointerId: 3 });
  assert.equal(game.state.aiming, true);
  game.cancelPointer(touch); game.onPointerUp(touch); game.step(1);
  assert.equal(game.state.floorMoves, 0);
});

test('shield absorbs one hit; healing never erases the no-damage requirement', () => {
  const game = createRuntime(); game.startAtLevel(4);
  game.collectItem({ type: 'shield', x: 620, y: 1030 });
  game.damagePlayer(100, 1100);
  assert.equal(game.state.hp, 3); assert.equal(game.state.armor, 0); assert.equal(game.state.floorHits, 0);
  game.state.player.invuln = 0; game.damagePlayer(100, 1100);
  game.collectItem({ type: 'medkit', x: 620, y: 1030 });
  assert.equal(game.state.hp, 3); assert.equal(game.state.floorHits, 1);
});

test('a shield absorbed hit is not tallied as a death cause', () => {
  const game = createRuntime(); game.startAtLevel(4);
  game.collectItem({ type: 'shield', x: 620, y: 1030 });
  game.damagePlayer(100, 1100, 'turret');
  assert.equal(Object.keys(game.state.damageTally).length, 0);
});

test('contact damage records which enemy type caused it', () => {
  const game = createRuntime(); game.startAtLevel(0); game.state.ready = false;
  game.state.enemies[0].x = game.state.player.x; game.state.enemies[0].y = game.state.player.y;
  game.step(.05);
  assert.equal(game.state.damageTally.hunter, 1);
});

test('planDash flags a dash pressed straight into a wall as jammed', () => {
  const game = createRuntime(); game.startAtLevel(2); game.state.ready = false;
  game.state.player.x = 600; game.state.player.y = 596;
  assert.equal(game.planDash(600, 500).jammed, true);
  game.state.player.y = 700;
  assert.equal(game.planDash(600, 500).jammed, false);
});

test('a jammed dash costs no move but still gives feedback', () => {
  const game = createRuntime(); game.startAtLevel(0); game.state.ready = false;
  game.state.player.x = 360; game.state.player.y = 1191;
  game.dashToward(360, 1270);
  assert.equal(game.state.floorMoves, 0);
  assert.equal(game.state.dashCooldown, 0);
  assert.ok(game.state.trauma > 0, 'a jammed dash must shake so the player sees something happened');
  assert.equal(game.eventsNamed('first_dash').length, 0, 'a jammed dash is not a first dash');
});
