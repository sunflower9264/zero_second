import fs from 'node:fs';
import vm from 'node:vm';
import { CHAPTERS, LEVELS } from '../../src/levels.js';
import * as physics from '../../src/physics.js';
import * as progress from '../../src/progress.js';
import * as analytics from '../../src/analytics.js';
import * as constants from '../../src/constants.js';
import * as share from '../../src/share.js';

// Execute the actual game loop; only browser rendering/audio/storage are stubbed.
// Every module main.js imports must be spread in below, otherwise the sandbox sees `undefined`.
export function createRuntime({ storageBlocked = false, savedProgress, analyticsSink } = {}) {
  const context2d = new Proxy({}, { get: () => () => {} });
  const elements = new Map();
  const element = () => ({ style: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, appendChild() {},
    getContext: () => context2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 1280 }) });
  const store = new Map([['zero-second-muted', '1']]);
  if (savedProgress) store.set('zero-second-progress-v1', JSON.stringify(savedProgress));
  const collected = [];
  const sink = analyticsSink || (body => collected.push(body));
  const sandbox = {
    ...physics, ...progress, ...analytics, ...constants, ...share, CHAPTERS, LEVELS, console, performance: { now: () => 0 },
    document: { querySelector: key => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); }, createElement: element, addEventListener() {} },
    localStorage: { getItem: key => { if (storageBlocked) throw new Error('Storage blocked'); return store.get(key) ?? null; },
      setItem: (key, value) => { if (storageBlocked) throw new Error('Storage blocked'); store.set(key, value); } },
    matchMedia: () => ({ matches: false }), navigator: {}, requestAnimationFrame() {},
    window: { devicePixelRatio: 1, addEventListener() {}, __zsAnalyticsSink: sink },
  };
  const source = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n particlePool.length = 0; globalThis.game = { state, startAtLevel, restartFloor, continueResult, pauseGame, onPointerDown, onPointerUp, onPointerMove, cancelPointer, dashToward, planDash, collectItem, update, damagePlayer, finishFloor, renderGameToText, loadLevelData, startLevelData, cloneLevelData, activeLevel };`, sandbox);
  const game = sandbox.game;
  game.state.mute = true;
  game.state.progress.unlockedThrough = LEVELS.length;
  game.step = seconds => { for (let elapsed = 0; elapsed < seconds - 1e-8; elapsed += 1 / 60) game.update(1 / 60); };
  game.touch = (x, y, hold = .12) => {
    const event = { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y };
    game.onPointerDown(event); game.step(hold); game.onPointerUp(event);
  };
  game.events = () => collected.flatMap(body => { try { return JSON.parse(body).events; } catch { return []; } }).map(event => event.n);
  game.eventsNamed = name => collected.flatMap(body => { try { return JSON.parse(body).events; } catch { return []; } }).filter(event => event.n === name);
  return game;
}
