import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BOUNDS, FIELD_BOTTOM, FIELD_TOP, H, MAX_DASH, PLAYER_R, SOLVER, W } from '../src/constants.js';

test('play-field geometry matches the coordinate system the levels are authored in', () => {
  assert.equal(W, 720);
  assert.equal(H, 1280);
  assert.equal(FIELD_TOP, 118);
  assert.equal(FIELD_BOTTOM, 1210);
  assert.equal(PLAYER_R, 19);
  assert.equal(MAX_DASH, 270);
  assert.deepEqual(BOUNDS, { left: 0, right: 720, top: 118, bottom: 1210 });
});

test('solver tuning stays inside the play field', () => {
  assert.ok(SOLVER.aimClamp.minX >= BOUNDS.left);
  assert.ok(SOLVER.aimClamp.maxX <= BOUNDS.right);
  assert.ok(SOLVER.aimClamp.minY >= FIELD_TOP);
  assert.ok(SOLVER.aimClamp.maxY <= FIELD_BOTTOM);
  assert.ok(SOLVER.dedupGrid > 0 && SOLVER.nodeGrid > 0);
});

// main.js declares nothing locally: a stray `const W = 720` would silently shadow the injected
// constant inside the vm sandbox and the game would quietly run on different geometry.
test('main.js does not re-declare the shared geometry constants', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const name of ['W', 'H', 'FIELD_TOP', 'FIELD_BOTTOM', 'MAX_DASH', 'PLAYER_R', 'BOUNDS']) {
    assert.ok(!new RegExp(`^const ${name}\\b`, 'm').test(source), `${name} must come from constants.js, not be redeclared`);
  }
  assert.match(source, /^import \{[^}]*\} from '\.\/constants\.js';$/m);
});
