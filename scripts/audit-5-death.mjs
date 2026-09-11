import { openBrowser, newPage, state, step, snap, touch, note, log } from './retention-audit.mjs';

const VP = { width: 390, height: 844 };
const browser = await openBrowser();

// ---------- A. real death: touch once to unfreeze, then stop acting ----------
const page = await newPage(browser, { viewport: VP });
await page.locator('#start-btn').tap();
await step(page, 60);
// one sideways dash so nothing dies and the player is off the safe lane
await touch(page, 100, 1100, 60);
await step(page, 60);
await snap(page, 'p5-00-after-one-dash');
let hitLog = []; let lastHp = 3; let t = 0;
for (let i = 0; i < 60 * 45; i += 1) {
  await step(page, 100);
  t += 100;
  const s = await state(page);
  if (s.health < lastHp) { hitLog.push({ t: (t / 1000).toFixed(1) + 's', hpAfter: s.health, player: { x: s.player.x, y: s.player.y } }); lastHp = s.health; await snap(page, `p5-01-hit-${3 - s.health}`); }
  if (s.mode !== 'playing') { log(`died at ${(t / 1000).toFixed(1)}s of game time`); break; }
}
const dead = await state(page);
await snap(page, 'p5-02-gameover');
const goText = await page.evaluate(() => ({
  kicker: document.querySelector('#result-kicker').textContent,
  title: document.querySelector('#result-title').textContent,
  stars: document.querySelector('#result-stars').textContent,
  hint: document.querySelector('#result-hint').textContent,
  score: document.querySelector('#result-score').textContent,
  stats: document.querySelector('#result-stats').textContent.replace(/\s+/g, ' ').trim(),
  continueBtn: document.querySelector('#continue-btn').textContent.trim(),
  otherButtons: [...document.querySelectorAll('#result-screen button')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()),
  visibleTextAll: document.querySelector('#result-screen').innerText.replace(/\n+/g, ' | '),
}));
note('p5-gameover', { mode: dead.mode, hits: dead.hits, moves: dead.moves, hitLog, screen: goText });
log('HIT TIMELINE:', JSON.stringify(hitLog));
log('GAME OVER SCREEN:', JSON.stringify(goText, null, 1));

// ---------- B. per-frame dead time over a full level-1 clear ----------
const p2 = await newPage(browser, { viewport: VP });
await p2.evaluate(() => {
  window.__s = { blocked: 0, active: 0, frames: 0, aimBlocked: 0 };
  const orig = window.advanceTime;
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      orig(1000 / 60);
      const s = JSON.parse(window.render_game_to_text());
      if (s.mode === 'playing' && !s.awaitingFirstTouch) { window.__s.frames += 1; if (s.player.dashReady) window.__s.active += 1; else window.__s.blocked += 1; }
    }
  };
});
await p2.locator('#start-btn').tap();
const route = [[360, 620], [360, 380], [360, 170], [360, 170]];
const perMove = [];
for (const [x, y] of route) {
  const before = await p2.evaluate(() => ({ ...window.__s }));
  await touch(p2, x, y, 700);
  await step(p2, 80);
  const after = await p2.evaluate(() => ({ ...window.__s }));
  const st = await state(p2);
  perMove.push({ blockedFramesThisMove: after.blocked - before.blocked, moves: st.moves, mode: st.mode });
  if (st.mode !== 'playing') break;
}
const totals = await p2.evaluate(() => window.__s);
note('p5-deadtime-l1', { totals, perMove, blockedMs: Math.round(totals.blocked * 1000 / 60), activeMs: Math.round(totals.active * 1000 / 60), frames: totals.frames });
log('L1 PER-FRAME DEAD TIME:', JSON.stringify({ frames: totals.frames, activeMs: Math.round(totals.active * 1000 / 60), blockedMs: Math.round(totals.blocked * 1000 / 60), pct: (100 * totals.blocked / totals.frames).toFixed(1) }));
log('PER MOVE:', JSON.stringify(perMove));

// ---------- C. same, but a player who does NOT chain (waits out every cooldown) ----------
const p3 = await newPage(browser, { viewport: VP });
await p3.evaluate(() => {
  window.__s = { blocked: 0, active: 0, frames: 0 };
  const orig = window.advanceTime;
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      orig(1000 / 60);
      const s = JSON.parse(window.render_game_to_text());
      if (s.mode === 'playing' && !s.awaitingFirstTouch) { window.__s.frames += 1; if (s.player.dashReady) window.__s.active += 1; else window.__s.blocked += 1; }
    }
  };
});
await p3.locator('#start-btn').tap();
for (let i = 0; i < 8; i += 1) {
  const st = await state(p3);
  if (st.mode !== 'playing') break;
  const cands = [...st.enemies.map(e => ({ x: e.x, y: e.y })), ...st.dataChips, st.portal];
  let best = cands[0]; let bd = Infinity;
  for (const c of cands) { const d = Math.hypot(c.x - st.player.x, c.y - st.player.y); if (d < bd) { bd = d; best = c; } }
  await touch(p3, best.x, best.y, 500);
  await step(p3, 900); // idle out the cooldown deliberately
}
const t3 = await p3.evaluate(() => window.__s);
const s3 = await state(p3);
note('p5-deadtime-nochain', { totals: t3, mode: s3.mode, moves: s3.moves, rating: s3.rating });
log('L1 DEAD TIME, NON-CHAINING PLAYER:', JSON.stringify({ frames: t3.frames, blockedMs: Math.round(t3.blocked * 1000 / 60), pct: (100 * t3.blocked / t3.frames).toFixed(1) }), 'moves', s3.moves, 'mode', s3.mode);
await browser.close();
