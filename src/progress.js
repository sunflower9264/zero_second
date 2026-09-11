const DAILY_ENTRY_LIMIT = 60;

export function createDefaultProgress() {
  return {
    version: 2, unlockedThrough: 1, levels: {},
    daily: { last: '', streak: 0, bestStreak: 0, entries: {} },
    endless: { bestFloor: 0, bestScore: 0, runs: 0 },
  };
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}
function nonNegative(value) { return Math.max(0, Number.parseInt(value, 10) || 0); }

function sanitizeDaily(value) {
  const daily = { last: '', streak: 0, bestStreak: 0, entries: {} };
  if (!value || typeof value !== 'object') return daily;
  if (typeof value.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.last)) daily.last = value.last;
  daily.streak = clampInt(value.streak, 0, 3650);
  daily.bestStreak = Math.max(daily.streak, clampInt(value.bestStreak, 0, 3650));
  if (value.entries && typeof value.entries === 'object') {
    // Keep only the most recent entries so a long-lived save cannot grow without bound.
    const keys = Object.keys(value.entries).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().slice(-DAILY_ENTRY_LIMIT);
    for (const key of keys) {
      const entry = value.entries[key];
      if (!entry || typeof entry !== 'object') continue;
      daily.entries[key] = { stars: clampInt(entry.stars, 1, 3), moves: nonNegative(entry.moves), hits: nonNegative(entry.hits), bestScore: nonNegative(entry.bestScore) };
    }
  }
  return daily;
}

function sanitizeEndless(value) {
  const endless = { bestFloor: 0, bestScore: 0, runs: 0 };
  if (!value || typeof value !== 'object') return endless;
  endless.bestFloor = clampInt(value.bestFloor, 0, 9999);
  endless.bestScore = nonNegative(value.bestScore);
  endless.runs = nonNegative(value.runs);
  return endless;
}

// Only the current schema is accepted; anything else starts over. There is no installed base to
// migrate, so carrying a version-1 reader would be dead weight.
export function sanitizeProgress(value, levelIds) {
  if (!value || typeof value !== 'object') return createDefaultProgress();
  if (Number.parseInt(value.version, 10) !== 2) return createDefaultProgress();
  const progress = createDefaultProgress();
  progress.unlockedThrough = clampInt(value.unlockedThrough, 1, levelIds.length);
  if (value.levels && typeof value.levels === 'object') {
    for (const id of levelIds) {
      const entry = value.levels[id];
      if (!entry || typeof entry !== 'object') continue;
      progress.levels[id] = {
        stars: clampInt(entry.stars, 1, 3), moves: nonNegative(entry.moves), hits: nonNegative(entry.hits), bestScore: nonNegative(entry.bestScore),
      };
    }
  }
  progress.daily = sanitizeDaily(value.daily);
  progress.endless = sanitizeEndless(value.endless);
  return progress;
}

export function calculateStars(parMoves, moves, hits) {
  return 1 + Number(moves <= parMoves) + Number(hits === 0);
}

export function isRecordBetter(next, previous) {
  return !previous || next.stars > previous.stars
    || (next.stars === previous.stars && (next.hits < previous.hits
      || (next.hits === previous.hits && next.moves < previous.moves)));
}

export function bestSingleLevelScore(progress) {
  return Object.values(progress.levels).reduce((best, entry) => Math.max(best, entry.bestScore || 0), 0);
}

export function totalStars(progress) {
  return Object.values(progress.levels).reduce((sum, entry) => sum + entry.stars, 0);
}
