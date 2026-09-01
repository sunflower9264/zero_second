export function createDefaultProgress() { return { version: 1, unlockedThrough: 1, levels: {} }; }

export function sanitizeProgress(value, levelIds) {
  if (!value || value.version !== 1) return createDefaultProgress();
  const progress = createDefaultProgress();
  progress.unlockedThrough = Math.max(1, Math.min(levelIds.length, Number.parseInt(value.unlockedThrough, 10) || 1));
  if (!value.levels || typeof value.levels !== 'object') return progress;
  for (const id of levelIds) {
    const entry = value.levels[id];
    if (!entry) continue;
    progress.levels[id] = {
      stars: Math.max(1, Math.min(3, Number.parseInt(entry.stars, 10) || 1)),
      moves: Math.max(0, Number.parseInt(entry.moves, 10) || 0),
      hits: Math.max(0, Number.parseInt(entry.hits, 10) || 0),
    };
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
