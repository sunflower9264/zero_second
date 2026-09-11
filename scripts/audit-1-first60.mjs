import { openBrowser, newPage, state, snap, visibleText, liveTouch, note, log } from './retention-audit.mjs';

const browser = await openBrowser();
const page = await newPage(browser, { realtime: true });
const t0 = Date.now();
const timeline = [];
const mark = (label, extra = {}) => {
  const rec = { t: ((Date.now() - t0) / 1000).toFixed(1), label, ...extra };
  timeline.push(rec); log(`[${rec.t}s] ${label}`, extra.note || '');
};

await snap(page, 'p1-00-title');
const titleText = await visibleText(page);
note('p1-title-text', titleText);
mark('page loaded, title screen visible');

// what a novice sees on the title, incl. computed sizes
const sizes = await page.evaluate(() => {
  const out = {};
  for (const sel of ['.control-card b', '.control-card small', '.pitch', '.primary-btn', '.text-btn', '.microcopy']) {
    const el = document.querySelector(sel); if (!el) continue;
    const cs = getComputedStyle(el);
    out[sel] = { text: el.textContent.trim(), fontSize: cs.fontSize, color: cs.color, rect: el.getBoundingClientRect().toJSON() };
  }
  return out;
});
note('p1-title-sizes', sizes);
log('TITLE SIZES', JSON.stringify(sizes, null, 1));

// read the title for ~6s like a human
await page.waitForTimeout(6000);
mark('read title for 6s');

await page.locator('#start-btn').tap();
await page.waitForTimeout(400);
await snap(page, 'p1-01-level1-intro');
const s0 = await state(page);
mark('tapped 开始行动 -> level 1', { mode: s0.mode, ready: s0.awaitingFirstTouch, player: s0.player, enemies: s0.enemies, objective: s0.objective, portal: s0.portal });
const brief = await page.evaluate(() => {
  const el = document.querySelector('#mission-brief');
  const cs = getComputedStyle(el);
  return { text: el.textContent, hidden: el.hidden, fontSize: cs.fontSize, rect: el.getBoundingClientRect().toJSON() };
});
note('p1-brief', brief);
log('BRIEF', JSON.stringify(brief, null, 1));

await page.waitForTimeout(4000);
mark('read mission brief for 4s');

// Novice does exactly what the brief says: hold, drag toward the red guard, release.
await liveTouch(page, 360, 1040, 900, { moveTo: [360, 700], slices: 6 });
const s1 = await state(page);
await snap(page, 'p1-02-after-first-dash');
mark('first dash (hold+drag up, release)', { mode: s1.mode, moves: s1.moves, hp: s1.health, objectives: s1.objective, player: s1.player, dashReady: s1.player.dashReady, cd: s1.player.dashCooldown, enemies: s1.enemies });
await page.waitForTimeout(700);
const s1b = await state(page);
mark('0.7s after first dash', { dashReady: s1b.player.dashReady, cd: s1b.player.dashCooldown, hp: s1b.health });

// Second dash: novice repeats the gesture toward the next guard / up the lane
await liveTouch(page, 360, 1000, 900, { moveTo: [360, 600], slices: 6 });
const s2 = await state(page);
await snap(page, 'p1-03-second-dash');
mark('second dash', { moves: s2.moves, hp: s2.health, objectives: s2.objective, player: s2.player, dashReady: s2.player.dashReady, cd: s2.player.dashCooldown });

await page.waitForTimeout(700);
// Third dash up toward the chip/portal
await liveTouch(page, 360, 900, 900, { moveTo: [360, 380], slices: 6 });
const s3 = await state(page);
await snap(page, 'p1-04-third-dash');
mark('third dash', { moves: s3.moves, hp: s3.health, objectives: s3.objective, player: s3.player, dashReady: s3.player.dashReady, portal: s3.portal });

// keep going with plain "wait for ready then tap toward target" behaviour
for (let i = 0; i < 6; i += 1) {
  const s = await state(page);
  if (s.mode !== 'playing') break;
  await liveTouch(page, 360, s.player.y - 200 > 140 ? s.player.y - 200 : s.player.y - 40, 250);
  await page.waitForTimeout(500);
}
const sEnd = await state(page);
await snap(page, 'p1-05-after-60s');
mark('end of ~60s window', { mode: sEnd.mode, moves: sEnd.moves, hp: sEnd.health, score: sEnd.score, objectives: sEnd.objective });

const resultText = await visibleText(page);
note('p1-end-text', resultText);
note('p1-timeline', timeline);
log('TIMELINE', JSON.stringify(timeline, null, 1));
log('END STATE', JSON.stringify(sEnd, null, 1));
log('ERRORS', page.__errors);
await browser.close();
