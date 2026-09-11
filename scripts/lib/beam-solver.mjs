// Beam search over the real game loop. Shared by scripts/audit-levels.mjs (which audits the
// hand-authored opening) and scripts/gen-levels.mjs (which refuses to ship a level it
// cannot clear). The search is deliberately unchanged from the version that produced the existing
// fixture routes: retuning the metric or the dedup grid would silently invalidate that work.
import { BOUNDS, MAX_DASH, PLAYER_R, SOLVER } from '../../src/constants.js';
import { isCirclePositionValid, safeCircleEndpoint } from '../../src/physics.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function objectivesOf(state, portal) {
  return [...state.enemies.filter(enemy => !enemy.dead), ...state.chips.filter(chip => !chip.collected), portal];
}

function metric(state, portal) {
  const remaining = objectivesOf(state, portal).slice();
  let cost = 0;
  let from = state.player;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i += 1) if (distance(from, remaining[i]) < distance(from, remaining[best])) best = i;
    const next = remaining.splice(best, 1)[0];
    cost += distance(from, next) / MAX_DASH;
    from = next;
  }
  return state.enemies.reduce((sum, enemy) => sum + Math.max(0, enemy.hp), 0) * 1.8
    + state.chips.filter(chip => !chip.collected).length * 1.2 + cost * 0.7 + state.floorHits * 15;
}

// Replays a route against a freshly loaded level. Returns the terminal state summary so callers can
// assert three stars, not merely "it finished".
export function replayRoute(game, data, route) {
  game.startLevelData(data);
  for (const [x, y] of route) { game.touch(x, y, SOLVER.routeHold); game.step(SOLVER.routeStep); }
  return {
    cleared: ['floorClear', 'victory'].includes(game.state.mode),
    moves: game.state.floorMoves,
    hits: game.state.floorHits,
    hp: game.state.hp,
  };
}

// `game` must already be sitting on the level under test. Returns solved:false with a reason when
// the budget runs out — beam search cannot prove a level unsolvable, so never read that as one.
export function solveLevel(game, { depth = SOLVER.depth, beamWidth = SOLVER.beamWidth, maxNodes = Infinity, seedRoute } = {}) {
  const started = Date.now();
  const walls = game.state.walls;
  const portal = game.state.portal;
  const bounds = BOUNDS;
  const fixed = [];
  for (const wall of walls) {
    for (const x of [wall.x - SOLVER.coverOffset, wall.x + wall.w + SOLVER.coverOffset]) {
      for (const y of [wall.y - SOLVER.coverOffset, wall.y + wall.h + SOLVER.coverOffset]) {
        if (isCirclePositionValid(x, y, PLAYER_R, walls, bounds)) fixed.push({ x, y });
      }
    }
  }

  if (seedRoute && seedRoute.length) {
    const replay = replayRoute(game, game.state.levelData, seedRoute);
    if (replay.cleared && replay.hits === 0) {
      return { solved: true, route: seedRoute, moves: replay.moves, hits: replay.hits, nodes: 0, ms: Date.now() - started, reason: 'seed' };
    }
    game.startLevelData(game.state.levelData);
  }

  let beam = [{ state: structuredClone(game.state), route: [] }];
  let solution = null;
  let nodes = 0;
  let budgetHit = false;
  for (let level = 0; level < depth && !solution && !budgetHit; level += 1) {
    const next = new Map();
    for (const node of beam) {
      const snapshot = node.state;
      const player = snapshot.player;
      const targets = [...objectivesOf(snapshot, portal), ...snapshot.items.filter(item => !item.collected), ...fixed];
      for (let a = 0; a < 16; a += 1) targets.push({ x: player.x + Math.cos(a / 16 * Math.PI * 2) * MAX_DASH, y: player.y + Math.sin(a / 16 * Math.PI * 2) * MAX_DASH });
      const seen = new Set();
      for (const target of targets) {
        if (nodes >= maxNodes) { budgetHit = true; break; }
        const length = distance(player, target);
        if (length < 8) continue;
        const reach = Math.min(MAX_DASH, length);
        const end = safeCircleEndpoint(player.x, player.y, player.x + (target.x - player.x) * reach / length, player.y + (target.y - player.y) * reach / length, PLAYER_R, walls, bounds);
        const key = `${Math.round(end.x / SOLVER.dedupGrid)},${Math.round(end.y / SOLVER.dedupGrid)}`;
        if (seen.has(key) || distance(player, end) < 8) continue;
        seen.add(key);
        Object.assign(game.state, structuredClone(snapshot));
        const aim = [
          Math.max(SOLVER.aimClamp.minX, Math.min(SOLVER.aimClamp.maxX, Math.round(target.x * 100) / 100)),
          Math.max(SOLVER.aimClamp.minY, Math.min(SOLVER.aimClamp.maxY, Math.round(target.y * 100) / 100)),
        ];
        game.touch(...aim, SOLVER.routeHold); game.step(SOLVER.routeStep);
        nodes += 1;
        if (game.state.floorMoves !== level + 1 || game.state.hp <= 0 || game.state.floorHits > 0) continue;
        const route = [...node.route, aim];
        if (['floorClear', 'victory'].includes(game.state.mode)) { solution = { route, moves: game.state.floorMoves, hits: game.state.floorHits }; break; }
        const nextState = game.state;
        const nodeKey = `${nextState.enemies.map(enemy => enemy.hp).join('')}/${nextState.chips.map(chip => +chip.collected).join('')}/${Math.round(nextState.player.x / SOLVER.nodeGrid)},${Math.round(nextState.player.y / SOLVER.nodeGrid)}`;
        const rank = metric(nextState, portal);
        if (!next.has(nodeKey) || rank < next.get(nodeKey).rank) next.set(nodeKey, { state: structuredClone(nextState), route, rank });
      }
      if (solution || budgetHit) break;
    }
    if (solution || budgetHit) break;
    beam = [...next.values()].sort((a, b) => a.rank - b.rank).slice(0, beamWidth);
    if (!beam.length) break;
  }
  return {
    solved: Boolean(solution), route: solution?.route, moves: solution?.moves, hits: solution?.hits, nodes, ms: Date.now() - started,
    reason: solution ? 'search' : budgetHit ? 'budget' : 'exhausted',
  };
}
