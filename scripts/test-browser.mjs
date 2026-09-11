import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const server = process.env.GAME_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 5173 } });
if (server) await server.listen();
const url = process.env.GAME_URL || server.resolvedUrls.local[0];
const out = 'output/browser-review'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function makePage({ unlocked = false, viewport, blocked = false } = {}) {
  const context = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  // Telemetry is captured in-page. Left alone it would beacon to /api/collect, which the dev server
  // answers with a 404 and which the browser logs as a console error, tripping the empty-errors
  // assertion at the bottom of this file.
  await page.addInitScript(() => {
    window.__zsAnalytics = [];
    window.__zsAnalyticsSink = body => { try { window.__zsAnalytics.push(JSON.parse(body)); } catch { /* ignore */ } return true; };
    // Headless Chromium has no navigator.share, so record what the game would have handed over.
    window.__zsShared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { window.__zsShared.push(payload); } });
  });
  if (unlocked) await page.addInitScript(() => localStorage.setItem('zero-second-progress-v1', JSON.stringify({ version: 2, unlockedThrough: 20, levels: {} })));
  if (blocked) await page.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await page.goto(url); await page.evaluate(() => window.advanceTime(0));
  return page;
}
async function state(page) { return page.evaluate(() => JSON.parse(window.render_game_to_text())); }
async function step(page, ms) { await page.evaluate(ms => window.advanceTime(ms), ms); }
async function touch(page, x, y, hold = 700, release = true) {
  const rect = await page.locator('#game').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const point = { x: rect.x + x / 720 * rect.width, y: rect.y + y / 1280 * rect.height };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await step(page, hold);
  if (release) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
async function snapshot(page, name) { await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' }); fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(await state(page), null, 2)); }
async function events(page) { const batches = await page.evaluate(() => window.__zsAnalytics || []); return batches.flatMap(batch => batch.events); }

try {
  const first = await makePage();
  await snapshot(first, 'title');
  await first.locator('#title-select-btn').tap();
  assert.equal(await first.locator('.level-card:not(:disabled)').count(), 1);
  await snapshot(first, 'chapters');
  await first.locator('.level-card').first().tap();
  const initial = await state(first); await step(first, 8000);
  assert.deepEqual((await state(first)).enemies, initial.enemies);
  await snapshot(first, 'first-mission');
  await first.locator('#pause-btn').tap(); const paused = await state(first); await step(first, 2000);
  assert.equal((await state(first)).mode, 'paused'); assert.deepEqual((await state(first)).player, paused.player);
  await first.locator('#resume-btn').tap();
  await touch(first, 360, 860); await step(first, 80);
  assert.equal((await state(first)).objective.guardsRemaining, 1);
  await snapshot(first, 'first-kill');
  await first.locator('#pause-btn').tap(); await first.locator('#restart-btn').tap();
  assert.equal((await state(first)).moves, 0); assert.equal((await state(first)).awaitingFirstTouch, true);
  await touch(first, 140, 1100, 20); await touch(first, 140, 880, 20);
  assert.ok((await state(first)).queuedDash);
  await step(first, 750); assert.equal((await state(first)).moves, 2);
  await first.setViewportSize({ width: 844, height: 390 });
  await first.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === 'paused');
  assert.equal(await first.locator('#orientation-screen').isVisible(), true);
  await snapshot(first, 'landscape');
  await first.setViewportSize({ width: 390, height: 844 });
  assert.equal((await state(first)).mode, 'paused');
  await first.context().close();

  const routes = JSON.parse(fs.readFileSync('test/fixtures/level-routes.json', 'utf8'));
  const feedback = await makePage({ unlocked: true });
  await feedback.locator('#title-select-btn').tap(); await feedback.locator('.level-card').nth(4).tap();
  await touch(feedback, 110, 997); await step(feedback, 80);
  await touch(feedback, 620, 1100, 4000, false);
  assert.ok((await state(feedback)).enemies.some(e => e.lockedAim));
  await snapshot(feedback, 'turret-warning');
  await feedback.locator('#pause-btn').tap(); await feedback.locator('#pause-select-btn').tap();
  await feedback.locator('.level-card').nth(8).tap();
  await touch(feedback, ...routes[8].route[0]); await step(feedback, 80);
  const armored = (await state(feedback)).enemies[0];
  await touch(feedback, armored.x, armored.y, 700, false);
  assert.ok((await state(feedback)).aimPreview.hits.length);
  await snapshot(feedback, 'armor-preview');
  await feedback.context().close();

  const failure = await makePage(); await failure.locator('#start-btn').tap();
  await touch(failure, 360, 1100, 20); await step(failure, 18000);
  assert.equal((await state(failure)).mode, 'gameOver');
  await snapshot(failure, 'game-over'); await failure.locator('#continue-btn').tap();
  assert.equal((await state(failure)).health, 3); assert.equal((await state(failure)).moves, 0);
  await failure.context().close();
  const all = await makePage({ unlocked: true });
  const runs = [];
  for (let index = 0; index < routes.length; index++) {
    if (index === 0) await all.locator('#title-select-btn').tap();
    else await all.locator('#select-btn').tap();
    await all.locator('.level-card').nth(index).tap();
    const expectsBrief = [0, 1, 2, 4, 5, 8, 9].includes(index);
    assert.equal(await all.locator('#mission-brief').isVisible(), expectsBrief, `${routes[index].id} tutorial visibility`);
    await all.locator('#pause-btn').tap(); await all.locator('#resume-btn').tap();
    assert.equal(await all.locator('#mission-brief').isVisible(), expectsBrief, `${routes[index].id} tutorial visibility after resume`);
    if ([0, 1, 4, 5, 8, 9, 19].includes(index)) await snapshot(all, `f${index + 1}-brief`);
    for (const [x, y] of routes[index].route) {
      await touch(all, x, y); await step(all, 80);
      const current = await state(all);
      assert.equal(current.collision.playerOverlapsWall, false, routes[index].id);
    }
    const result = await state(all);
    assert.ok(['floorClear', 'victory'].includes(result.mode), `${routes[index].id}: ${result.mode}, ${JSON.stringify(result.objective)}`);
    assert.equal(result.rating.stars, 3, `${routes[index].id}: ${JSON.stringify(result.rating)}`);
    runs.push({ id: routes[index].id, moves: result.moves, hits: result.hits, stars: result.rating.stars });
    await snapshot(all, `${routes[index].id}-clear`);
    console.log(`${routes[index].id}: ${result.moves} moves, ${result.hits} hits, ${result.rating.stars} stars`);
    if (index === 0) {
      await all.locator('#continue-btn').tap();
      assert.equal((await state(all)).floor, 2); assert.equal((await state(all)).awaitingFirstTouch, true);
      await all.locator('#pause-btn').tap(); await all.locator('#pause-select-btn').tap();
      await all.locator('.level-card').first().tap();
      for (const [x, y] of routes[0].route) { await touch(all, x, y); await step(all, 80); }
    }
  }
  fs.writeFileSync(`${out}/all-levels.json`, JSON.stringify(runs, null, 2));
  await all.context().close();

  const telemetry = await makePage();
  await telemetry.locator('#start-btn').tap();
  for (const [x, y] of routes[0].route) { await touch(telemetry, x, y); await step(telemetry, 80); }
  const sent = await events(telemetry);
  assert.deepEqual(sent.map(event => event.n), ['session_start', 'level_start', 'first_dash', 'level_end']);
  assert.equal(sent.at(-1).p.outcome, 'clear');
  assert.equal(sent.at(-1).p.stars, 3);
  const clearHint = await telemetry.locator('#result-hint').textContent();
  assert.match(clearHint, /最高连击/, 'clear summary must show the chain the player just built');
  assert.match(clearHint, /用时/, 'clear summary must show the run time');
  await snapshot(telemetry, 'result-with-combo');
  assert.equal(await telemetry.locator('#share-btn').isVisible(), true);
  await telemetry.locator('#share-btn').tap();
  await telemetry.waitForFunction(() => window.__zsShared.length > 0);
  const shared = await telemetry.evaluate(() => window.__zsShared);
  assert.match(shared[0].text, /零秒特工/, 'the share payload must carry the run summary');
  assert.match(shared[0].text, /★★★/);
  assert.equal(await telemetry.locator('#share-btn').textContent(), '分享成绩');
  await telemetry.context().close();

  const doomed = await makePage();
  await doomed.locator('#start-btn').tap();
  await touch(doomed, 360, 1100, 20); await step(doomed, 18000);
  const doomedState = await state(doomed);
  assert.equal(doomedState.mode, 'gameOver');
  assert.ok(doomedState.damageTally.hunter > 0, 'the death must be attributed to the hunters that made contact');
  const deathHint = await doomed.locator('#result-hint').textContent();
  assert.match(deathHint, /死因/, 'failure must say what killed the player');
  await snapshot(doomed, 'game-over-cause');
  await doomed.context().close();

  const modes = await makePage({ unlocked: true });
  assert.equal(await modes.locator('#daily-btn').isVisible(), true);
  assert.equal(await modes.locator('#endless-btn').isVisible(), true);
  await modes.locator('#daily-btn').tap();
  const dailyRun = await state(modes);
  assert.equal(dailyRun.mode, 'playing');
  assert.match(dailyRun.floorName, /每日/, 'the daily button must serve a generated level');
  await snapshot(modes, 'daily-start');
  await modes.context().close();

  const endless = await makePage({ unlocked: true });
  await endless.locator('#endless-btn').tap();
  const endlessRun = await state(endless);
  assert.equal(endlessRun.mode, 'playing');
  assert.match(endlessRun.floorName, /每日/, 'endless draws from the same generated pool');
  await snapshot(endless, 'endless-start');
  await endless.context().close();

  for (const viewport of [{ width: 320, height: 568 }, { width: 430, height: 932 }]) {
    const page = await makePage({ viewport });
    await snapshot(page, `title-${viewport.width}`);
    const titleFrame = await page.locator('#app').boundingBox();
    for (const id of ['#start-btn', '#daily-btn', '#endless-btn', '#title-select-btn']) {
      const rect = await page.locator(id).boundingBox();
      assert.ok(rect && rect.y >= titleFrame.y && rect.y + rect.height <= titleFrame.y + titleFrame.height + 1, `${id} clipped on the title screen at ${viewport.width}`);
    }
    await page.locator('#start-btn').tap();
    for (const [x, y] of routes[0].route) { await touch(page, x, y); await step(page, 80); }
    await snapshot(page, `result-${viewport.width}`);
    const frame = await page.locator('#app').boundingBox();
    for (const id of ['#continue-btn', '#home-btn', '#result-title']) {
      const rect = await page.locator(id).boundingBox();
      assert.ok(rect && rect.y >= frame.y && rect.y + rect.height <= frame.y + frame.height + 1, `${id} clipped at ${viewport.width}`);
    }
    await page.reload(); await step(page, 0); await page.locator('#title-select-btn').tap();
    assert.equal(await page.locator('.level-card:not(:disabled)').count(), 2);
    assert.equal((await state(page)).progression.levels.f01.stars, 3);
    await page.context().close();
  }
  const blocked = await makePage({ blocked: true }); await blocked.locator('#start-btn').tap();
  for (const [x, y] of routes[0].route) { await touch(blocked, x, y); await step(blocked, 80); }
  assert.equal((await state(blocked)).mode, 'floorClear'); assert.equal(await blocked.locator('#storage-note').isVisible(), true);
  await blocked.context().close();
  assert.deepEqual(errors, []);
  console.log('PASS: touch controls, pause/retry, all 20 levels, small screens, persistence, blocked storage; no browser errors.');
} finally { fs.writeFileSync(`${out}/errors.json`, JSON.stringify(errors, null, 2)); await browser.close(); await server?.close(); }
