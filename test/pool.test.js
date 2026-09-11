import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHAPTERS, LEVELS } from '../src/levels.js';
import { GENERATED_LEVELS, GENERATED_ROUTES } from '../src/generated-levels.js';
import { createRuntime } from './helpers/runtime.js';

const HANDCRAFTED = 20;
const authored = JSON.parse(fs.readFileSync(new URL('./fixtures/level-routes.json', import.meta.url), 'utf8'));

test('the campaign is one list of 99 levels', () => {
  assert.equal(LEVELS.length, 99);
  assert.equal(HANDCRAFTED + GENERATED_LEVELS.length, LEVELS.length);
  assert.equal(CHAPTERS.reduce((sum, chapter) => sum + chapter.size, 0), LEVELS.length, 'chapter sizes must tile the list');
  assert.equal(new Set(LEVELS.map(level => level.id)).size, LEVELS.length, 'level ids must be unique');
});

test('the generated tail ships a verified route for every level', () => {
  assert.equal(GENERATED_ROUTES.length, GENERATED_LEVELS.length);
  for (const level of GENERATED_LEVELS) {
    assert.ok(level.parMoves > 0, `${level.id} must carry a measured par`);
    assert.ok(level.enemies.length > 0 && level.chips.length > 0, `${level.id} must have objectives`);
    assert.ok(Number.isFinite(level.difficultyTier), `${level.id} must carry a difficulty tier`);
  }
});

test('the tail builds on every mechanic the opening taught rather than repeating one enemy', () => {
  const tail = GENERATED_LEVELS.map(level => level.enemies.map(enemy => enemy[0])).flat();
  for (const type of ['hunter', 'turret', 'armored']) {
    assert.ok(tail.includes(type), `the generated tail never uses ${type}`);
  }
});

test('pressure keeps climbing across the tail instead of resetting', () => {
  const tiers = GENERATED_LEVELS.map(level => level.difficultyTier);
  assert.ok(tiers[0] >= 18, `the tail must start where the hand-authored climax ended, got ${tiers[0]}`);
  assert.ok(tiers[tiers.length - 1] > tiers[0] + 15, 'the tail must end substantially harder than it starts');
  for (let i = 1; i < tiers.length; i += 1) assert.ok(tiers[i] >= tiers[i - 1], `tier dipped at index ${i}`);
});

test('every campaign level clears without damage through the real game loop', () => {
  const game = createRuntime();
  for (const [index, level] of LEVELS.entries()) {
    const route = index < HANDCRAFTED ? authored[index].route : GENERATED_ROUTES[index - HANDCRAFTED];
    assert.ok(route, `${level.id} has no route to replay`);
    game.startLevelData(level);
    for (const [x, y] of route) { game.touch(x, y, .7); game.step(.08); }
    assert.equal(game.state.mode, 'floorClear', `${level.id} must clear`);
    assert.equal(game.state.floorHits, 0, `${level.id} must be damage-free`);
    assert.ok(game.state.floorMoves <= level.parMoves, `${level.id} must fit inside its par`);
    assert.equal(JSON.parse(game.renderGameToText()).collision.playerOverlapsWall, false, `${level.id} must not end inside a wall`);
  }
});

test('the tail is harder to route blindly than to walk', () => {
  // A level where "always aim at the nearest objective" works is not a puzzle, it is a corridor.
  // The generator lets walls cut the intended line precisely so this stops being true for a good
  // share of the tail. Both failure modes count: the greedy hop is blocked by a wall, or the
  // player is still standing in the wrong place when something reaches them.
  const game = createRuntime();
  let punishesGreed = 0;
  for (const level of GENERATED_LEVELS) {
    const remaining = [...level.chips.map(([x, y]) => ({ x, y })), ...level.enemies.map(enemy => ({ x: enemy[1], y: enemy[2] })), { x: level.portal[0], y: level.portal[1] }];
    game.startLevelData(level);
    let from = { x: level.start[0], y: level.start[1] };
    let failed = false;
    while (remaining.length) {
      remaining.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
      const next = remaining.shift();
      game.touch(next.x, next.y, .7); game.step(.08);
      if (game.state.mode !== 'playing') { failed = true; break; }
      const landed = game.state.player;
      if (Math.hypot(next.x - landed.x, next.y - landed.y) > 40) { failed = true; break; }
      from = { x: landed.x, y: landed.y };
    }
    if (failed) punishesGreed += 1;
  }
  assert.ok(punishesGreed / GENERATED_LEVELS.length >= 0.25, `only ${punishesGreed}/${GENERATED_LEVELS.length} tail levels punish greedy routing`);
});
