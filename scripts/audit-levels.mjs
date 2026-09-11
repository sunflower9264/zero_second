import fs from 'node:fs';
import { createRuntime } from '../test/helpers/runtime.js';
import { LEVELS } from '../src/levels.js';
import { solveLevel } from './lib/beam-solver.mjs';

const game = createRuntime();
const results = [];
fs.mkdirSync('output/level-audit', { recursive: true });
const indices = process.argv.slice(2).length ? process.argv.slice(2).map(n => Number(n) - 1) : LEVELS.map((_, i) => i);
for (const index of indices) {
  game.startAtLevel(index);
  const outcome = solveLevel(game);
  if (outcome.solved) console.error(`${LEVELS[index].id}: ${outcome.moves} moves in ${outcome.ms}ms (${outcome.nodes} nodes)`);
  const result = outcome.solved
    ? { id: LEVELS[index].id, par: LEVELS[index].parMoves, route: outcome.route, moves: outcome.moves, hits: outcome.hits, verified: true }
    : { id: LEVELS[index].id, par: LEVELS[index].parMoves, verified: false };
  results.push(result); console.log(JSON.stringify(result));
  fs.writeFileSync('output/level-audit/routes.json', JSON.stringify(results, null, 2));
}
if (results.some(r => !r.verified)) process.exitCode = 1;
