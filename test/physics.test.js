import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { isCirclePositionValid, safeCircleEndpoint, stopBeforeCircle } from '../src/physics.js';

const BOUNDS = { left: 0, right: 720, top: 118, bottom: 1210 };

test('knockback cannot embed the player in a wall', () => {
  const walls = [{ x: 250, y: 700, w: 220, h: 48 }];
  const end = safeCircleEndpoint(350, 780, 350, 746, 19, walls, BOUNDS);
  assert.equal(end.blocked, true);
  assert.equal(isCirclePositionValid(end.x, end.y, 19, walls, BOUNDS), true);
  assert.ok(end.y > 767, `expected y > 767, got ${end.y}`);
});

test('swept movement preserves the wall invariant around edges and corners', () => {
  const walls = [{ x: 250, y: 700, w: 220, h: 48 }];
  const starts = [[180, 680], [180, 780], [540, 680], [540, 780], [360, 650], [360, 800]];
  for (const [sx, sy] of starts) {
    assert.equal(isCirclePositionValid(sx, sy, 19, walls, BOUNDS), true);
    for (let degrees = 0; degrees < 360; degrees += 3) {
      const angle = degrees / 180 * Math.PI;
      const end = safeCircleEndpoint(sx, sy, sx + Math.cos(angle) * 500, sy + Math.sin(angle) * 500, 19, walls, BOUNDS);
      assert.equal(isCirclePositionValid(end.x, end.y, 19, walls, BOUNDS), true, `invalid at ${degrees} degrees`);
    }
  }
});

test('a nonlethal armored hit leaves enough separation for the dash cooldown', () => {
  const level = LEVELS[11];
  const walls = level.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
  const start = { x: 250, y: 1050 };
  const armored = { x: 261, y: 875, r: 27 };
  const impact = safeCircleEndpoint(start.x, start.y, armored.x, armored.y, 19, walls, BOUNDS);
  const landing = stopBeforeCircle(start.x, start.y, impact.x, impact.y, armored.x, armored.y, armored.r + 19 + 26);
  const distance = Math.hypot(landing.x - armored.x, landing.y - armored.y);
  assert.equal(isCirclePositionValid(landing.x, landing.y, 19, walls, BOUNDS), true);
  assert.ok(distance >= armored.r + 19 + 26 - .01, `expected recoil separation, got ${distance}`);
  assert.ok(distance - 28 * .64 > armored.r + 19 + 2, 'armored enemy must not reach the player before dash cooldown ends');
});

test('all level entities start outside walls and player bounds', () => {
  assert.equal(LEVELS.length, 20);
  const invalid = [];
  for (const level of LEVELS) {
    const walls = level.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
    const check = (label, point, radius) => {
      if (!isCirclePositionValid(point[0], point[1], radius, walls, BOUNDS)) {
        invalid.push(`${level.id} ${label} at ${point[0]},${point[1]}`);
      }
    };
    check('player', level.start, 19);
    check('portal', level.portal, 32);
    level.chips.forEach((point, index) => check(`chip#${index}`, point, 18));
    level.enemies.forEach(([type, x, y], index) => check(`${type}#${index}`, [x, y], type === 'armored' ? 27 : 23));
    level.items.forEach(([type, x, y], index) => check(`${type}#${index}`, [x, y], 18));
  }
  assert.deepEqual(invalid, [], `invalid level entities:\n${invalid.join('\n')}`);
});

test('every required objective shares a traversable region with the player', () => {
  const spacing = 20;
  for (const level of LEVELS) {
    const walls = level.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
    const cells = new Map();
    for (let y = 140; y <= 1180; y += spacing) {
      for (let x = 20; x <= 700; x += spacing) {
        if (isCirclePositionValid(x, y, 19, walls, BOUNDS)) cells.set(`${x},${y}`, { x, y });
      }
    }
    const nearest = point => [...cells.values()].reduce((best, cell) => {
      const distance = Math.hypot(cell.x - point[0], cell.y - point[1]);
      return !best || distance < best.distance ? { ...cell, distance } : best;
    }, null);
    const start = nearest(level.start);
    assert.ok(start && start.distance <= 30, `${level.id} has no valid start cell`);
    const visited = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length) {
      const cell = queue.shift();
      for (const [dx, dy] of [[spacing, 0], [-spacing, 0], [0, spacing], [0, -spacing]]) {
        const key = `${cell.x + dx},${cell.y + dy}`;
        if (cells.has(key) && !visited.has(key)) { visited.add(key); queue.push(cells.get(key)); }
      }
    }
    const required = [level.portal, ...level.chips, ...level.enemies.map(([, x, y]) => [x, y])];
    for (const point of required) {
      const cell = nearest(point);
      assert.ok(cell && cell.distance <= 35 && visited.has(`${cell.x},${cell.y}`), `${level.id} objective ${point} is unreachable`);
    }
  }
});

test('authored difficulty follows a rising sawtooth and ends at the highest peak', () => {
  const chapters = Array.from({ length: 5 }, (_, index) => LEVELS.slice(index * 4, index * 4 + 4));
  for (const chapter of chapters) {
    for (let index = 1; index < chapter.length; index += 1) {
      assert.ok(chapter[index].difficulty > chapter[index - 1].difficulty, `${chapter[index].id} must be harder than ${chapter[index - 1].id}`);
      assert.ok(chapter[index].parMoves >= chapter[index - 1].parMoves, `${chapter[index].id} par must not drop inside a chapter`);
    }
  }
  for (let index = 1; index < chapters.length; index += 1) {
    assert.ok(chapters[index][0].difficulty > chapters[index - 1][0].difficulty, `chapter ${index + 1} must start above the previous baseline`);
    assert.ok(chapters[index][3].difficulty > chapters[index - 1][3].difficulty, `chapter ${index + 1} must peak above the previous chapter`);
  }
  assert.equal(LEVELS.at(-1).difficulty, Math.max(...LEVELS.map(level => level.difficulty)));
});

test('floor 20 has a twelve-move golden path', () => {
  const level = LEVELS.at(-1);
  const walls = level.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
  const enemies = level.enemies.map(([type, x, y]) => ({ x, y, r: type === 'armored' ? 27 : 23, hp: type === 'armored' ? 2 : 1 }));
  const chips = level.chips.map(([x, y]) => ({ x, y, collected: false }));
  const aims = [[120, 1020], [63, 821], [333, 821], [340, 720], [589, 617], [595, 361], [325, 361], [55, 361], [55, 137], [600, 160], [600, 160], [360, 220]];
  const segmentDistance = (point, start, end) => {
    const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
  };
  let player = { x: level.start[0], y: level.start[1] };
  for (const [aimX, aimY] of aims) {
    const dx = aimX - player.x; const dy = aimY - player.y; const length = Math.hypot(dx, dy);
    const scale = Math.min(270, length) / length;
    const target = { x: player.x + dx * scale, y: player.y + dy * scale };
    const end = safeCircleEndpoint(player.x, player.y, target.x, target.y, 19, walls, BOUNDS);
    for (const enemy of enemies) if (enemy.hp > 0 && segmentDistance(enemy, player, end) <= enemy.r + 13) enemy.hp -= 1;
    for (const chip of chips) if (!chip.collected && segmentDistance(chip, player, end) < 35) chip.collected = true;
    player = end;
  }
  assert.equal(aims.length, level.parMoves);
  assert.ok(enemies.every(enemy => enemy.hp === 0), 'golden path must defeat every enemy');
  assert.ok(chips.every(chip => chip.collected), 'golden path must collect every data chip');
  assert.ok(Math.hypot(player.x - level.portal[0], player.y - level.portal[1]) < 62, 'golden path must reach the portal');
});
