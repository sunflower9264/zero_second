import { openBrowser, newPage, state, step, snap, touch, note, log, visibleText } from './retention-audit.mjs';
import fs from 'node:fs';

const VP = { width: 390, height: 844 };
const browser = await openBrowser();
const installSampler = async (page) => page.evaluate(() => {
  window.__s = { blocked: 0, active: 0, frames: 0, log: [] };
  const orig = window.advanceTime;
  window.advanceTime = (ms) => {
    orig(ms);
    const s = JSON.parse(window.render_game_to_text());
    if (s.mode === 'playing' && !s.awaitingFirstTouch) { window.__s.frames += 1; if (s.player.dashReady) window.__s.active += 1; else window.__s.blocked += 1; }
  };
});
const readSampler = async (page) => page.evaluate(() => {
  const s = window.__s; const f = s.frames || 1;
  return { frames: s.frames, activeMs: Math.round(s.active * 1000 / 60), blockedMs: Math.round(s.blocked * 1000 / 60), blockedPct: +(100 * s.blocked / f).toFixed(1) };
});

// ---------- 1. layout / brief geometry at 390x844 ----------
const page = await newPage(browser, { viewport: VP });
await snap(page, 'p4-00-title-390x844');
const layout = await page.evaluate(() => {
  const app = document.querySelector('#app').getBoundingClientRect();
  const cv = document.querySelector('#game').getBoundingClientRect();
  const t = document.querySelector('#title-screen').getBoundingClientRect();
  return { innerW: innerWidth, innerH: innerHeight, app: app.toJSON(), canvas: cv.toJSON(), titleScreen: t.toJSON() };
});
note('p4-layout-390x844', layout);
log('LAYOUT 390x844 app=', JSON.stringify(layout.app), 'canvas=', JSON.stringify(layout.canvas), 'inner=', layout.innerW, layout.innerH);

await page.locator('#start-btn').tap();
await step(page, 40);
await snap(page, 'p4-01-level1-brief-390x844');
const overlay = await page.evaluate(() => {
  const cv = document.querySelector('#game').getBoundingClientRect();
  const br = document.querySelector('#mission-brief').getBoundingClientRect();
  const toC = (sx, sy) => [Math.round((sx - cv.x) / cv.width * 720), Math.round((sy - cv.y) / cv.height * 1280)];
  const cs = getComputedStyle(document.querySelector('#mission-brief'));
  return { briefRect: br.toJSON(), topLeftCanvas: toC(br.x, br.y), bottomRightCanvas: toC(br.x + br.width, br.y + br.height), fontSize: cs.fontSize, hidden: document.querySelector('#mission-brief').hidden };
});
note('p4-brief-overlay', overlay);
const s1 = await state(page);
log('BRIEF canvas box:', JSON.stringify(overlay.topLeftCanvas), '->', JSON.stringify(overlay.bottomRightCanvas), 'font', overlay.fontSize);
log('L1 enemies:', JSON.stringify(s1.enemies), 'chip:', JSON.stringify(s1.dataChips), 'player:', JSON.stringify(s1.player), 'portal:', JSON.stringify(s1.portal));
const covered = s1.enemies.filter(e => e.x >= overlay.topLeftCanvas[0] && e.x <= overlay.bottomRightCanvas[0] && e.y >= overlay.topLeftCanvas[1] && e.y <= overlay.bottomRightCanvas[1]);
log('ENEMIES COVERED BY BRIEF:', JSON.stringify(covered));

// ---------- 2. dead time: level 1 played by a naive player ----------
await installSampler(page);
const positions = [];
// naive: aim near the nearest objective but do NOT chain; wait out every cooldown
for (let i = 0; i < 12; i += 1) {
  const st = await state(page); if (st.mode !== 'playing') break;
  const cands = [...st.enemies.map(e => ({ x: e.x, y: e.y })), ...st.dataChips, st.portal];
  let best = cands[0]; let bd = Infinity;
  for (const c of cands) { const d = Math.hypot(c.x - st.player.x, c.y - st.player.y); if (d < bd) { bd = d; best = c; } }
  await touch(page, best.x, best.y, 400);
  positions.push({ i, x: st.player.x, y: st.player.y, ready: st.player.dashReady, cd: st.player.dashCooldown });
  await step(page, 700); // deliberately idle out the cooldown, like a cautious novice
}
const deadTime = await readSampler(page);
const end1 = await state(page);
await snap(page, 'p4-02-level1-end');
note('p4-deadtime-l1', { deadTime, endMode: end1.mode, moves: end1.moves, hits: end1.hits, rating: end1.rating, positions });
log('L1 DEAD TIME (naive, waits out cooldown every move):', JSON.stringify(deadTime), 'moves', end1.moves, 'mode', end1.mode, 'rating', JSON.stringify(end1.rating));

// ---------- 3. failure feedback: stand still and die ----------
const p2 = await newPage(browser, { viewport: VP });
await p2.locator('#start-btn').tap();
await step(p2, 60);
await snap(p2, 'p4-03-stand-still-start');
await step(p2, 24000);
const dead = await state(p2);
await snap(p2, 'p4-04-gameover');
const goText = await p2.evaluate(() => ({
  kicker: document.querySelector('#result-kicker').textContent, title: document.querySelector('#result-title').textContent,
  stars: document.querySelector('#result-stars').textContent, hint: document.querySelector('#result-hint').textContent,
  score: document.querySelector('#result-score').textContent, stats: document.querySelector('#result-stats').textContent.replace(/\s+/g, ' ').trim(),
  continueBtn: document.querySelector('#continue-btn').textContent.trim(),
  buttons: [...document.querySelectorAll('#result-screen button')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()),
}));
note('p4-gameover-screen', { mode: dead.mode, moves: dead.moves, hits: dead.hits, hp: dead.health, screen: goText });
log('GAME OVER SCREEN (stood still):', JSON.stringify(goText, null, 1));
log('  state:', dead.mode, 'hits', dead.hits, 'moves', dead.moves);
await browser.close();
