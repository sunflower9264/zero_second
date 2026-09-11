export function createDefaultProgress() { return { version: 2, unlockedThrough: 1, levels: {} }; }

function clampInt(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}
function nonNegative(value) { return Math.max(0, Number.parseInt(value, 10) || 0); }

// Only the current schema is accepted; anything else starts over. There is no installed base to
// migrate, so carrying an older reader would be dead weight.
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
