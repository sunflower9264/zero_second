import { openBrowser, newPage, state, step, snap, touch, note, log, visibleText } from './retention-audit.mjs';

// Deterministic pseudo-random so runs are reproducible.
let seed = 20260911;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const jitter = (amt) => (rnd() * 2 - 1) * amt;

// An "unskilled" policy: aim at the nearest live enemy (or nearest remaining objective),
// with imperfect aim, hold briefly, never deliberately chain kills.
async function unskilledRun(page, levelIndex, tag, { aimError = 55, holdMax = 900 } = {}) {
  await step(page, 60);
  let frames = 0; const deaths = [];
  let lastHp = 3;
  while (frames < 3600) { // up to 60s game time
    const s = await state(page);
    if (s.mode !== 'playing') break;
    if (s.health < lastHp) { deaths.push({ t: (frames / 60).toFixed(1), hp: s.health, player: s.player, enemiesLeft: s.objective.guardsRemaining }); lastHp = s.health; }
    if (!s.player.dashReady) { await step(page, 50); frames += 3; continue; }
    const cands = [...s.enemies.map(e => ({ x: e.x, y: e.y, kind: 'enemy' })),
      ...s.dataChips.map(c => ({ x: c.x, y: c.y, kind: 'chip' }))];
    if (s.portal.open) cands.push({ x: s.portal.x, y: s.portal.y, kind: 'portal' });
    let target = cands[0];
    if (target) {
      let bd = Infinity;
      for (const c of cands) { const d = Math.hypot(c.x - s.player.x, c.y - s.player.y); if (d < bd) { bd = d; target = c; } }
    }
    if (!target) break;
    const tx = target.x + jitter(aimError); const ty = target.y + jitter(aimError);
    await touch(page, tx, ty, 100 + rnd() * holdMax);
    await step(page, 60); frames += 8;
  }
  const s = await state(page);
  return { tag, mode: s.mode, moves: s.moves, hits: s.hits, hp: s.health, gameSeconds: (frames / 60).toFixed(1), deaths, rating: s.rating, objective: s.objective, attacksSurvived: s.objective.guardsRemaining };
}

const browser = await openBrowser();

async function runLevel(index, name, budgetAttempts) {
  const page = await newPage(browser, { unlocked: true });
  await page.locator('#title-select-btn').tap();
  await page.locator('.level-card').nth(index).tap();
  await snap(page, `p3-${name}-00-start`);
  const briefVisible = await page.evaluate(() => !document.querySelector('#mission-brief').hidden);
  const briefText = await page.evaluate(() => document.querySelector('#mission-brief').textContent);
  log(`--- ${name} (level ${index + 1}) briefVisible=${briefVisible} brief="${briefText}"`);
  const attempts = [];
  const started = Date.now();
  for (let a = 1; a <= budgetAttempts; a += 1) {
    const r = await unskilledRun(page, index, `attempt${a}`);
    attempts.push(r);
    log(`  attempt ${a}: ${r.mode} moves=${r.moves} hits=${r.hits} hp=${r.hp} gameTime=${r.gameSeconds}s deathsAt=${JSON.stringify(r.deaths)}`);
    if (r.mode === 'floorClear' || r.mode === 'victory') {
      await snap(page, `p3-${name}-clear`);
      break;
    }
    await snap(page, `p3-${name}-gameover-${a}`);
    if (a === 1) {
      const txt = await visibleText(page);
      note(`p3-${name}-gameover-text`, txt);
      const hint = await page.evaluate(() => ({
        kicker: document.querySelector('#result-kicker').textContent, title: document.querySelector('#result-title').textContent,
        stars: document.querySelector('#result-stars').textContent, hint: document.querySelector('#result-hint').textContent,
        stats: document.querySelector('#result-stats').textContent, cont: document.querySelector('#continue-btn').textContent,
        buttons: [...document.querySelectorAll('#result-screen button')].filter(b => b.offsetParent).map(b => b.textContent.trim()),
      }));
      note(`p3-${name}-gameover-hint`, hint);
      log(`  GAME OVER SCREEN: kicker="${hint.kicker}" title="${hint.title}" stars="${hint.stars}" hint="${hint.hint}" stats="${hint.stats}" cont="${hint.cont}"`);
      log(`  VISIBLE BUTTONS: ${JSON.stringify(hint.buttons)}`);
    }
    await page.locator('#continue-btn').tap();
    await step(page, 40);
  }
  const wall = ((Date.now() - started) / 1000).toFixed(0);
  const cleared = attempts.at(-1).mode === 'floorClear' || attempts.at(-1).mode === 'victory';
  note(`p3-${name}-summary`, { attempts: attempts.length, cleared, wallSeconds: wall, attempts });
  log(`  ${name} SUMMARY: attempts=${attempts.length} cleared=${cleared} wall=${wall}s`);
  await page.context().close();
  return { name, attempts: attempts.length, cleared, wall };
}

const r3 = await runLevel(2, 'f03', 6);
const r4 = await runLevel(3, 'f04', 6);
note('p3-overall', [r3, r4]);
await browser.close();
