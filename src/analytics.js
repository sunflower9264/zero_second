// Anonymous, fire-and-forget telemetry. Nothing here may ever throw into the game loop, and the
// module deliberately uses no timers: the vm sandbox in test/helpers/runtime.js has no
// setTimeout, and the event rate is low enough that explicit flushes at level boundaries suffice.
export const ANALYTICS_VERSION = 1;

export function newSessionId(rand = Math.random) {
  return Math.floor(rand() * 0xffffffff).toString(36) + Math.floor(rand() * 0xffffffff).toString(36);
}

// Returns false rather than throwing when the host offers no transport at all.
export function defaultSend(endpoint, body) {
  try {
    if (typeof navigator !== 'undefined' && navigator && typeof navigator.sendBeacon === 'function') {
      return navigator.sendBeacon(endpoint, body) !== false;
    }
    if (typeof fetch === 'function') {
      fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
      return true;
    }
  } catch { /* Telemetry must never break play. */ }
  return false;
}

export function createTracker({ endpoint = '/api/collect', transport, now = Date.now, sessionId = 'anonymous', capacity = 128, flushAt = 24 } = {}) {
  const send = transport || (body => defaultSend(endpoint, body));
  let queue = [];
  let enabled = true;
  const dropped = { overflow: 0, failed: 0 };

  function track(name, props = {}) {
    if (!enabled || !name) return false;
    queue.push({ n: name, t: Math.round(now()), p: props });
    if (queue.length > capacity) { queue.splice(0, queue.length - capacity); dropped.overflow += 1; }
    if (queue.length >= flushAt) flush('batch');
    return true;
  }

  function flush(reason = 'manual') {
    if (!enabled || queue.length === 0) return false;
    const events = queue;
    queue = [];
    try {
      if (send(JSON.stringify({ v: ANALYTICS_VERSION, sid: sessionId, reason, events })) === false) {
        dropped.failed += events.length;
        return false;
      }
      return true;
    } catch {
      dropped.failed += events.length;
      return false;
    }
  }

  return {
    sessionId, track, flush,
    setEnabled(value) { enabled = Boolean(value); if (!enabled) queue = []; },
    pending: () => queue.length,
    dropped: () => ({ ...dropped }),
  };
}
