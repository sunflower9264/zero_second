import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEVELS } from '../src/levels.js';

const routes = JSON.parse(fs.readFileSync(new URL('./fixtures/level-routes.json', import.meta.url), 'utf8'));

test('the hand-authored opening keeps its verified route fixtures', () => {
  assert.equal(routes.length, 20);
  assert.deepEqual(routes.map(entry => entry.id), LEVELS.slice(0, 20).map(level => level.id));
});

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

test('the opening teaches one thing at a time', () => {
  const byId = Object.fromEntries(LEVELS.map(level => [level.id, level]));
  assert.equal(byId.f01.chips.length, 0, 'f01 must teach only aiming and dashing, not collection');
  assert.ok(!/数据/.test(byId.f01.brief), 'f01 must not mention data collection');
  assert.match(byId.f02.brief, /数据/, 'f02 introduces data collection');
  assert.match(byId.f03.brief, /墙/, 'f03 teaches that walls cut a dash short');
  // The dash-refill rule is deliberately absent from every briefing: it is meant to be discovered
  // by playing, not read off a label.
  assert.ok(!LEVELS.some(level => /刷新冲刺/.test(level.brief || '')), 'the refill rule must not be spelled out in text');
});

test('difficulty tier follows the authored sawtooth, not the level index', () => {
  // F05 and F09 open chapters and are authored easier than the level before them. An index-derived
  // tier silently handed those two teaching levels the fastest enemies in the game.
  assert.ok(LEVELS[4].difficulty < LEVELS[3].difficulty, 'f05 must be authored easier than f04');
  assert.ok(LEVELS[8].difficulty < LEVELS[7].difficulty, 'f09 must be authored easier than f08');
});
