// Constructive level generation. Rather than scattering geometry and hoping a solver finds a way
// through, this builds the intended route first and then places walls *off* that route, so
// "the level is geometrically clearable" is guaranteed by construction. Only damage-free clearing
// is left to verification, which scripts/gen-daily.mjs insists on before accepting a level.
//
// Scope note: generated levels use hunters, data chips and walls only. Armoured guards need two
// hits and turrets shoot across the route, and both wreck the single-dash-per-objective assumption
// this generator is built on, so they are deliberately left to the handcrafted campaign.
import { BOUNDS, FIELD_BOTTOM, FIELD_TOP, MAX_DASH, PLAYER_R, W } from '../../src/constants.js';
import { between, mulberry32 } from './prng.mjs';

const WALL_THICKNESS = 42;
const LEG_MIN = 170;
const LEG_MAX = 248;   // comfortably inside MAX_DASH so one dash always reaches the next target
const ROUTE_CLEARANCE = PLAYER_R + 10;
const START = { minX: 80, maxX: W - 80, minY: FIELD_BOTTOM - 150, maxY: FIELD_BOTTOM - 60 };

function rectOverlapsSegment(rect, ax, ay, bx, by, pad) {
  // Sample the segment; walls are wide relative to the sample spacing so this cannot tunnel.
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t; const y = ay + (by - ay) * t;
    if (x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad) return true;
  }
  return false;
}

// A random walk that trends upward from the spawn to the top of the field, with every leg short
// enough that a single dash reaches the next objective.
function buildChain(rng, count, start) {
  const points = [];
  let current = { ...start };
  let heading = -Math.PI / 2;
  for (let i = 0; i < count; i += 1) {
    let chosen = null;
    for (let attempt = 0; attempt < 40 && !chosen; attempt += 1) {
      const angle = heading + between(rng, -0.95, 0.95);
      const length = between(rng, LEG_MIN, LEG_MAX);
      const next = { x: current.x + Math.cos(angle) * length, y: current.y + Math.sin(angle) * length };
      if (next.x < 60 || next.x > W - 60) continue;
      if (next.y < FIELD_TOP + 70 || next.y > FIELD_BOTTOM - 70) continue;
      if (points.some(point => Math.hypot(point.x - next.x, point.y - next.y) < 90)) continue;
      chosen = { point: next, angle };
    }
    if (!chosen) break;
    points.push(chosen.point);
    heading = chosen.angle;
    current = chosen.point;
  }
  return { points, end: current };
}

export function generateLevel(seed, spec) {
  const rng = mulberry32(seed);
  const start = { x: between(rng, START.minX, START.maxX), y: between(rng, START.minY, START.maxY) };
  const targetCount = spec.enemies + spec.chips;
  const { points, end } = buildChain(rng, targetCount, start);
  if (points.length < targetCount) return { rejected: 'chain-too-short' };

  const portal = {
    x: Math.max(70, Math.min(W - 70, end.x + between(rng, -120, 120))),
    y: Math.max(FIELD_TOP + 60, end.y - between(rng, 150, 220)),
  };
  if (Math.hypot(portal.x - end.x, portal.y - end.y) > MAX_DASH - 30) return { rejected: 'portal-unreachable' };

  const route = [start, ...points, portal];
  // Which chain slots hold data versus guards is shuffled; the route visits every slot either way.
  const slots = points.map((_, index) => index);
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const chipPoints = slots.slice(0, spec.chips).map(index => points[index]);
  const hunterPoints = slots.slice(spec.chips).map(index => points[index]);

  const walls = [];
  for (let attempt = 0; attempt < spec.walls * 24 && walls.length < spec.walls; attempt += 1) {
    const horizontal = rng() < 0.65;
    const length = between(rng, 170, 420);
    const rect = horizontal
      ? { x: between(rng, 30, W - length - 30), y: between(rng, FIELD_TOP + 80, FIELD_BOTTOM - 90), w: length, h: WALL_THICKNESS }
      : { x: between(rng, 30, W - WALL_THICKNESS - 30), y: between(rng, FIELD_TOP + 80, FIELD_BOTTOM - 140), w: WALL_THICKNESS, h: length };
    if (walls.some(other => rect.x < other.x + other.w + 24 && rect.x + rect.w + 24 > other.x && rect.y < other.y + other.h + 24 && rect.y + rect.h + 24 > other.y)) continue;
    let blocksRoute = false;
    for (let i = 0; i < route.length - 1 && !blocksRoute; i += 1) {
      if (rectOverlapsSegment(rect, route[i].x, route[i].y, route[i + 1].x, route[i + 1].y, ROUTE_CLEARANCE)) blocksRoute = true;
    }
    if (blocksRoute) continue;
    if (route.some(point => point.x >= rect.x - 44 && point.x <= rect.x + rect.w + 44 && point.y >= rect.y - 44 && point.y <= rect.y + rect.h + 44)) continue;
    walls.push(rect);
  }
  // A wall parked in a corner the player never passes is decoration, not level design. Require at
  // least one wall to sit close enough to the route that it is visibly part of the layout.
  if (spec.walls > 0 && !walls.some(rect => route.some(point => Math.hypot(point.x - (rect.x + rect.w / 2), point.y - (rect.y + rect.h / 2)) < 150))) {
    return { rejected: 'walls-irrelevant' };
  }

  const level = {
    id: spec.id, name: spec.name, code: spec.code, difficulty: spec.difficulty, difficultyTier: spec.difficultyTier,
    tutorial: false, brief: '', parMoves: route.length - 1,
    start: [Math.round(start.x), Math.round(start.y)], portal: [Math.round(portal.x), Math.round(portal.y)],
    chips: chipPoints.map(point => [Math.round(point.x), Math.round(point.y)]),
    enemies: hunterPoints.map(point => ['hunter', Math.round(point.x), Math.round(point.y)]),
    walls: walls.map(rect => [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)]),
    items: [],
  };
  // The intended route in the units the game expects: aim at each objective in chain order.
  const intended = [...points, portal].map(point => [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]);
  return { level, route: intended, seed };
}

export function levelIsSane(level) {
  const inside = (x, y, pad) => x >= BOUNDS.left + pad && x <= BOUNDS.right - pad && y >= BOUNDS.top + pad && y <= BOUNDS.bottom - pad;
  if (!inside(level.start[0], level.start[1], PLAYER_R)) return false;
  if (!inside(level.portal[0], level.portal[1], PLAYER_R)) return false;
  return [...level.chips, ...level.enemies.map(enemy => [enemy[1], enemy[2]])].every(([x, y]) => inside(x, y, 30));
}
