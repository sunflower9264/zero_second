import './style.css';
import { CHAPTERS, LEVELS } from './levels.js';
import { circleOverlapsRect, isCirclePositionValid, nearestValidCirclePosition, safeCircleEndpoint, stopBeforeCircle } from './physics.js';
import { bestSingleLevelScore, calculateStars, createDefaultProgress, isRecordBetter, sanitizeProgress, totalStars } from './progress.js';
import { createTracker, newSessionId } from './analytics.js';
import { BOUNDS, COMBO_WINDOW, FIELD_BOTTOM, FIELD_TOP, H, MAX_DASH, PLAYER_R, TAU, W } from './constants.js';
import { buildShareText, shareOrCopy } from './share.js';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });

const COLORS = {
  paper: '#f3eddd', paper2: '#e7dfcf', ink: '#14213d', signal: '#ff4d36',
  cyan: '#16b9bb', green: '#20a96b', violet: '#7b61d1', yellow: '#ffc857', white: '#fffdf6',
};

const screens = {
  title: document.querySelector('#title-screen'),
  level: document.querySelector('#level-screen'),
  pause: document.querySelector('#pause-screen'),
  result: document.querySelector('#result-screen'),
};
const ui = {
  start: document.querySelector('#start-btn'), pause: document.querySelector('#pause-btn'), sound: document.querySelector('#sound-btn'),
  resume: document.querySelector('#resume-btn'), restart: document.querySelector('#restart-btn'), continue: document.querySelector('#continue-btn'),
  home: document.querySelector('#home-btn'), best: document.querySelector('#best-label'), resultKicker: document.querySelector('#result-kicker'),
  resultTitle: document.querySelector('#result-title'), resultStars: document.querySelector('#result-stars'), resultScore: document.querySelector('#result-score'), resultStats: document.querySelector('#result-stats'),
  levelGrid: document.querySelector('#level-grid'), totalStars: document.querySelector('#total-stars'), levelBack: document.querySelector('#level-back-btn'), pauseSelect: document.querySelector('#pause-select-btn'), replay: document.querySelector('#replay-btn'), select: document.querySelector('#select-btn'),
  share: document.querySelector('#share-btn'), progress: document.querySelector('#progress-label'),
};
const particlePool = Array.from({ length: 180 }, () => ({ active: false }));
let storageAvailable = true;
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { storageAvailable = false; return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { storageAvailable = false; }
}

function loadSessionId() {
  const stored = readStorage('zero-second-session');
  if (stored) return stored;
  const created = newSessionId();
  writeStorage('zero-second-session', created);
  return created;
}
// Tests and offline audits install a sink before the module evaluates; without one the tracker
// falls back to sendBeacon/fetch, which silently no-ops in Node and on blocked networks.
const analyticsSink = typeof window !== 'undefined' && typeof window.__zsAnalyticsSink === 'function' ? window.__zsAnalyticsSink : null;
const tracker = createTracker({
  sessionId: loadSessionId(),
  transport: analyticsSink ? body => { analyticsSink(body); return true; } : undefined,
});

const state = {
  mode: 'title', floor: 0, score: 0, hp: 3, armor: 0,
  player: { x: 360, y: 1080, vx: 0, vy: 0, invuln: 0 }, lastSafePlayer: { x: 360, y: 1080 },
  portal: { x: 360, y: 190, open: false }, enemies: [], chips: [], items: [], bullets: [], walls: [], trails: [], aiming: false, aimPointerId: null, aim: { x: 360, y: 800 },
  ready: true, queuedDash: null, dashCooldown: 0, wallContactGrace: 0, combo: 0, maxCombo: 0, comboTimer: 0,
  levelData: null, difficultyTier: 0, runMode: 'campaign', lastRating: null,
  elapsed: 0, realElapsed: 0, damageTally: {}, floorStartScore: 0, floorHits: 0, floorMoves: 0, kills: 0, trauma: 0, flash: 0, hitStop: 0,
  mute: readStorage('zero-second-muted') === '1',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, testMode: false,
};

function loadProgress() {
  try {
    const parsed = JSON.parse(readStorage('zero-second-progress-v1') || '');
    const progress = sanitizeProgress(parsed, LEVELS.map(level => level.id));
    for (const level of LEVELS) {
      const record = progress.levels[level.id];
      if (record) record.stars = calculateStars(level.parMoves, record.moves, record.hits);
    }
    return progress;
  } catch { return createDefaultProgress(); }
}
state.progress = loadProgress();

// Debug flag for spot-checking the campaign without replaying it: open any level link with
// ?unlock=all. Invisible to normal players and it only touches the local save.
if (typeof location !== 'undefined' && /[?&]unlock=all\b/.test(location.search)) {
  state.progress.unlockedThrough = LEVELS.length;
}

function saveProgress() { writeStorage('zero-second-progress-v1', JSON.stringify(state.progress)); }
function renderLevelSelect() {
  ui.totalStars.textContent = `★ ${totalStars(state.progress)} / ${LEVELS.length * 3}`;
  ui.levelGrid.innerHTML = '';
  // Chapter headings are placed from the declared sizes rather than a fixed stride, so the
  // hand-authored opening and the generated tail can be different lengths.
  const chapterStart = new Map();
  let cursor = 0;
  CHAPTERS.forEach((chapter, position) => { chapterStart.set(cursor, { name: chapter.name, number: position + 1 }); cursor += chapter.size; });
  LEVELS.forEach((level, index) => {
    const chapter = chapterStart.get(index);
    if (chapter) {
      const heading = document.createElement('h3'); heading.className = 'chapter-heading';
      heading.textContent = `${String(chapter.number).padStart(2, '0')}  ${chapter.name}`;
      ui.levelGrid.appendChild(heading);
    }
    const unlocked = index < state.progress.unlockedThrough;
    const record = state.progress.levels[level.id];
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'level-card'; card.disabled = !unlocked;
    card.setAttribute('aria-label', unlocked ? `${index + 1} ${level.name}` : `${index + 1} ${level.name}，已锁定`);
    card.innerHTML = unlocked ? `<span class="level-number">${String(index + 1).padStart(2, '0')}</span><span class="level-name">${level.name}</span><span class="level-stars">${'★'.repeat(record?.stars || 0)}${'☆'.repeat(3 - (record?.stars || 0))}</span>` : `<span class="level-number">${String(index + 1).padStart(2, '0')}</span><span class="level-lock">锁定</span><span class="level-stars">☆☆☆</span>`;
    if (unlocked) card.addEventListener('click', () => startAtLevel(index));
    ui.levelGrid.appendChild(card);
  });
}
function openLevelSelect() { state.mode = 'levelSelect'; state.aiming = false; state.aimPointerId = null; state.queuedDash = null; renderLevelSelect(); setVisibleScreen('level'); }
function startAtLevel(index) {
  if (index < 0 || index >= state.progress.unlockedThrough) return;
  state.runMode = 'campaign';
  state.floor = index; state.score = 0; state.hp = 3; state.kills = 0; state.maxCombo = 0; cloneLevel(index); state.mode = 'playing'; setVisibleScreen(); sfx('start');
  tracker.track('level_start', { levelId: LEVELS[index].id, index });
}

let audioCtx = null;
let lastFrame = performance.now();
let dpr = 1;

// `state.levelData` is the level actually being played: a LEVELS entry during the campaign, or a
// candidate handed in by the offline generator. `activeLevel()` is the only reader.
function activeLevel() { return state.levelData || LEVELS[state.floor]; }

function cloneLevelData(data) {
  state.levelData = data;
  // Enemy speed and turret cadence scale with this. It follows the level's *authored* difficulty,
  // not its index: the campaign is a sawtooth (each chapter opens easier than the last one ended),
  // while an index is monotonic — which handed the F05 and F09 teaching levels the fastest enemies
  // in the game so far. Index remains the fallback for data that carries no difficulty.
  state.difficultyTier = Number.isFinite(data.difficultyTier) ? data.difficultyTier
    : Number.isFinite(data.difficulty) ? (data.difficulty - 1) * 4.2
      : state.floor;
  state.walls = data.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
  if (!isCirclePositionValid(data.start[0], data.start[1], PLAYER_R, state.walls, BOUNDS)) {
    throw new Error(`Invalid player start in ${data.id}`);
  }
  state.player.x = data.start[0]; state.player.y = data.start[1]; state.player.vx = 0; state.player.vy = 0; state.player.invuln = 0;
  state.lastSafePlayer = { x: state.player.x, y: state.player.y };
  state.portal = { x: data.portal[0], y: data.portal[1], open: false };
  state.chips = data.chips.map(([x, y], id) => ({ id, x, y, collected: false, spin: id * 1.2 }));
  state.items = data.items.map(([type, x, y], id) => ({ id, type, x, y, collected: false, spin: id * 1.7 }));
  state.enemies = data.enemies.map(([type, x, y], id) => ({
    id, type, x, y, r: type === 'armored' ? 27 : 23, hp: type === 'armored' ? 2 : 1,
    maxHp: type === 'armored' ? 2 : 1, fire: .95 + id * .23, lockedAim: null, phase: id * 1.7, dead: false, hurt: 0,
  }));
  state.bullets = []; state.trails = []; state.aiming = false; state.aimPointerId = null; state.dashCooldown = 0; state.wallContactGrace = 0; state.combo = 0; state.comboTimer = 0;
  state.elapsed = 0; state.realElapsed = 0; state.damageTally = {}; state.floorHits = 0; state.floorMoves = 0; state.armor = 0; state.floorStartScore = state.score; state.trauma = 0; state.flash = 0;
  state.ready = true; state.queuedDash = null; state.hitStop = 0;
  for (const particle of particlePool) particle.active = false;
  document.querySelector('#mission-brief').textContent = data.brief || '';
}
function cloneLevel(index) { state.levelData = null; cloneLevelData(LEVELS[index]); }
// Pure data load: swaps the level in without touching the screen or the run state.
function loadLevelData(data) { cloneLevelData(data); return data; }
// Full transition into a level that has no place in the campaign list (generated pools).
function startLevelData(data, runMode = 'scratch') {
  state.runMode = runMode; state.floor = 0;
  state.score = 0; state.hp = 3; state.kills = 0; state.maxCombo = 0;
  cloneLevelData(data);
  state.mode = 'playing'; setVisibleScreen(); sfx('start');
  return true;
}

function setVisibleScreen(name = null) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('is-visible', key === name));
  ui.pause.style.display = state.mode === 'playing' ? '' : 'none';
  document.querySelector('#mission-brief').hidden = state.mode !== 'playing' || !state.ready || !activeLevel().brief;
}

function restartFloor() {
  state.score = state.floorStartScore; state.hp = 3; cloneLevelData(activeLevel()); state.mode = 'playing'; setVisibleScreen(); sfx('start');
}

function refreshTitle() {
  const cleared = Object.keys(state.progress.levels).length;
  ui.start.innerHTML = state.progress.unlockedThrough > 1 ? '继续行动 <span>↗</span>' : '开始行动 <span>↗</span>';
  ui.best.textContent = `最佳单关 ${String(bestSingleLevelScore(state.progress)).padStart(6, '0')}`;
  ui.progress.textContent = `已通关 ${cleared} / ${LEVELS.length}  ·  星 ${totalStars(state.progress)} / ${LEVELS.length * 3}`;
}
function goHome() {
  state.mode = 'title'; state.floor = 0; state.runMode = 'campaign'; cloneLevel(0);
  refreshTitle(); setVisibleScreen('title');
}

function pauseGame(force) {
  if (state.mode !== 'playing' && state.mode !== 'paused') return;
  const shouldPause = force ?? state.mode === 'playing';
  state.mode = shouldPause ? 'paused' : 'playing'; state.aiming = false; state.aimPointerId = null; state.queuedDash = null; setVisibleScreen(shouldPause ? 'pause' : null);
  if (!shouldPause) lastFrame = performance.now();
}

const CAUSE_LABEL = { turret: '炮塔', hunter: '猎手', armored: '重甲', unknown: '不明来源' };
const CAUSE_TIP = {
  turret: '炮塔开火前会锁定方向并画出红色虚线，绕到墙后就能挡住子弹。',
  hunter: '猎手会一路追着你。击破它会立刻刷新冲刺，别停在它面前。',
  armored: '重甲要打两次，第一次会把你弹回标记落点，恢复后再补一下。',
  unknown: '按住可放慢时间。观察火线，击破或拾取数据后立即接力。',
};
function dominantCause() {
  const entries = Object.entries(state.damageTally);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}
function deathSummary() {
  const entries = Object.entries(state.damageTally).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '本关没有受伤记录。';
  return `死因：${entries.map(([cause, count]) => `${CAUSE_LABEL[cause] || cause}击中 ${count} 次`).join(' · ')}`;
}
function deathTip() { return CAUSE_TIP[dominantCause()] || CAUSE_TIP.unknown; }

// Draws the score card used as the share image. Returns null wherever canvas encoding is
// unavailable (the node sandbox, or a browser that blocks toBlob), and the share falls back to text.
function renderShareCard() {
  try {
    const card = document.createElement('canvas');
    if (!card || typeof card.toBlob !== 'function') return Promise.resolve(null);
    const rating = state.lastRating || { stars: 1 };
    card.width = 720; card.height = 900;
    const c = card.getContext('2d');
    c.fillStyle = COLORS.paper; c.fillRect(0, 0, 720, 900);
    c.strokeStyle = 'rgba(20,33,61,.065)'; c.lineWidth = 1;
    for (let x = 0; x <= 720; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 900); c.stroke(); }
    for (let y = 0; y <= 900; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(720, y); c.stroke(); }
    c.fillStyle = COLORS.ink; c.font = '900 40px system-ui'; c.textAlign = 'left';
    c.fillText('零秒特工', 56, 96);
    c.fillStyle = COLORS.signal; c.font = '800 24px system-ui'; c.fillText('ZERO SECOND', 56, 132);
    c.fillStyle = 'rgba(20,33,61,.6)'; c.font = '700 26px system-ui';
    c.fillText(activeLevel().name, 56, 214);
    c.fillStyle = COLORS.signal; c.font = '900 96px system-ui';
    c.fillText(`${'★'.repeat(rating.stars)}${'☆'.repeat(3 - rating.stars)}`, 50, 340);
    c.fillStyle = COLORS.signal; c.font = '900 132px "Arial Narrow", system-ui';
    c.fillText(String(state.score).padStart(6, '0'), 50, 500);
    c.fillStyle = COLORS.ink; c.font = '800 30px system-ui';
    const rows = [
      [`${state.floorMoves} / ${activeLevel().parMoves}`, '移动 / 目标'],
      [state.floorHits === 0 ? '无伤' : `${state.floorHits} 次`, '受伤'],
      [`${state.maxCombo}×`, '最高连击'],
      [`${state.realElapsed.toFixed(1)}s`, '用时'],
    ];
    rows.forEach(([value, label], index) => {
      const y = 600 + index * 62;
      c.fillStyle = COLORS.ink; c.font = '900 34px system-ui'; c.fillText(value, 56, y);
      c.fillStyle = 'rgba(20,33,61,.55)'; c.font = '700 24px system-ui'; c.fillText(label, 280, y);
    });
    return new Promise(resolve => card.toBlob(blob => {
      if (!blob || typeof File !== 'function') { resolve(null); return; }
      resolve(new File([blob], 'zero-second.png', { type: 'image/png' }));
    }, 'image/png'));
  } catch { return Promise.resolve(null); }
}

async function shareResult() {
  const level = activeLevel();
  const text = buildShareText({
    levelName: level.name, stars: state.lastRating?.stars ?? 1, moves: state.floorMoves, par: level.parMoves,
    hits: state.floorHits, maxCombo: state.maxCombo, seconds: state.realElapsed, score: state.score,
  });
  ui.share.textContent = '准备中…';
  const file = await renderShareCard();
  const outcome = await shareOrCopy({ text, file });
  if (outcome === 'manual') { document.querySelector('#result-hint').textContent = text; ui.share.textContent = '长按上方文字复制'; return; }
  ui.share.textContent = outcome === 'copied' ? '已复制，去粘贴分享' : '分享成绩';
}

function showResult(kind) {
  const floorScore = state.score - state.floorStartScore;
  state.mode = kind; state.aiming = false; state.aimPointerId = null; state.queuedDash = null;
  const isClear = kind === 'floorClear'; const isVictory = kind === 'victory';
  ui.resultKicker.textContent = isVictory ? 'MISSION COMPLETE' : isClear ? 'FLOOR SECURED' : 'SIGNAL LOST';
  ui.resultTitle.textContent = isVictory ? '核心已夺取' : isClear ? '楼层净空' : '行动终止';
  ui.resultStars.textContent = isClear || isVictory ? `${'★'.repeat(state.lastRating.stars)}${'☆'.repeat(3 - state.lastRating.stars)}` : '任务失败';
  ui.resultScore.textContent = String(state.score).padStart(6, '0');
  ui.resultStats.innerHTML = [
    [isClear || isVictory ? `${state.floorMoves}/${activeLevel().parMoves}` : state.floorMoves, isClear || isVictory ? '移动/目标' : '移动'],
    [state.floorHits, '受伤'], [isClear || isVictory ? floorScore : state.kills, isClear || isVictory ? '本层得分' : '击破'],
  ].map(([value, label]) => `<div class="stat"><b>${value}</b><small>${label}</small></div>`).join('');
  const continueLabel = isVictory ? '选择关卡' : kind === 'gameOver' ? '重试本关' : '进入下一层';
  ui.continue.innerHTML = `${continueLabel} <span>↗</span>`;
  ui.replay.style.display = isClear || isVictory ? '' : 'none';
  ui.share.style.display = isClear || isVictory ? '' : 'none';
  ui.share.textContent = '分享成绩';
  ui.select.style.display = isVictory ? 'none' : '';
  document.querySelector('#result-hint').innerHTML = isClear || isVictory
    ? `${state.floorMoves <= activeLevel().parMoves ? '✓' : '○'} ${activeLevel().parMoves} 步内通关  ·  ${state.floorHits === 0 ? '✓' : '○'} 全程无伤<br>${state.maxCombo > 1 ? `最高连击 ${state.maxCombo}×` : '本关没有连击'} · 用时 ${state.realElapsed.toFixed(1)} 秒`
    : `${deathSummary()}<br>${deathTip()}`;
  document.querySelector('#storage-note').hidden = storageAvailable;
  setVisibleScreen('result');
}

function finishFloor() {
  const data = activeLevel();
  const moveBonus = Math.max(0, data.parMoves - state.floorMoves) * 150;
  state.score += 700 + moveBonus + state.hp * 250;
  const floorScore = state.score - state.floorStartScore;
  const rating = { stars: calculateStars(data.parMoves, state.floorMoves, state.floorHits), moves: state.floorMoves, hits: state.floorHits, bestScore: 0 };
  // Every level now lives in the one campaign list, so a clear always writes progress. The
  // generator runs against 'scratch' levels that have no slot, and those are skipped.
  if (state.runMode === 'campaign') {
    const previous = state.progress.levels[data.id];
    rating.bestScore = Math.max(previous?.bestScore || 0, floorScore);
    state.progress.levels[data.id] = isRecordBetter(rating, previous) ? rating : { ...previous, bestScore: rating.bestScore };
    state.progress.unlockedThrough = Math.min(LEVELS.length, Math.max(state.progress.unlockedThrough, state.floor + 2));
  }
  state.lastRating = rating; saveProgress();
  const isFinal = state.runMode === 'campaign' && state.floor === LEVELS.length - 1;
  tracker.track('level_end', {
    outcome: isFinal ? 'victory' : 'clear', levelId: data.id, mode: state.runMode, moves: state.floorMoves, par: data.parMoves,
    hits: state.floorHits, stars: rating.stars, bestScore: rating.bestScore, maxCombo: state.maxCombo, floorScore, realMs: Math.round(state.realElapsed * 1000),
  });
  tracker.flush('levelClear');
  burst(state.portal.x, state.portal.y, COLORS.cyan, 34, 320); state.flash = state.reducedMotion ? 0 : .28;
  state.trauma = state.reducedMotion ? 0 : .75; sfx('clear');
  showResult(isFinal ? 'victory' : 'floorClear');
}

function continueResult() {
  if (state.mode === 'floorClear') {
    if (state.floor + 1 >= LEVELS.length) { goHome(); return; }
    state.floor += 1; state.hp = Math.min(3, state.hp + 1); cloneLevel(state.floor); state.mode = 'playing'; setVisibleScreen(); sfx('start');
  } else if (state.mode === 'gameOver') restartFloor();
  else openLevelSelect();
}

function gameOver() {
  tracker.track('death', { levelId: activeLevel().id, cause: dominantCause() || 'unknown', tally: state.damageTally, moves: state.floorMoves, guardsLeft: state.enemies.filter(enemy => !enemy.dead).length, dataLeft: state.chips.filter(chip => !chip.collected).length });
  tracker.track('level_end', { outcome: 'gameOver', levelId: activeLevel().id, moves: state.floorMoves, hits: state.floorHits, kills: state.kills, realMs: Math.round(state.realElapsed * 1000) });
  tracker.flush('gameOver');
  sfx('fail'); showResult('gameOver');
}

function unlockAudio() {
  if (state.mute || !(window.AudioContext || window.webkitAudioContext)) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function tone(frequency, duration, type = 'sine', volume = .06, delay = 0) {
  if (state.mute || !audioCtx) return;
  const at = audioCtx.currentTime + delay; const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(frequency, at); gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(.001, at + duration); osc.connect(gain).connect(audioCtx.destination); osc.start(at); osc.stop(at + duration);
}

function sfx(name) {
  if (state.mute) return; unlockAudio();
  if (name === 'dash') { tone(180, .09, 'sawtooth', .045); tone(520, .07, 'square', .025, .025); }
  if (name === 'hit') { tone(92, .16, 'square', .07); tone(55, .2, 'sawtooth', .045); }
  if (name === 'kill') { tone(260 + state.combo * 24, .1, 'square', .04); tone(620 + state.combo * 30, .13, 'sine', .055, .035); }
  if (name === 'chip') { tone(720, .08, 'sine', .045); tone(980, .16, 'sine', .04, .06); }
  if (name === 'start') { tone(180, .08, 'square', .035); tone(360, .12, 'square', .035, .08); }
  if (name === 'clear') [330, 440, 660, 880].forEach((f, i) => tone(f, .3, 'sine', .045, i * .07));
  if (name === 'fail') [180, 140, 90].forEach((f, i) => tone(f, .24, 'sawtooth', .035, i * .1));
  if (name === 'blocked') { tone(118, .11, 'square', .038); tone(86, .09, 'sawtooth', .028, .025); }
}

function resizeCanvas() {
  if (matchMedia('(orientation: landscape) and (pointer: coarse)').matches) pauseGame(true);
  dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); render();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * W, y: (event.clientY - rect.top) / rect.height * H };
}

function canAim() { return state.mode === 'playing' && state.dashCooldown <= 0 && state.hitStop <= 0; }
function onPointerDown(event) {
  if (event.pointerType !== 'touch' || state.aimPointerId !== null || state.mode !== 'playing') return;
  state.ready = false; state.queuedDash = null; document.querySelector('#mission-brief').hidden = true;
  unlockAudio(); state.aiming = true; state.aimPointerId = event.pointerId; state.aim = pointerPosition(event);
  try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Synthetic touch events may not have an active capture target. */ }
}
function onPointerMove(event) { if (state.aiming && event.pointerId === state.aimPointerId) state.aim = pointerPosition(event); }
function onPointerUp(event) {
  if (!state.aiming || event.pointerId !== state.aimPointerId) return;
  state.aim = pointerPosition(event); state.aiming = false; state.aimPointerId = null;
  if (canAim()) dashToward(state.aim.x, state.aim.y);
  else state.queuedDash = { ...state.aim };
}

function playerOverlapsWall() {
  return !isCirclePositionValid(state.player.x, state.player.y, PLAYER_R, state.walls, BOUNDS);
}

function ensurePlayerPositionValid() {
  if (!playerOverlapsWall()) {
    state.lastSafePlayer.x = state.player.x;
    state.lastSafePlayer.y = state.player.y;
    return true;
  }
  if (isCirclePositionValid(state.lastSafePlayer.x, state.lastSafePlayer.y, PLAYER_R, state.walls, BOUNDS)) {
    state.player.x = state.lastSafePlayer.x;
    state.player.y = state.lastSafePlayer.y;
    return false;
  }
  const recovered = nearestValidCirclePosition(state.player.x, state.player.y, PLAYER_R, state.walls, BOUNDS);
  if (!recovered) throw new Error(`Unable to recover player position in ${activeLevel().id}`);
  state.player.x = recovered.x;
  state.player.y = recovered.y;
  state.lastSafePlayer = { ...recovered };
  return false;
}

function movePlayerSafely(targetX, targetY) {
  ensurePlayerPositionValid();
  const end = safeCircleEndpoint(state.player.x, state.player.y, targetX, targetY, PLAYER_R, state.walls, BOUNDS);
  state.player.x = end.x;
  state.player.y = end.y;
  state.lastSafePlayer.x = end.x;
  state.lastSafePlayer.y = end.y;
  return end;
}

function dashEndpoint(targetX, targetY) {
  const sx = state.player.x; const sy = state.player.y; let dx = targetX - sx; let dy = targetY - sy; const len = Math.hypot(dx, dy);
  if (len < 8) return { x: sx, y: sy, blocked: false };
  const distance = Math.min(MAX_DASH, len); dx /= len; dy /= len;
  return safeCircleEndpoint(sx, sy, sx + dx * distance, sy + dy * distance, PLAYER_R, state.walls, BOUNDS);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax; const aby = by - ay; const denom = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / denom));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function planDash(targetX, targetY) {
  const { x: sx, y: sy } = state.player;
  const end = dashEndpoint(targetX, targetY);
  const hits = state.enemies.filter(enemy => !enemy.dead && pointSegmentDistance(enemy.x, enemy.y, sx, sy, end.x, end.y) <= enemy.r + 13);
  let landing = end;
  for (const enemy of hits) {
    if (enemy.hp <= 1) continue;
    const recoil = stopBeforeCircle(sx, sy, end.x, end.y, enemy.x, enemy.y, enemy.r + PLAYER_R + 26);
    if (Math.hypot(recoil.x - sx, recoil.y - sy) < Math.hypot(landing.x - sx, landing.y - sy)) landing = recoil;
  }
  const rejected = Math.hypot(end.x - sx, end.y - sy) < 8;
  return { end, landing, hits, rejected, jammed: rejected && end.blocked };
}

function dashToward(targetX, targetY) {
  if (!canAim()) return;
  const sx = state.player.x; const sy = state.player.y; const { end, landing, hits, jammed } = planDash(targetX, targetY);
  if (jammed) {
    sfx('blocked'); navigator.vibrate?.(12);
    state.trauma = state.reducedMotion ? 0 : Math.max(state.trauma, .2);
    burst(sx, sy, COLORS.signal, 7, 90);
    return;
  }
  if (Math.hypot(end.x - sx, end.y - sy) < 8) return;
  state.floorMoves += 1;
  if (state.floorMoves === 1) tracker.track('first_dash', { levelId: activeLevel().id, sinceStartMs: Math.round(state.realElapsed * 1000), hits: hits.length });
  state.trails.push({ ax: sx, ay: sy, bx: end.x, by: end.y, life: .22, max: .22 });
  if (state.trails.length > 12) state.trails.shift();
  movePlayerSafely(end.x, end.y); state.dashCooldown = .64;
  let defeats = 0;
  for (const enemy of hits) {
    enemy.hp -= 1; enemy.hurt = .2; burst(enemy.x, enemy.y, enemy.hp <= 0 ? COLORS.signal : COLORS.yellow, enemy.hp <= 0 ? 18 : 10, 240);
    if (enemy.hp <= 0) {
      enemy.dead = true; defeats += 1; state.kills += 1; state.combo += 1; state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.comboTimer = COMBO_WINDOW; state.score += 100 * state.combo; sfx('kill');
    } else {
      state.score += 30; sfx('hit');
    }
  }
  movePlayerSafely(landing.x, landing.y);
  for (const chip of state.chips) if (!chip.collected && pointSegmentDistance(chip.x, chip.y, sx, sy, end.x, end.y) < 35) collectChip(chip);
  for (const item of state.items) if (!item.collected && pointSegmentDistance(item.x, item.y, sx, sy, end.x, end.y) < 34) collectItem(item);
  if (defeats > 0) {
    state.dashCooldown = 0; state.hitStop = state.reducedMotion ? 0 : Math.min(.065, .025 + defeats * .012);
    state.trauma = state.reducedMotion ? 0 : Math.min(1, state.trauma + .24 + defeats * .08);
    navigator.vibrate?.(defeats > 1 ? [18, 22, 25] : 16);
  } else sfx('dash');
  if (end.blocked) { state.wallContactGrace = Math.max(state.wallContactGrace, state.dashCooldown + .08); state.trauma = state.reducedMotion ? 0 : Math.max(state.trauma, .18); burst(end.x, end.y, COLORS.ink, 5, 100); }
  refreshPortal();
  if (state.portal.open && Math.hypot(state.player.x - state.portal.x, state.player.y - state.portal.y) < 62) finishFloor();
}

function collectChip(chip) {
  chip.collected = true; state.score += 220; state.dashCooldown = 0; burst(chip.x, chip.y, COLORS.cyan, 14, 180); sfx('chip');
}
function collectItem(item) {
  item.collected = true; state.score += 160; state.dashCooldown = 0;
  if (item.type === 'shield') state.armor = 1;
  if (item.type === 'medkit') state.hp = Math.min(3, state.hp + 1);
  if (item.type === 'jammer') {
    state.bullets = [];
    for (const enemy of state.enemies) if (!enemy.dead && enemy.type === 'turret') { enemy.fire += 1.6; enemy.lockedAim = null; }
  }
  burst(item.x, item.y, item.type === 'medkit' ? COLORS.green : item.type === 'jammer' ? COLORS.violet : COLORS.cyan, 18, 200); sfx('chip');
}
function refreshPortal() { state.portal.open = state.enemies.every(enemy => enemy.dead) && state.chips.every(chip => chip.collected); }

function spawnBullet(enemy) {
  const target = enemy.lockedAim || state.player;
  const dx = target.x - enemy.x; const dy = target.y - enemy.y; const len = Math.hypot(dx, dy) || 1;
  state.bullets.push({ x: enemy.x, y: enemy.y, vx: dx / len * 265, vy: dy / len * 265, life: 4 });
  if (state.bullets.length > 50) state.bullets.shift(); tone(110, .1, 'square', .018);
}

function damagePlayer(sourceX, sourceY, cause = 'unknown') {
  if (state.player.invuln > 0 || state.mode !== 'playing') return;
  if (state.armor > 0) {
    state.armor = 0; state.player.invuln = .45; burst(state.player.x, state.player.y, COLORS.yellow, 20, 220); sfx('chip');
    return;
  }
  state.damageTally[cause] = (state.damageTally[cause] || 0) + 1;
  state.hp -= 1; state.floorHits += 1; state.player.invuln = 1.05; state.combo = 0; state.comboTimer = 0;
  state.trauma = state.reducedMotion ? 0 : .9; state.flash = state.reducedMotion ? 0 : .18;
  const dx = state.player.x - sourceX; const dy = state.player.y - sourceY; const len = Math.hypot(dx, dy) || 1;
  movePlayerSafely(state.player.x + dx / len * 34, state.player.y + dy / len * 34);
  burst(state.player.x, state.player.y, COLORS.signal, 24, 260); navigator.vibrate?.([35, 25, 35]); sfx('hit');
  if (state.hp <= 0) gameOver();
}

function burst(x, y, color, count, speed) {
  let made = 0;
  for (const p of particlePool) {
    if (p.active) continue;
    const angle = Math.random() * TAU; const force = speed * (.35 + Math.random() * .65);
    Object.assign(p, { active: true, x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, life: .28 + Math.random() * .3, color, size: 3 + Math.random() * 7 });
    p.max = p.life; if (++made >= count) break;
  }
}

function update(dt) {
  dt = Math.min(dt, .05);
  if (state.mode !== 'playing' || state.ready) { updateEffects(dt); return; }
  if (state.hitStop > 0) { state.hitStop = Math.max(0, state.hitStop - dt); updateEffects(dt); return; }
  const worldDt = dt * (state.aiming ? .14 : 1);
  state.elapsed += worldDt; state.realElapsed += dt; state.dashCooldown = Math.max(0, state.dashCooldown - dt); state.wallContactGrace = Math.max(0, state.wallContactGrace - worldDt);
  if (state.queuedDash && canAim()) {
    const target = state.queuedDash; state.queuedDash = null; dashToward(target.x, target.y);
    if (state.mode !== 'playing' || state.hitStop > 0) return;
  }
  state.player.invuln = Math.max(0, state.player.invuln - worldDt);
  // Real time, not world time: holding to aim must not freeze the chain. This is what gives the
  // player something to commit to — you can still think as long as you like, but every second of
  // thinking is a second closer to dropping the chain.
  if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer <= 0) state.combo = 0; }
  for (const chip of state.chips) chip.spin += worldDt * 2.4;
  for (const item of state.items) item.spin += worldDt * 2.1;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    enemy.phase += worldDt; enemy.hurt = Math.max(0, enemy.hurt - worldDt);
    if (enemy.type === 'turret') {
      enemy.fire -= worldDt;
      if (enemy.fire <= .45 && !enemy.lockedAim) enemy.lockedAim = { x: state.player.x, y: state.player.y };
      if (enemy.fire <= 0) { spawnBullet(enemy); enemy.fire = Math.max(.95, 1.9 - state.difficultyTier * .05); enemy.lockedAim = null; }
    } else {
      const dx = state.player.x - enemy.x; const dy = state.player.y - enemy.y; const len = Math.hypot(dx, dy) || 1;
      const speed = enemy.type === 'armored' ? 28 : 43 + state.difficultyTier * 2;
      const nx = enemy.x + dx / len * speed * worldDt; const ny = enemy.y + dy / len * speed * worldDt;
      if (!state.walls.some(w => circleOverlapsRect(nx, ny, enemy.r, w))) { enemy.x = nx; enemy.y = ny; }
      if (len < enemy.r + PLAYER_R + 2 && state.wallContactGrace <= 0) damagePlayer(enemy.x, enemy.y, enemy.type);
    }
  }
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const b = state.bullets[i]; b.x += b.vx * worldDt; b.y += b.vy * worldDt; b.life -= worldDt;
    const hitWall = state.walls.some(w => circleOverlapsRect(b.x, b.y, 5, w));
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < FIELD_TOP - 20 || b.y > FIELD_BOTTOM + 20 || hitWall) state.bullets.splice(i, 1);
    else if (Math.hypot(b.x - state.player.x, b.y - state.player.y) < PLAYER_R + 7) { state.bullets.splice(i, 1); damagePlayer(b.x, b.y, 'turret'); }
  }
  ensurePlayerPositionValid();
  if (state.mode === 'playing' && state.portal.open && Math.hypot(state.player.x - state.portal.x, state.player.y - state.portal.y) < 54) finishFloor();
  updateEffects(dt);
}

function updateEffects(dt) {
  state.trauma = Math.max(0, state.trauma - dt * 1.8); state.flash = Math.max(0, state.flash - dt * 2.5);
  for (const trail of state.trails) trail.life -= dt; state.trails = state.trails.filter(t => t.life > 0);
  for (const p of particlePool) {
    if (!p.active) continue; p.life -= dt; if (p.life <= 0) { p.active = false; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(.03, dt); p.vy *= Math.pow(.03, dt);
  }
}

function roundedRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawBackground(time) {
  ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = 'rgba(20,33,61,.065)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.fillStyle = 'rgba(22,185,187,.07)'; ctx.beginPath(); ctx.arc(100 + Math.sin(time * .0004) * 25, 250, 170, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,77,54,.06)'; ctx.beginPath(); ctx.arc(660, 940 + Math.cos(time * .0005) * 35, 220, 0, TAU); ctx.fill();
}

function drawWalls() {
  for (const wall of state.walls) {
    ctx.fillStyle = COLORS.ink; roundedRect(wall.x, wall.y, wall.w, wall.h, 12); ctx.fill(); ctx.save();
    roundedRect(wall.x + 6, wall.y + 6, wall.w - 12, wall.h - 12, 7); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 5;
    for (let x = wall.x - wall.h; x < wall.x + wall.w + wall.h; x += 28) { ctx.beginPath(); ctx.moveTo(x, wall.y + wall.h); ctx.lineTo(x + wall.h, wall.y); ctx.stroke(); }
    ctx.restore();
  }
}

function drawPortal(time) {
  const p = state.portal; const pulse = 1 + Math.sin(time * .006) * .06; ctx.save(); ctx.translate(p.x, p.y); ctx.scale(pulse, pulse);
  ctx.lineWidth = 9; ctx.strokeStyle = p.open ? COLORS.cyan : 'rgba(20,33,61,.28)'; ctx.beginPath(); ctx.arc(0, 0, 38, Math.PI, 0);
  ctx.lineTo(38, 42); ctx.moveTo(-38, 42); ctx.lineTo(-38, 0); ctx.stroke(); ctx.fillStyle = p.open ? 'rgba(22,185,187,.18)' : 'rgba(20,33,61,.06)'; ctx.fillRect(-34, 0, 68, 42);
  if (!p.open) { ctx.fillStyle = COLORS.ink; roundedRect(-10, 12, 20, 21, 4); ctx.fill(); ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 11, 8, Math.PI, 0); ctx.stroke(); }
  ctx.restore();
}

function drawChip(chip) {
  if (chip.collected) return; ctx.save(); ctx.translate(chip.x, chip.y); ctx.rotate(chip.spin); ctx.fillStyle = COLORS.cyan; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.rect(-16, -16, 32, 32); ctx.fill(); ctx.stroke(); ctx.fillStyle = COLORS.white; ctx.fillRect(-5, -11, 10, 22); ctx.restore();
}

function drawItem(item, time) {
  if (item.collected) return;
  const color = item.type === 'medkit' ? COLORS.green : item.type === 'jammer' ? COLORS.violet : COLORS.cyan;
  const pulse = 28 + Math.sin(time * .007 + item.spin) * 3;
  ctx.save(); ctx.translate(item.x, item.y + Math.sin(time * .005 + item.spin) * 4);
  ctx.strokeStyle = color; ctx.globalAlpha = .34; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, pulse, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillStyle = COLORS.white; ctx.strokeStyle = color; ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) { const a = i / 6 * TAU - Math.PI / 2; ctx.lineTo(Math.cos(a) * 21, Math.sin(a) * 21); }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath();
  if (item.type === 'medkit') { ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.moveTo(0, -9); ctx.lineTo(0, 9); }
  else if (item.type === 'jammer') { ctx.arc(0, 0, 8, -.8, .8); ctx.moveTo(-4, -10); ctx.lineTo(8, 0); ctx.lineTo(-4, 10); }
  else { ctx.moveTo(-9, -5); ctx.lineTo(0, -11); ctx.lineTo(9, -5); ctx.lineTo(7, 7); ctx.lineTo(0, 12); ctx.lineTo(-7, 7); ctx.closePath(); }
  ctx.stroke(); ctx.restore();
}

function drawEnemy(enemy, time) {
  if (enemy.dead) return; const flash = enemy.hurt > 0; ctx.save(); ctx.translate(enemy.x, enemy.y); ctx.translate(0, Math.sin(time * .004 + enemy.phase) * 3);
  ctx.shadowColor = 'rgba(255,77,54,.35)'; ctx.shadowBlur = 14; ctx.fillStyle = flash ? COLORS.white : enemy.type === 'armored' ? COLORS.yellow : COLORS.signal;
  ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 5;
  if (enemy.type === 'turret') {
    const target = enemy.lockedAim || state.player;
    ctx.rotate(Math.atan2(target.y - enemy.y, target.x - enemy.x)); ctx.beginPath(); ctx.rect(-22, -22, 44, 44); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLORS.ink; ctx.fillRect(4, -6, 28, 12); ctx.fillStyle = COLORS.white; ctx.beginPath(); ctx.arc(-5, 0, 6, 0, TAU); ctx.fill();
  } else if (enemy.type === 'armored') {
    ctx.rotate(time * .0005 + enemy.phase); ctx.beginPath();
    for (let i = 0; i < 8; i += 1) { const a = i / 8 * TAU; const r = i % 2 ? 25 : 32; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.rotate(-(time * .0005 + enemy.phase)); ctx.fillStyle = COLORS.ink;
    ctx.font = '900 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(enemy.hp), 0, 1);
  } else {
    ctx.rotate(Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x) + Math.PI / 2); ctx.beginPath();
    ctx.moveTo(0, -30); ctx.lineTo(25, 24); ctx.lineTo(0, 14); ctx.lineTo(-25, 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COLORS.white; ctx.beginPath(); ctx.arc(0, -4, 6, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(time) {
  const p = state.player; const ready = state.dashCooldown <= 0; if (p.invuln > 0 && Math.floor(time / 70) % 2) return;
  ctx.save(); ctx.translate(p.x, p.y); ctx.shadowColor = 'rgba(20,33,61,.25)'; ctx.shadowBlur = 16; ctx.fillStyle = ready ? COLORS.ink : '#617087';
  ctx.strokeStyle = COLORS.white; ctx.lineWidth = 5; ctx.rotate(Math.PI / 4); roundedRect(-13, -13, 26, 26, 6); ctx.fill(); ctx.stroke(); ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = ready ? COLORS.cyan : COLORS.paper2; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill(); ctx.restore();
  if (!ready) {
    ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 4; ctx.beginPath();
    ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - state.dashCooldown / .64)); ctx.stroke();
  }
}

function drawAim() {
  if (!state.aiming && !state.queuedDash) return;
  const target = state.queuedDash || state.aim;
  const { end, landing, hits, jammed } = planDash(target.x, target.y);
  if (jammed) {
    const px = state.player.x; const py = state.player.y;
    ctx.save(); ctx.strokeStyle = COLORS.signal; ctx.lineWidth = 6; ctx.fillStyle = COLORS.signal;
    ctx.beginPath(); ctx.arc(px, py, 42, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px - 15, py - 15); ctx.lineTo(px + 15, py + 15); ctx.moveTo(px + 15, py - 15); ctx.lineTo(px - 15, py + 15); ctx.stroke();
    ctx.font = '800 20px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('这个方向被挡住了', Math.max(120, Math.min(W - 120, px)), Math.min(FIELD_BOTTOM - 24, py + 78));
    ctx.restore();
    return;
  }
  const color = end.blocked ? COLORS.signal : COLORS.cyan;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 7;
  ctx.setLineDash([12, 10]); ctx.lineDashOffset = -performance.now() * .03; ctx.beginPath(); ctx.moveTo(state.player.x, state.player.y); ctx.lineTo(end.x, end.y); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = 'rgba(22,185,187,.16)'; ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(landing.x, landing.y, 27, 0, TAU); ctx.fill(); ctx.stroke();
  for (const enemy of hits) { ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 10, 0, TAU); ctx.stroke(); }
  if (landing !== end) {
    ctx.fillStyle = COLORS.ink; ctx.font = '800 20px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('破甲后退回', Math.max(90, Math.min(W - 90, landing.x)), landing.y + 50);
  }
  ctx.restore();
}

function drawTelegraphs() {
  ctx.save(); ctx.strokeStyle = COLORS.signal; ctx.lineWidth = 3; ctx.setLineDash([10, 12]);
  for (const enemy of state.enemies) {
    if (enemy.dead || !enemy.lockedAim) continue;
    const dx = enemy.lockedAim.x - enemy.x; const dy = enemy.lockedAim.y - enemy.y; const length = Math.hypot(dx, dy) || 1;
    const end = safeCircleEndpoint(enemy.x, enemy.y, enemy.x + dx / length * 1500, enemy.y + dy / length * 1500, 5, state.walls, BOUNDS);
    ctx.globalAlpha = .35 + .5 * (1 - Math.max(0, enemy.fire) / .45);
    ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y); ctx.lineTo(end.x, end.y); ctx.stroke();
  }
  ctx.restore();
}

function drawHud() {
  if (state.mode === 'title') return; const data = activeLevel(); ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, W, FIELD_TOP);
  ctx.fillStyle = COLORS.ink; ctx.font = '900 22px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`F${state.floor + 1}  ${data.name}`, 28, 38);
  ctx.font = '800 15px system-ui'; ctx.fillStyle = 'rgba(20,33,61,.58)'; ctx.fillText(data.code, 28, 62);
  ctx.textAlign = 'center'; ctx.fillStyle = COLORS.signal; ctx.font = '900 30px "Arial Narrow", system-ui'; ctx.fillText(String(state.score).padStart(6, '0'), W / 2, 40);
  ctx.fillStyle = COLORS.ink; ctx.font = '700 12px system-ui'; ctx.fillText('SCORE', W / 2, 62);
  const liveEnemies = state.enemies.filter(e => !e.dead).length; const liveChips = state.chips.filter(c => !c.collected).length;
  // Everything here must end above FIELD_TOP: every exit portal sits at y >= 170, and its arch
  // reaches up to y ~127, so a bar that spills into the play field hides the objective.
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(243,237,221,.92)'; roundedRect(22, 72, 420, 40, 20); ctx.fill();
  ctx.fillStyle = COLORS.ink; ctx.font = '800 16px system-ui'; ctx.fillText(`守卫 ${liveEnemies}   数据 ${liveChips}`, 42, 98);
  ctx.fillStyle = 'rgba(20,33,61,.58)'; ctx.font = '700 13px system-ui'; ctx.fillText('生命', 250, 97);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = i < state.hp ? COLORS.signal : 'rgba(20,33,61,.15)';
    ctx.beginPath(); ctx.arc(296 + i * 30, 92, 8.5, 0, TAU); ctx.fill();
  }
  if (state.armor > 0) { ctx.fillStyle = COLORS.cyan; ctx.beginPath(); ctx.arc(400, 92, 10, 0, TAU); ctx.fill(); ctx.fillStyle = COLORS.ink; ctx.font = '900 11px system-ui'; ctx.fillText('甲', 393, 96); }
  if (state.combo > 1) {
    ctx.save(); ctx.translate(W - 34, 142); ctx.textAlign = 'right'; ctx.fillStyle = COLORS.signal; ctx.font = '900 48px "Arial Narrow", system-ui'; ctx.fillText(`${state.combo}×`, 0, 0);
    ctx.fillStyle = COLORS.ink; ctx.font = '800 14px system-ui'; ctx.fillText('CHAIN', 0, 19);
    // The chain now runs on real time, so show it draining — otherwise the pressure is invisible.
    ctx.fillStyle = 'rgba(20,33,61,.18)'; ctx.fillRect(-120, 26, 120, 5);
    ctx.fillStyle = COLORS.signal; ctx.fillRect(-120, 26, 120 * Math.max(0, Math.min(1, state.comboTimer / COMBO_WINDOW)), 5);
    ctx.restore();
  }
  if (state.dashCooldown > 0) {
    const ratio = 1 - state.dashCooldown / .64; ctx.fillStyle = 'rgba(20,33,61,.18)'; ctx.fillRect(0, H - 10, W, 10);
    ctx.fillStyle = COLORS.cyan; ctx.fillRect(0, H - 10, W * Math.max(0, ratio), 10);
  }
  ctx.fillStyle = COLORS.paper; ctx.fillRect(0, FIELD_BOTTOM + 4, W, 54);
  ctx.textAlign = 'left'; ctx.fillStyle = state.floorMoves > data.parMoves ? COLORS.signal : COLORS.ink; ctx.font = '800 24px system-ui';
  ctx.fillText(`移动 ${state.floorMoves} / ${data.parMoves}`, 28, 1247);
  ctx.textAlign = 'right'; ctx.fillStyle = state.floorHits === 0 ? COLORS.green : COLORS.ink;
  ctx.fillText(state.floorHits === 0 ? '✓ 无伤' : `受伤 ${state.floorHits} 次`, W - 28, 1247);
  ctx.textAlign = 'center'; ctx.fillStyle = COLORS.ink; ctx.font = '700 22px system-ui';
  ctx.fillText(state.portal.open ? '目标完成 · 前往撤离门' : state.ready ? '观察路线 · 按住开始' : state.queuedDash ? '恢复后自动突袭' : '击破全部守卫 · 收齐数据 · 撤离', W / 2, 1274);
}

function drawReadyIndicator() {
  if (!state.ready || state.mode !== 'playing') return;
  ctx.save(); ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 4; ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.arc(state.player.x, state.player.y, 44, 0, TAU); ctx.stroke();
  ctx.restore();
}

function render(time = performance.now()) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBackground(time);
  const shake = state.reducedMotion ? 0 : state.trauma * state.trauma; const ox = Math.sin(time * .047) * 14 * shake; const oy = Math.sin(time * .063 + 1) * 10 * shake;
  ctx.save(); ctx.translate(ox, oy); drawPortal(time); drawWalls(); drawTelegraphs(); for (const chip of state.chips) drawChip(chip); for (const item of state.items) drawItem(item, time);
  for (const trail of state.trails) { ctx.globalAlpha = trail.life / trail.max; ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 20 * (trail.life / trail.max); ctx.beginPath(); ctx.moveTo(trail.ax, trail.ay); ctx.lineTo(trail.bx, trail.by); ctx.stroke(); ctx.globalAlpha = 1; }
  for (const b of state.bullets) { ctx.fillStyle = COLORS.signal; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, TAU); ctx.fill(); ctx.stroke(); }
  for (const enemy of state.enemies) drawEnemy(enemy, time); drawAim(); drawPlayer(time);
  for (const p of particlePool) if (p.active) { ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1; ctx.restore(); drawHud(); drawReadyIndicator();
  if (state.aiming && state.mode === 'playing') { ctx.fillStyle = 'rgba(20,33,61,.045)'; ctx.fillRect(0, FIELD_TOP, W, FIELD_BOTTOM - FIELD_TOP); }
  if (state.flash > 0) { ctx.globalAlpha = state.flash; ctx.fillStyle = COLORS.white; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

function frame(now) {
  const dt = (now - lastFrame) / 1000; lastFrame = now; if (!state.testMode) update(dt); render(now); requestAnimationFrame(frame);
}

function renderGameToText() {
  const liveEnemies = state.enemies.filter(e => !e.dead).map(e => ({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp, fireIn: e.type === 'turret' ? Number(e.fire.toFixed(2)) : undefined, lockedAim: e.lockedAim || undefined }));
  const chips = state.chips.filter(c => !c.collected).map(c => ({ id: c.id, x: c.x, y: c.y }));
  return JSON.stringify({
    coordinateSystem: 'origin top-left; x increases right; y increases down; playfield y=118..1210', mode: state.mode,
    floor: state.floor + 1, floorName: activeLevel().name, score: state.score, bestSingleLevel: bestSingleLevelScore(state.progress), totalStars: totalStars(state.progress), health: state.hp, armor: state.armor,
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y), radius: PLAYER_R, dashReady: state.dashCooldown <= 0, dashCooldown: Number(state.dashCooldown.toFixed(2)), invulnerable: state.player.invuln > 0 },
    awaitingFirstTouch: state.ready, aiming: state.aiming, queuedDash: state.queuedDash, combo: state.combo, maxCombo: state.maxCombo, comboTime: Number(Math.max(0, state.comboTimer).toFixed(2)), moves: state.floorMoves, hits: state.floorHits, parMoves: activeLevel().parMoves,
    elapsedMs: Math.round(state.elapsed * 1000), realElapsedMs: Math.round(state.realElapsed * 1000), damageTally: state.damageTally,
    aimPreview: state.aiming || state.queuedDash ? (() => { const target = state.queuedDash || state.aim; const plan = planDash(target.x, target.y); return { end: plan.end, landing: plan.landing, hits: plan.hits.map(e => e.id) }; })() : undefined,
    objective: { guardsRemaining: liveEnemies.length, dataRemaining: chips.length }, enemies: liveEnemies, dataChips: chips,
    bullets: state.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) })), portal: { x: state.portal.x, y: state.portal.y, open: state.portal.open },
    items: state.items.filter(item => !item.collected).map(item => ({ type: item.type, x: item.x, y: item.y })),
    collision: { playerOverlapsWall: playerOverlapsWall(), walls: state.walls },
    rating: state.mode === 'floorClear' || state.mode === 'victory' ? state.lastRating : undefined,
    progression: { unlockedThrough: state.progress.unlockedThrough, levels: state.mode === 'levelSelect' ? state.progress.levels : undefined },
    controls: 'touch only: hold and drag toward target, release to dash; use on-screen buttons for pause and sound',
  });
}

window.render_game_to_text = renderGameToText;
window.advanceTime = (ms) => {
  state.testMode = true; const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) update(1 / 60); render();
};

canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointermove', onPointerMove); canvas.addEventListener('pointerup', onPointerUp);
function cancelPointer(event) {
  if (event.pointerId !== state.aimPointerId) return;
  state.aiming = false; state.aimPointerId = null; state.queuedDash = null;
}
canvas.addEventListener('pointercancel', cancelPointer); canvas.addEventListener('lostpointercapture', cancelPointer);
canvas.addEventListener('contextmenu', event => event.preventDefault());

function toggleMute() {
  state.mute = !state.mute; writeStorage('zero-second-muted', state.mute ? '1' : '0'); ui.sound.textContent = state.mute ? '静' : '声'; ui.sound.setAttribute('aria-label', state.mute ? '取消静音' : '静音');
}
ui.start.addEventListener('click', () => startAtLevel(state.progress.unlockedThrough - 1)); document.querySelector('#title-select-btn').addEventListener('click', openLevelSelect);
ui.pause.addEventListener('click', () => pauseGame(true)); ui.sound.addEventListener('click', toggleMute);
ui.resume.addEventListener('click', () => pauseGame(false)); ui.restart.addEventListener('click', restartFloor); ui.pauseSelect.addEventListener('click', openLevelSelect);
ui.continue.addEventListener('click', continueResult); ui.replay.addEventListener('click', restartFloor); ui.select.addEventListener('click', openLevelSelect); ui.home.addEventListener('click', goHome); ui.levelBack.addEventListener('click', goHome);
ui.share.addEventListener('click', shareResult);
window.addEventListener('resize', resizeCanvas);
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state.mode === 'playing') pauseGame(true); tracker.flush('hidden'); } });
window.addEventListener('pagehide', () => tracker.flush('pagehide'));
window.addEventListener('error', event => tracker.track('error', { kind: 'error', message: String(event.message || '').slice(0, 120) }));
window.__zsTracker = tracker;

ui.sound.textContent = state.mute ? '静' : '声';
ui.sound.setAttribute('aria-label', state.mute ? '取消静音' : '静音');
cloneLevel(0); refreshTitle(); setVisibleScreen('title'); resizeCanvas(); requestAnimationFrame(frame);
tracker.track('session_start', {
  returning: state.progress.unlockedThrough > 1, stars: totalStars(state.progress), levels: Object.keys(state.progress.levels).length,
  vw: window.innerWidth || 0, vh: window.innerHeight || 0, dpr: window.devicePixelRatio || 1,
  standalone: matchMedia('(display-mode: standalone)').matches,
});
