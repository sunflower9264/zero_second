import { openBrowser, newPage, state, step, snap, touch, note, log, dist } from './retention-audit.mjs';
import { LEVELS } from '../src/levels.js';

const MAX_DASH = 270, PLAYER_R = 19, HUNTER_R = 23;

// ---------- A. static distance analysis ----------
const rows = [];
for (let i = 0; i < 5; i += 1) {
  const L = LEVELS[i];
  const nodes = [['start', L.start], ...L.chips.map((c, k) => [`chip${k}`, c]),
    ...L.enemies.map((e, k) => [`${e[0]}${k}`, [e[1], e[2]]]), ['portal', L.portal]];
  // greedy nearest-unvisited chain from start = the naive "no refill" travel problem
  const seen = new Set(['start']); const chain = ['start']; let cur = L.start; let total = 0; let maxLeg = 0;
  while (chain.length < nodes.length) {
    let best = null; let bestD = Infinity;
    for (const [n, p] of nodes) { if (seen.has(n)) continue; const d = Math.hypot(p[0] - cur[0], p[1] - cur[1]); if (d < bestD) { bestD = d; best = n; } }
    const target = nodes.find(n => n[0] === best);
    seen.add(best); chain.push(best); total += bestD; maxLeg = Math.max(maxLeg, bestD); cur = target[1];
  }
  const movesNoRefill = Math.ceil(total / MAX_DASH);
  rows.push({ id: L.id, name: L.name, parMoves: L.parMoves, maxLeg: Math.round(maxLeg), totalTravel: Math.round(total), movesNoRefill, chain: chain.join('>') ,
    startToFirstEnemy: Math.round(Math.hypot(L.enemies[0][1] - L.start[0], L.enemies[0][2] - L.start[1])),
    startToNearestAnything: Math.round(Math.min(...nodes.filter(n => n[0] !== 'start').map(([, p]) => Math.hypot(p[0] - L.start[0], p[1] - L.start[1])))),
    enemies: L.enemies.length, walls: L.walls.length, hasBrief: Boolean(L.brief) });
}
note('p2-distances', rows);
for (const r of rows) log(r.id, `par=${r.parMoves}`, `greedyNoRefill=${r.movesNoRefill}`, `maxLeg=${r.maxLeg}`, `start->nearest=${r.startToNearestAnything}`, `enemies=${r.enemies}`, r.hasBrief ? 'BRIEF' : 'NO-BRIEF');

// ---------- B. brief overlay geometry on the live page ----------
const browser = await openBrowser();
const page = await newPage(browser);
const geo = await page.evaluate(() => {
  const app = document.querySelector('#app').getBoundingClientRect();
  const cv = document.querySelector('#game').getBoundingClientRect();
  const br = document.querySelector('#mission-brief').getBoundingClientRect();
  const cs = document.querySelector('#game') && getComputedStyle(document.querySelector('#game'));
  return { app: app.toJSON(), canvas: cv.toJSON(), canvasCss: { w: cs.width, h: cs.height }, brief: br.toJSON(), dpr: window.devicePixelRatio, innerH: window.innerHeight };
});
note('p2-geometry', geo);
log('GEOMETRY', JSON.stringify(geo));
await page.locator('#start-btn').tap();
const briefGeo = await page.evaluate(() => document.querySelector('#mission-brief').getBoundingClientRect().toJSON());
const cv = geo.canvas;
const toCanvas = (sx, sy) => ({ x: Math.round((sx - cv.x) / cv.width * 720), y: Math.round((sy - cv.y) / cv.height * 1280) });
log('BRIEF in canvas coords:', JSON.stringify({ top: toCanvas(briefGeo.x, briefGeo.y), bottom: toCanvas(briefGeo.x + briefGeo.width, briefGeo.y + briefGeo.height) }));
const s = await state(page);
log('L1 enemies:', JSON.stringify(s.enemies), 'player', JSON.stringify(s.player), 'chips', JSON.stringify(s.dataChips));
await snap(page, 'p2-01-brief-overlay');
await browser.close();

// ---------- C. non-chaining player: wait for full cooldown every time ----------
const b2 = await openBrowser();
const p2 = await newPage(b2);
await p2.locator('#start-btn').tap();
const waitLog = []; let cooldownFrames = 0; let totalFrames = 0; let blockedMs = 0;
const t0 = Date.now();
for (let i = 0; i < 40; i += 1) {
  const st = await state(p2);
  if (st.mode !== 'playing') break;
  if (!st.player.dashReady) { await step(p2, 50); blockedMs += 50; cooldownFrames += 1; continue; }
  // naive: aim at the next objective in a straight line, no chaining -- always wait out the cooldown
  const target = st.enemies[0] || st.dataChips[0] || st.portal;
  await touch(p2, target.x, target.y, 60);
  await step(p2, 30);
}
const st = await state(p2);
note('p2-nochain', { wallClockSec: ((Date.now() - t0) / 1000).toFixed(1), blockedMsTotal: blockedMs, finalMode: st.mode, moves: st.moves, hits: st.hits, hp: st.health, rating: st.rating, objective: st.objective });
log('NO-CHAIN RUN:', JSON.stringify({ wallSec: ((Date.now() - t0) / 1000).toFixed(1), waitedMs: blockedMs, mode: st.mode, moves: st.moves, hits: st.hits, hp: st.health, rating: st.rating }));
await browser.close();
