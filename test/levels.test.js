import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEVELS } from '../src/levels.js';
import { createRuntime } from './helpers/runtime.js';

const routes = JSON.parse(fs.readFileSync(new URL('./fixtures/level-routes.json', import.meta.url), 'utf8'));
assert.equal(routes.length, LEVELS.length);
test('tutorials appear only when a level introduces new content or is explicitly marked', () => {
  const seenEnemies = new Set(); const seenItems = new Set(); let seenWalls = false;
  for (const [index, level] of LEVELS.entries()) {
    const hasNewContent = level.enemies.some(([type]) => !seenEnemies.has(type))
      || level.items.some(([type]) => !seenItems.has(type))
      || (level.walls.length > 0 && !seenWalls);
    assert.equal(Boolean(level.brief), index === 0 || hasNewContent || level.tutorial === true, `${level.id} tutorial distribution`);
    level.enemies.forEach(([type]) => seenEnemies.add(type));
    level.items.forEach(([type]) => seenItems.add(type));
    if (level.walls.length > 0) seenWalls = true;
  }
});
test('the dash-refill and wall rules are taught where they first matter', () => {
  const byId = Object.fromEntries(LEVELS.map(level => [level.id, level]));
  assert.match(byId.f02.brief, /刷新冲刺/, 'f02 must teach that kills refill the dash');
  assert.match(byId.f03.brief, /墙/, 'f03 must teach that walls cut a dash short');
});
for (const [index, level] of LEVELS.entries()) {
  test(`${level.id} has a playable no-damage three-star route through the real game loop`, () => {
    const game = createRuntime(); game.startAtLevel(index);
    assert.equal(routes[index].id, level.id);
    for (const [x, y] of routes[index].route) {
      assert.ok(x >= 0 && x <= 720 && y >= 118 && y <= 1210, 'route must use targets reachable by touch');
      game.touch(x, y, .7); game.step(.08);
      assert.equal(JSON.parse(game.renderGameToText()).collision.playerOverlapsWall, false);
    }
    assert.ok(['floorClear', 'victory'].includes(game.state.mode));
    assert.equal(game.state.lastRating.stars, 3);
    assert.equal(game.state.floorHits, 0);
    assert.ok(game.state.floorMoves <= level.parMoves);
  });
}
