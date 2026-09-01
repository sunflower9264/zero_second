import './style.css';
import { LEVELS } from './levels.js';
import { circleOverlapsRect, isCirclePositionValid, nearestValidCirclePosition, safeCircleEndpoint, stopBeforeCircle } from './physics.js';
import { calculateStars, createDefaultProgress, isRecordBetter, sanitizeProgress } from './progress.js';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });
const W = 720;
const H = 1280;
const FIELD_TOP = 118;
const FIELD_BOTTOM = 1210;
const MAX_DASH = 270;
const PLAYER_R = 19;
const TAU = Math.PI * 2;
const BOUNDS = { left: 0, right: W, top: FIELD_TOP, bottom: FIELD_BOTTOM };

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
};
const particlePool = Array.from({ length: 180 }, () => ({ active: false }));

const state = {
  mode: 'title', floor: 0, score: 0, best: Number(localStorage.getItem('zero-second-best') || 0), hp: 3, armor: 0,
  player: { x: 360, y: 1080, vx: 0, vy: 0, invuln: 0 }, lastSafePlayer: { x: 360, y: 1080 },
  portal: { x: 360, y: 190, open: false }, enemies: [], chips: [], items: [], bullets: [], walls: [], trails: [], aiming: false, aimPointerId: null, aim: { x: 360, y: 800 },
  dashCooldown: 0, wallContactGrace: 0, combo: 0, maxCombo: 0, comboTimer: 0,
  elapsed: 0, floorStartScore: 0, floorHits: 0, floorMoves: 0, kills: 0, trauma: 0, flash: 0, hitStop: 0, banner: 0,
  mute: localStorage.getItem('zero-second-muted') === '1',
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, testMode: false,
};

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem('zero-second-progress-v1') || '');
    return sanitizeProgress(parsed, LEVELS.map(level => level.id));
  } catch { return createDefaultProgress(); }
}
state.progress = loadProgress();

function saveProgress() { localStorage.setItem('zero-second-progress-v1', JSON.stringify(state.progress)); }
function renderLevelSelect() {
  const total = Object.values(state.progress.levels).reduce((sum, item) => sum + item.stars, 0);
  ui.totalStars.textContent = `★ ${total} / ${LEVELS.length * 3}`;
  ui.levelGrid.innerHTML = '';
  LEVELS.forEach((level, index) => {
    const unlocked = index < state.progress.unlockedThrough;
    const record = state.progress.levels[level.id];
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'level-card'; card.setAttribute('role', 'gridcell'); card.disabled = !unlocked;
    card.setAttribute('aria-label', unlocked ? `${index + 1} ${level.name}` : `${index + 1} ${level.name}，已锁定`);
    card.innerHTML = unlocked ? `<span class="level-number">${String(index + 1).padStart(2, '0')}</span><span class="level-name">${level.name}</span><span class="level-stars">${'★'.repeat(record?.stars || 0)}${'☆'.repeat(3 - (record?.stars || 0))}</span>` : `<span class="level-number">${String(index + 1).padStart(2, '0')}</span><span class="level-lock">锁定</span><span class="level-stars">☆☆☆</span>`;
    if (unlocked) card.addEventListener('click', () => startAtLevel(index));
    ui.levelGrid.appendChild(card);
  });
}
function openLevelSelect() { state.mode = 'levelSelect'; state.aiming = false; state.aimPointerId = null; renderLevelSelect(); setVisibleScreen('level'); }
function startAtLevel(index) {
  if (index < 0 || index >= state.progress.unlockedThrough) return;
  state.floor = index; state.score = 0; state.hp = 3; state.kills = 0; state.maxCombo = 0; cloneLevel(index); state.mode = 'playing'; setVisibleScreen(); sfx('start');
}

let audioCtx = null;
let lastFrame = performance.now();
let dpr = 1;

function cloneLevel(index) {
  const data = LEVELS[index];
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
    maxHp: type === 'armored' ? 2 : 1, fire: 0.65 + id * 0.23, phase: id * 1.7, dead: false, hurt: 0,
  }));
  state.bullets = []; state.trails = []; state.aiming = false; state.aimPointerId = null; state.dashCooldown = 0; state.wallContactGrace = 0; state.combo = 0; state.comboTimer = 0;
  state.elapsed = 0; state.floorHits = 0; state.floorMoves = 0; state.armor = 0; state.floorStartScore = state.score; state.banner = 1.35; state.trauma = 0; state.flash = 0;
}

function setVisibleScreen(name = null) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('is-visible', key === name));
  ui.pause.style.display = state.mode === 'playing' ? '' : 'none';
}

function restartFloor() {
  state.score = state.floorStartScore; state.hp = 3; cloneLevel(state.floor); state.mode = 'playing'; setVisibleScreen(); sfx('start');
}

function goHome() {
  state.mode = 'title'; state.floor = 0; cloneLevel(0);
  ui.best.textContent = `最高记录 ${String(state.best).padStart(6, '0')}`; setVisibleScreen('title');
}

function pauseGame(force) {
  if (state.mode !== 'playing' && state.mode !== 'paused') return;
  const shouldPause = force ?? state.mode === 'playing';
  state.mode = shouldPause ? 'paused' : 'playing'; state.aiming = false; state.aimPointerId = null; setVisibleScreen(shouldPause ? 'pause' : null);
  if (!shouldPause) lastFrame = performance.now();
}

function showResult(kind) {
  const floorScore = state.score - state.floorStartScore;
  state.mode = kind; state.aiming = false; state.aimPointerId = null;
  const isClear = kind === 'floorClear'; const isVictory = kind === 'victory';
  ui.resultKicker.textContent = isVictory ? 'MISSION COMPLETE' : isClear ? 'FLOOR SECURED' : 'SIGNAL LOST';
  ui.resultTitle.textContent = isVictory ? '核心已夺取' : isClear ? '楼层净空' : '行动终止';
  ui.resultStars.textContent = isClear || isVictory ? `${'★'.repeat(state.lastRating.stars)}${'☆'.repeat(3 - state.lastRating.stars)}` : '任务失败';
  ui.resultScore.textContent = String(state.score).padStart(6, '0');
  ui.resultStats.innerHTML = [
    [isClear || isVictory ? `${state.floorMoves}/${LEVELS[state.floor].parMoves}` : state.floorMoves, isClear || isVictory ? '移动/目标' : '移动'],
    [state.floorHits, '受伤'], [isClear || isVictory ? floorScore : state.kills, isClear || isVictory ? '本层得分' : '击破'],
  ].map(([value, label]) => `<div class="stat"><b>${value}</b><small>${label}</small></div>`).join('');
  ui.continue.innerHTML = isVictory ? '选择关卡 <span>↗</span>' : isClear ? '进入下一层 <span>↗</span>' : '重试本关 <span>↗</span>';
  ui.replay.style.display = isClear || isVictory ? '' : 'none';
  setVisibleScreen('result');
}

function finishFloor() {
  const data = LEVELS[state.floor];
  const moveBonus = Math.max(0, data.parMoves - state.floorMoves) * 150;
  state.score += 700 + moveBonus + state.hp * 250;
  const rating = { stars: calculateStars(data.parMoves, state.floorMoves, state.floorHits), moves: state.floorMoves, hits: state.floorHits };
  const previous = state.progress.levels[data.id];
  if (isRecordBetter(rating, previous)) state.progress.levels[data.id] = rating;
  state.progress.unlockedThrough = Math.min(LEVELS.length, Math.max(state.progress.unlockedThrough, state.floor + 2));
  state.lastRating = rating; saveProgress();
  state.best = Math.max(state.best, state.score); localStorage.setItem('zero-second-best', String(state.best));
  burst(state.portal.x, state.portal.y, COLORS.cyan, 34, 320); state.flash = state.reducedMotion ? 0 : .28;
  state.trauma = state.reducedMotion ? 0 : .75; sfx('clear');
  showResult(state.floor === LEVELS.length - 1 ? 'victory' : 'floorClear');
}

function continueResult() {
  if (state.mode === 'floorClear') {
    state.floor += 1; state.hp = Math.min(3, state.hp + 1); cloneLevel(state.floor); state.mode = 'playing'; setVisibleScreen(); sfx('start');
  } else if (state.mode === 'gameOver') restartFloor();
  else openLevelSelect();
}

function gameOver() {
  state.best = Math.max(state.best, state.score); localStorage.setItem('zero-second-best', String(state.best)); sfx('fail'); showResult('gameOver');
}

function unlockAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
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
}

function resizeCanvas() {
  dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); render();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * W, y: (event.clientY - rect.top) / rect.height * H };
}

function canAim() { return state.mode === 'playing' && state.dashCooldown <= 0 && state.hitStop <= 0; }
function onPointerDown(event) {
  if (event.pointerType !== 'touch' || state.aimPointerId !== null || !canAim()) return;
  unlockAudio(); state.aiming = true; state.aimPointerId = event.pointerId; state.aim = pointerPosition(event);
  try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Synthetic touch events may not have an active capture target. */ }
}
function onPointerMove(event) { if (state.aiming && event.pointerId === state.aimPointerId) state.aim = pointerPosition(event); }
function onPointerUp(event) {
  if (!state.aiming || event.pointerId !== state.aimPointerId) return;
  state.aim = pointerPosition(event); state.aiming = false; state.aimPointerId = null; dashToward(state.aim.x, state.aim.y);
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
  if (!recovered) throw new Error(`Unable to recover player position in ${LEVELS[state.floor].id}`);
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

function dashToward(targetX, targetY) {
  if (!canAim()) return;
  const sx = state.player.x; const sy = state.player.y; const end = dashEndpoint(targetX, targetY);
  if (Math.hypot(end.x - sx, end.y - sy) < 8) return;
  state.floorMoves += 1;
  state.trails.push({ ax: sx, ay: sy, bx: end.x, by: end.y, life: .22, max: .22 });
  if (state.trails.length > 12) state.trails.shift();
  movePlayerSafely(end.x, end.y); state.dashCooldown = .64;
  let defeats = 0;
  let recoilLanding = null;
  for (const enemy of state.enemies) {
    if (enemy.dead || pointSegmentDistance(enemy.x, enemy.y, sx, sy, end.x, end.y) > enemy.r + 13) continue;
    enemy.hp -= 1; enemy.hurt = .2; burst(enemy.x, enemy.y, enemy.hp <= 0 ? COLORS.signal : COLORS.yellow, enemy.hp <= 0 ? 18 : 10, 240);
    if (enemy.hp <= 0) {
      enemy.dead = true; defeats += 1; state.kills += 1; state.combo += 1; state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.comboTimer = 2.25; state.score += 100 * state.combo; sfx('kill');
    } else {
      state.score += 30; sfx('hit');
      const landing = stopBeforeCircle(sx, sy, end.x, end.y, enemy.x, enemy.y, enemy.r + PLAYER_R + 26);
      if (!recoilLanding || Math.hypot(landing.x - sx, landing.y - sy) < Math.hypot(recoilLanding.x - sx, recoilLanding.y - sy)) recoilLanding = landing;
    }
  }
  if (recoilLanding) movePlayerSafely(recoilLanding.x, recoilLanding.y);
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
    for (const enemy of state.enemies) if (!enemy.dead && enemy.type === 'turret') enemy.fire += 1.6;
  }
  burst(item.x, item.y, item.type === 'medkit' ? COLORS.signal : COLORS.yellow, 18, 200); sfx('chip');
}
function refreshPortal() { state.portal.open = state.enemies.every(enemy => enemy.dead) && state.chips.every(chip => chip.collected); }

function spawnBullet(enemy) {
  const dx = state.player.x - enemy.x; const dy = state.player.y - enemy.y; const len = Math.hypot(dx, dy) || 1;
  state.bullets.push({ x: enemy.x, y: enemy.y, vx: dx / len * 265, vy: dy / len * 265, life: 4 });
  if (state.bullets.length > 50) state.bullets.shift(); tone(110, .1, 'square', .018);
}

function damagePlayer(sourceX, sourceY) {
  if (state.player.invuln > 0 || state.mode !== 'playing') return;
  if (state.armor > 0) {
    state.armor = 0; state.player.invuln = .45; burst(state.player.x, state.player.y, COLORS.yellow, 20, 220); sfx('chip');
    return;
  }
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
  if (state.hitStop > 0) { state.hitStop = Math.max(0, state.hitStop - dt); updateEffects(dt); return; }
  if (state.mode !== 'playing') { updateEffects(dt); return; }
  const worldDt = dt * (state.aiming ? .14 : 1);
  state.elapsed += worldDt; state.dashCooldown = Math.max(0, state.dashCooldown - worldDt); state.wallContactGrace = Math.max(0, state.wallContactGrace - worldDt);
  state.player.invuln = Math.max(0, state.player.invuln - worldDt); state.banner = Math.max(0, state.banner - dt);
  if (state.comboTimer > 0) { state.comboTimer -= worldDt; if (state.comboTimer <= 0) state.combo = 0; }
  for (const chip of state.chips) chip.spin += worldDt * 2.4;
  for (const item of state.items) item.spin += worldDt * 2.1;
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    enemy.phase += worldDt; enemy.hurt = Math.max(0, enemy.hurt - worldDt);
    if (enemy.type === 'turret') {
      enemy.fire -= worldDt;
      if (enemy.fire <= 0) { spawnBullet(enemy); enemy.fire = Math.max(.78, 1.78 - state.floor * .1); }
    } else {
      const dx = state.player.x - enemy.x; const dy = state.player.y - enemy.y; const len = Math.hypot(dx, dy) || 1;
      const speed = enemy.type === 'armored' ? 28 : 43 + state.floor * 2;
      const nx = enemy.x + dx / len * speed * worldDt; const ny = enemy.y + dy / len * speed * worldDt;
      if (!state.walls.some(w => circleOverlapsRect(nx, ny, enemy.r, w))) { enemy.x = nx; enemy.y = ny; }
      if (len < enemy.r + PLAYER_R + 2 && state.wallContactGrace <= 0) damagePlayer(enemy.x, enemy.y);
    }
  }
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const b = state.bullets[i]; b.x += b.vx * worldDt; b.y += b.vy * worldDt; b.life -= worldDt;
    const hitWall = state.walls.some(w => circleOverlapsRect(b.x, b.y, 5, w));
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < FIELD_TOP - 20 || b.y > FIELD_BOTTOM + 20 || hitWall) state.bullets.splice(i, 1);
    else if (Math.hypot(b.x - state.player.x, b.y - state.player.y) < PLAYER_R + 7) { state.bullets.splice(i, 1); damagePlayer(b.x, b.y); }
  }
  ensurePlayerPositionValid();
  if (state.portal.open && Math.hypot(state.player.x - state.portal.x, state.player.y - state.portal.y) < 54) finishFloor();
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
    ctx.rotate(Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x)); ctx.beginPath(); ctx.rect(-22, -22, 44, 44); ctx.fill(); ctx.stroke();
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
}

function drawAim() {
  if (!state.aiming) return;
  const target = state.aim;
  const end = dashEndpoint(target.x, target.y); ctx.save(); ctx.strokeStyle = end.blocked ? COLORS.signal : COLORS.cyan; ctx.lineWidth = 7;
  ctx.setLineDash([12, 10]); ctx.lineDashOffset = -performance.now() * .03; ctx.beginPath(); ctx.moveTo(state.player.x, state.player.y); ctx.lineTo(end.x, end.y); ctx.stroke();
  ctx.setLineDash([]); ctx.fillStyle = 'rgba(22,185,187,.16)'; ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(end.x, end.y, 27, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawHud() {
  if (state.mode === 'title') return; const data = LEVELS[state.floor]; ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, W, FIELD_TOP);
  ctx.fillStyle = COLORS.ink; ctx.font = '900 26px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`F${state.floor + 1}  ${data.name}`, 28, 42);
  ctx.font = '800 18px system-ui'; ctx.fillStyle = 'rgba(20,33,61,.58)'; ctx.fillText(data.code, 28, 72);
  ctx.textAlign = 'center'; ctx.fillStyle = COLORS.signal; ctx.font = '900 34px "Arial Narrow", system-ui'; ctx.fillText(String(state.score).padStart(6, '0'), W / 2, 52);
  ctx.fillStyle = COLORS.ink; ctx.font = '700 14px system-ui'; ctx.fillText('SCORE', W / 2, 75);
  const liveEnemies = state.enemies.filter(e => !e.dead).length; const liveChips = state.chips.filter(c => !c.collected).length;
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(243,237,221,.92)'; roundedRect(22, 102, 398, 48, 20); ctx.fill();
  ctx.fillStyle = COLORS.ink; ctx.font = '800 17px system-ui'; ctx.fillText(`守卫 ${liveEnemies}   数据 ${liveChips}`, 42, 133);
  ctx.fillStyle = 'rgba(20,33,61,.58)'; ctx.font = '700 14px system-ui'; ctx.fillText('盾', 254, 132);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = i < state.hp ? COLORS.signal : 'rgba(20,33,61,.15)';
    ctx.beginPath(); ctx.arc(286 + i * 30, 126, 9, 0, TAU); ctx.fill();
  }
  if (state.armor > 0) { ctx.fillStyle = COLORS.cyan; ctx.beginPath(); ctx.arc(397, 126, 10, 0, TAU); ctx.fill(); ctx.fillStyle = COLORS.ink; ctx.font = '900 11px system-ui'; ctx.fillText('甲', 390, 130); }
  if (state.combo > 1) {
    ctx.save(); ctx.translate(W - 34, 142); ctx.textAlign = 'right'; ctx.fillStyle = COLORS.signal; ctx.font = '900 48px "Arial Narrow", system-ui'; ctx.fillText(`${state.combo}×`, 0, 0);
    ctx.fillStyle = COLORS.ink; ctx.font = '800 14px system-ui'; ctx.fillText('CHAIN', 0, 19); ctx.restore();
  }
  if (state.dashCooldown > 0) {
    const ratio = 1 - state.dashCooldown / .64; ctx.fillStyle = 'rgba(20,33,61,.18)'; ctx.fillRect(0, H - 10, W, 10);
    ctx.fillStyle = COLORS.cyan; ctx.fillRect(0, H - 10, W * Math.max(0, ratio), 10);
  }
}

function drawBanner() {
  if (state.banner <= 0 || state.mode !== 'playing') return;
  const alpha = Math.min(1, state.banner * 3, (1.35 - state.banner) * 4); ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = COLORS.ink; ctx.fillRect(0, 510, W, 170);
  ctx.textAlign = 'center'; ctx.fillStyle = COLORS.signal; ctx.font = '800 18px system-ui'; ctx.fillText(LEVELS[state.floor].code, W / 2, 557);
  ctx.fillStyle = COLORS.white; ctx.font = '900 54px system-ui'; ctx.fillText(LEVELS[state.floor].name, W / 2, 625); ctx.restore();
}

function render(time = performance.now()) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBackground(time);
  const shake = state.reducedMotion ? 0 : state.trauma * state.trauma; const ox = Math.sin(time * .047) * 14 * shake; const oy = Math.sin(time * .063 + 1) * 10 * shake;
  ctx.save(); ctx.translate(ox, oy); drawPortal(time); drawWalls(); for (const chip of state.chips) drawChip(chip); for (const item of state.items) drawItem(item, time);
  for (const trail of state.trails) { ctx.globalAlpha = trail.life / trail.max; ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 20 * (trail.life / trail.max); ctx.beginPath(); ctx.moveTo(trail.ax, trail.ay); ctx.lineTo(trail.bx, trail.by); ctx.stroke(); ctx.globalAlpha = 1; }
  for (const b of state.bullets) { ctx.fillStyle = COLORS.signal; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, TAU); ctx.fill(); ctx.stroke(); }
  for (const enemy of state.enemies) drawEnemy(enemy, time); drawAim(); drawPlayer(time);
  for (const p of particlePool) if (p.active) { ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1; ctx.restore(); drawHud(); drawBanner();
  if (state.aiming && state.mode === 'playing') { ctx.fillStyle = 'rgba(20,33,61,.045)'; ctx.fillRect(0, FIELD_TOP, W, FIELD_BOTTOM - FIELD_TOP); }
  if (state.flash > 0) { ctx.globalAlpha = state.flash; ctx.fillStyle = COLORS.white; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

function frame(now) {
  const dt = (now - lastFrame) / 1000; lastFrame = now; if (!state.testMode) update(dt); render(now); requestAnimationFrame(frame);
}

function renderGameToText() {
  const liveEnemies = state.enemies.filter(e => !e.dead).map(e => ({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp }));
  const chips = state.chips.filter(c => !c.collected).map(c => ({ id: c.id, x: c.x, y: c.y }));
  return JSON.stringify({
    coordinateSystem: 'origin top-left; x increases right; y increases down; playfield y=118..1210', mode: state.mode,
    floor: state.floor + 1, floorName: LEVELS[state.floor].name, score: state.score, best: state.best, health: state.hp, armor: state.armor,
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y), radius: PLAYER_R, dashReady: state.dashCooldown <= 0, dashCooldown: Number(state.dashCooldown.toFixed(2)), invulnerable: state.player.invuln > 0 },
    aiming: state.aiming, combo: state.combo, comboTime: Number(Math.max(0, state.comboTimer).toFixed(2)), moves: state.floorMoves, hits: state.floorHits, parMoves: LEVELS[state.floor].parMoves,
    objective: { guardsRemaining: liveEnemies.length, dataRemaining: chips.length }, enemies: liveEnemies, dataChips: chips,
    bullets: state.bullets.slice(0, 20).map(b => ({ x: Math.round(b.x), y: Math.round(b.y) })), portal: { x: state.portal.x, y: state.portal.y, open: state.portal.open },
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
canvas.addEventListener('pointercancel', event => {
  if (event.pointerId !== state.aimPointerId) return;
  state.aiming = false; state.aimPointerId = null;
});
canvas.addEventListener('contextmenu', event => event.preventDefault());

function toggleMute() {
  state.mute = !state.mute; localStorage.setItem('zero-second-muted', state.mute ? '1' : '0'); ui.sound.textContent = state.mute ? '静' : '声'; ui.sound.setAttribute('aria-label', state.mute ? '取消静音' : '静音');
}
ui.start.addEventListener('click', openLevelSelect); ui.pause.addEventListener('click', () => pauseGame(true)); ui.sound.addEventListener('click', toggleMute);
ui.resume.addEventListener('click', () => pauseGame(false)); ui.restart.addEventListener('click', restartFloor); ui.pauseSelect.addEventListener('click', openLevelSelect);
ui.continue.addEventListener('click', continueResult); ui.replay.addEventListener('click', restartFloor); ui.select.addEventListener('click', openLevelSelect); ui.home.addEventListener('click', goHome); ui.levelBack.addEventListener('click', goHome);
window.addEventListener('resize', resizeCanvas); document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'playing') pauseGame(true); });

ui.sound.textContent = state.mute ? '静' : '声'; ui.best.textContent = `最高记录 ${String(state.best).padStart(6, '0')}`;
cloneLevel(0); setVisibleScreen('title'); resizeCanvas(); requestAnimationFrame(frame);
