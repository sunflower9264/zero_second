// Share text and the capability-probing fallback chain. Kept DOM-free so it can be exercised from
// node --test with a fake navigator; the PNG card is drawn in main.js behind a feature check.
export function buildShareText({ levelName, stars, moves, par, hits, maxCombo, seconds, score }) {
  const starLine = `${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, 3 - stars))}`;
  const clean = hits === 0 ? ' · 无伤' : '';
  return `《零秒特工》${levelName}\n${starLine} ${moves}/${par} 步${clean} · 连击 ${maxCombo}× · ${seconds.toFixed(1)} 秒\n得分 ${score}\n单指瞄准，松手瞬移，一击接一击。`;
}

// Returns 'shared' | 'copied' | 'cancelled' | 'manual'. A user cancelling the share sheet is not a
// failure and must not silently dump the text into their clipboard.
export async function shareOrCopy({ text, file, nav }) {
  const host = nav || (typeof navigator === 'undefined' ? {} : navigator);
  try {
    if (typeof host.share === 'function') {
      const payload = file && typeof host.canShare === 'function' && host.canShare({ files: [file] }) ? { files: [file], text } : { text };
      await host.share(payload);
      return 'shared';
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return 'cancelled';
  }
  try {
    if (host.clipboard && typeof host.clipboard.writeText === 'function') { await host.clipboard.writeText(text); return 'copied'; }
  } catch { /* fall through to the manual hint */ }
  return 'manual';
}
