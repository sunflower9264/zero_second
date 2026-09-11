import { openBrowser, newPage, state, step, snap, touch, note, log } from './retention-audit.mjs';

const VP = { width: 390, height: 844 };
const browser = await openBrowser();
const page = await newPage(browser, { unlocked: true, viewport: VP });
await page.locator('#title-select-btn').tap();
await page.locator('.level-card').nth(2).tap(); // f03, walls
await step(page, 40);
const walls = (await state(page)).collision.walls;
log('f03 walls:', JSON.stringify(walls));

// Walk into the wall face deliberately, then tap "into" the wall.
// Wall [0,810,470,42] occupies y 810..852. Player radius 19 -> hugging means y = 871.
const isDeadInput = async (label, fromX, fromY, tapX, tapY) => {
  // move the player adjacent using a legal dash first
  const before = await state(page);
  await touch(page, tapX, tapY, 60);
  await step(page, 60);
  const after = await state(page);
  const moved = after.moves - before.moves;
  const cooldownStarted = after.player.dashCooldown > 0;
  log(`  ${label}: from (${before.player.x},${before.player.y}) tap (${tapX},${tapY}) -> moves+${moved} cooldown=${after.player.dashCooldown} player=(${after.player.x},${after.player.y}) DEAD_INPUT=${moved === 0 && !cooldownStarted}`);
  return { label, from: { x: before.player.x, y: before.player.y }, tap: { x: tapX, y: tapY }, movedMoves: moved, cooldownAfter: after.player.dashCooldown, playerAfter: { x: after.player.x, y: after.player.y }, deadInput: moved === 0 && !cooldownStarted };
};

const results = [];
// Repeatedly tap "up into" the wall at x=200 and record what happens
for (let i = 0; i < 6; i += 1) results.push(await isDeadInput(`tap-up-into-wall #${i}`, 200, 871, 200, 700));
await snap(page, 'p6-00-wall-hug');
const mid = await state(page);
log('player after wall-hug taps:', JSON.stringify(mid.player), 'moves', mid.moves, 'hitbox overlap?', mid.collision.playerOverlapsWall);

// Edge-of-field probe: bottom edge
const p2 = await newPage(browser, { unlocked: true, viewport: VP });
await p2.locator('#title-select-btn').tap();
await p2.locator('.level-card').first().tap();
await step(p2, 40);
const edge = [];
for (let i = 0; i < 5; i += 1) {
  const b = await state(p2);
  await touch(p2, b.player.x, Math.min(1279, b.player.y + 400), 60);
  await step(p2, 60);
  const a = await state(p2);
  const rec = { tapDownFrom: { x: b.player.x, y: b.player.y }, moves: a.moves - b.moves, cd: a.player.dashCooldown, after: { x: a.player.x, y: a.player.y } };
  edge.push(rec);
  log(`  edge-down tap: from (${rec.tapDownFrom.x},${rec.tapDownFrom.y}) moves+${rec.moves} cd=${rec.cd} after (${rec.after.x},${rec.after.y})`);
}
const eEnd = await state(p2);
log('edge probe end: player', JSON.stringify(eEnd.player), 'mode', eEnd.mode, 'moves', eEnd.moves);

// Very short drag (tap without movement) -- how far does a plain tap move you?
const p3 = await newPage(browser, { unlocked: true, viewport: VP });
await p3.locator('#title-select-btn').tap();
await p3.locator('.level-card').first().tap();
await step(p3, 40);
const taps = [];
for (const [tx, ty] of [[360, 700], [100, 1000], [600, 1000], [360, 400]]) {
  const b = await state(p3);
  if (b.mode !== 'playing') break;
  await touch(p3, tx, ty, 16);
  await step(p3, 40);
  const a = await state(p3);
  taps.push({ tap: [tx, ty], from: { x: b.player.x, y: b.player.y }, to: { x: a.player.x, y: a.player.y }, moved: a.moves - b.moves, travelled: Math.round(Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y)) });
}
note('p6-taps', taps);
log('PLAIN TAPS:', JSON.stringify(taps));

note('p6-dead-inputs', results);
note('p6-edge', edge);
await browser.close();
