import { openBrowser, newPage, state, step, snap, touch, note, log } from './retention-audit.mjs';

const VP = { width: 390, height: 844 };
let seed = 777;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const browser = await openBrowser();

async function attempt(page, maxSeconds) {
  const rec = { deadInputs: 0, movesStart: null, hits: [], deaths: [], actions: 0 };
  let lastHp = 3; const start = await state(page); rec.movesStart = start.moves;
  const maxFrames = maxSeconds * 60; let frames = 0;
  while (frames < maxFrames) {
    const s = await state(page);
    if (s.mode !== 'playing') return { ...rec, endMode: s.mode, gameSeconds: (frames / 60).toFixed(1), moves: s.moves, hits: s.hits, hp: s.health, rating: s.rating, objective: s.objective };
    if (s.health < lastHp) { rec.deaths.push({ t: (frames / 60).toFixed(1), hpAfter: s.health, at: { x: s.player.x, y: s.player.y }, guardsLeft: s.objective.guardsRemaining, chipsLeft: s.objective.dataRemaining }); lastHp = s.health; }
    if (!s.player.dashReady) { await step(page, 100); frames += 6; continue; }
    // unskilled aim: nearest live enemy first (they walk to you), otherwise nearest objective
    const cands = [...s.enemies.map(e => ({ x: e.x, y: e.y, w: 1 })), ...s.dataChips.map(c => ({ x: c.x, y: c.y, w: 1.3 }))];
    if (s.portal.open) cands.push({ x: s.portal.x, y: s.portal.y, w: 0.5 });
    let t = cands[0]; let bd = Infinity;
    for (const c of cands) { const d = Math.hypot(c.x - s.player.x, c.y - s.player.y) * c.w; if (d < bd) { bd = d; t = c; } }
    if (!t) break;
    const jit = 60;
    const tx = t.x + (rnd() * 2 - 1) * jit; const ty = t.y + (rnd() * 2 - 1) * jit;
    const movesBefore = s.moves;
    await touch(page, tx, ty, 150 + rnd() * 700);
    await step(page, 60); frames += 5; rec.actions += 1;
    const after = await state(page);
    if (after.moves === movesBefore && after.mode === 'playing') rec.deadInputs += 1;
  }
  const s = await state(page);
  return { ...rec, endMode: 'timeout', gameSeconds: (frames / 60).toFixed(1), moves: s.moves, hits: s.hits, hp: s.health, rating: s.rating, objective: s.objective };
}

async function runLevel(index, label, maxAttempts, maxSeconds) {
  const page = await newPage(browser, { unlocked: true, viewport: VP });
  await page.locator('#title-select-btn').tap();
  await page.locator('.level-card').nth(index).tap();
  await step(page, 40);
  await snap(page, `p7-${label}-start`);
  const hasBrief = await page.evaluate(() => !document.querySelector('#mission-brief').hidden);
  log(`\n=== ${label} (level ${index + 1}) mission brief visible: ${hasBrief} ===`);
  const attempts = []; const wall0 = Date.now();
  for (let a = 1; a <= maxAttempts; a += 1) {
    const r = await attempt(page, maxSeconds);
    attempts.push(r);
    log(`  attempt ${a}: end=${r.endMode} gameTime=${r.gameSeconds}s moves=${r.moves} hits=${r.hits} hp=${r.hp} deadInputs=${r.deadInputs} actions=${r.actions} deaths=${JSON.stringify(r.deaths)}`);
    if (r.endMode === 'floorClear' || r.endMode === 'victory') { await snap(page, `p7-${label}-CLEAR`); break; }
    if (r.endMode === 'gameOver') {
      await snap(page, `p7-${label}-gameover-a${a}`);
      if (a === 1) {
        const t = await page.evaluate(() => ({ kicker: document.querySelector('#result-kicker').textContent, title: document.querySelector('#result-title').textContent, hint: document.querySelector('#result-hint').textContent, stats: document.querySelector('#result-stats').textContent.replace(/\s+/g, ' ').trim(), cont: document.querySelector('#continue-btn').textContent.trim() }));
        log(`  GAME OVER: "${t.kicker} / ${t.title}" hint="${t.hint}" stats="${t.stats}"`);
      }
    } else { await snap(page, `p7-${label}-timeout-a${a}`); }
    if (r.endMode === 'gameOver') { await page.locator('#continue-btn').tap(); } else { await page.locator('#pause-btn').tap(); await page.locator('#restart-btn').tap(); }
    await step(page, 40);
  }
  const cleared = ['floorClear', 'victory'].includes(attempts.at(-1).endMode);
  const summary = { label, attempts: attempts.length, cleared, wallSeconds: ((Date.now() - wall0) / 1000).toFixed(0), totalGameSeconds: attempts.reduce((s, a) => s + Number(a.gameSeconds), 0).toFixed(0), totalDeaths: attempts.reduce((s, a) => s + a.deaths.length, 0), deadInputs: attempts.reduce((s, a) => s + a.deadInputs, 0) };
  log(`  SUMMARY ${label}: attempts=${summary.attempts} cleared=${cleared} wall=${summary.wallSeconds}s gameTimeTotal=${summary.totalGameSeconds}s deaths=${summary.totalDeaths} deadInputs=${summary.deadInputs}`);
  await page.context().close();
  return summary;
}

const r3 = await runLevel(2, 'f03', 5, 75);
const r4 = await runLevel(3, 'f04', 5, 75);
note('p7-cliff', [r3, r4]);
await browser.close();
