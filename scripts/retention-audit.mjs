import fs from 'node:fs';
import { chromium, devices } from 'playwright';

const URL = process.env.GAME_URL || 'http://127.0.0.1:5199/';
const OUT = 'output/retention-audit';
fs.mkdirSync(OUT, { recursive: true });

export const log = (...a) => console.log(...a);
export function note(name, obj) { fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(obj, null, 2)); }

export async function openBrowser() { return chromium.launch({ headless: true }); }

export async function newPage(browser, { unlocked = false, viewport, realtime = false } = {}) {
  const context = await browser.newContext({
    ...devices['iPhone 13'], deviceScaleFactor: 1, ...(viewport ? { viewport } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (unlocked) await page.addInitScript(() => localStorage.setItem('zero-second-progress-v1', JSON.stringify({ version: 2, unlockedThrough: 20, levels: {} })));
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.advanceTime === 'function');
  if (!realtime) await page.evaluate(() => window.advanceTime(0));
  page.__errors = errors;
  return page;
}

// Real-time touch: no advanceTime, so the rAF loop drives the game.
export async function liveTouch(page, x, y, hold = 700, opts = {}) {
  const rect = await page.locator('#game').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const toScreen = (cx, cy) => ({ x: rect.x + cx / 720 * rect.width, y: rect.y + cy / 1280 * rect.height });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [toScreen(x, y)] });
  if (opts.moveTo) {
    const [mx, my] = opts.moveTo; const slices = opts.slices || 6;
    for (let i = 1; i <= slices; i += 1) {
      await page.waitForTimeout(hold / slices / 1000 ? hold / slices : 50);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [toScreen(x + (mx - x) * i / slices, y + (my - y) * i / slices)] });
    }
  } else if (hold > 0) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function state(page) { return page.evaluate(() => JSON.parse(window.render_game_to_text())); }
export async function step(page, ms) { return page.evaluate(ms => window.advanceTime(ms), ms); }

// Deterministic touch via CDP. hold = ms of game time to keep finger down.
// opts.moveTo = [x,y] to drag to before release. opts.stepMs = interval.
export async function touch(page, x, y, hold = 700, release = true, opts = {}) {
  const rect = await page.locator('#game').boundingBox();
  const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
  const toScreen = (cx, cy) => ({ x: rect.x + cx / 720 * rect.width, y: rect.y + cy / 1280 * rect.height });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [toScreen(x, y)] });
  if (opts.moveTo) {
    const [mx, my] = opts.moveTo;
    const slices = opts.slices || 6;
    for (let i = 1; i <= slices; i += 1) {
      const nx = x + (mx - x) * i / slices; const ny = y + (my - y) * i / slices;
      await step(page, hold / slices);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [toScreen(nx, ny)] });
    }
  } else {
    await step(page, hold);
  }
  if (release) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function snap(page, name) { await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' }); return name; }

export function dist(ax, ay, bx, by) { return Math.round(Math.hypot(bx - ax, by - ay) * 10) / 10; }

export function visibleText(page) {
  return page.evaluate(() => {
    const parts = [];
    for (const el of document.querySelectorAll('#app > *, #app section *')) {
      if (el.offsetParent === null && el.id !== 'app') continue;
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (own) parts.push({ id: el.id || null, cls: el.className || null, text: own, fontSize: getComputedStyle(el).fontSize, visible: el.offsetParent !== null || getComputedStyle(el).position === 'fixed' });
    }
    return parts;
  });
}
