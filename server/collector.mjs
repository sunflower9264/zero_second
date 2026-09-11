// Anonymous event collector for Zero Second. Single file, zero npm dependencies: node:http for the
// listener and the built-in node:sqlite for storage. Binds to loopback only — nginx is the sole
// entry point, so this process is never directly reachable from the internet.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.ZS_COLLECT_PORT || 18099);
const HOST = process.env.ZS_COLLECT_HOST || '127.0.0.1';
const DB_PATH = process.env.ZS_COLLECT_DB || `${process.env.HOME}/zero-second-analytics/events.db`;
const SALT = process.env.ZS_COLLECT_SALT || 'zero-second';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_BATCH = 64;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_BUCKETS_MAX = 4096;

// Only these event names and property keys are persisted, so a malformed or hostile payload cannot
// grow the schema sideways.
const EVENT_NAMES = new Set(['session_start', 'level_start', 'first_dash', 'level_end', 'death', 'error']);
const PROP_KEYS = new Set([
  'levelId', 'index', 'outcome', 'moves', 'par', 'hits', 'stars', 'bestScore', 'maxCombo', 'floorScore', 'realMs', 'sinceStartMs',
  'cause', 'tally', 'guardsLeft', 'dataLeft', 'kills', 'returning', 'levels', 'vw', 'vh', 'dpr', 'standalone', 'kind', 'message',
]);

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS event (
    id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, sid TEXT NOT NULL, name TEXT NOT NULL,
    ts INTEGER NOT NULL, recv INTEGER NOT NULL, ip_hash TEXT, props TEXT
  );
  CREATE INDEX IF NOT EXISTS event_name_day ON event(name, day);
  CREATE INDEX IF NOT EXISTS event_sid ON event(sid);
`);
const insert = db.prepare('INSERT INTO event (day, sid, name, ts, recv, ip_hash, props) VALUES (?, ?, ?, ?, ?, ?, ?)');

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  if (buckets.size > RATE_BUCKETS_MAX) for (const [key, bucket] of buckets) if (now - bucket.start > RATE_WINDOW_MS) buckets.delete(key);
  const bucket = buckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
  bucket.count += 1;
  buckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT;
}
function hashIp(ip) {
  try { return createHash('sha256').update(`${SALT}:${ip}`).digest('hex').slice(0, 16); } catch { return null; }
}
// `tally` is a map of dynamic cause -> count, so it cannot go through the key whitelist.
function cleanTally(value) {
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const [cause, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count)) out[String(cause).slice(0, 24)] = count;
  }
  return out;
}
function cleanProps(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (!PROP_KEYS.has(key)) continue;
    const type = typeof value;
    if (type === 'string') out[key] = value.slice(0, 64);
    else if (type === 'number' && Number.isFinite(value)) out[key] = value;
    else if (type === 'boolean') out[key] = value;
    else if (key === 'tally') { const tally = cleanTally(value); if (tally) out[key] = tally; }
  }
  return out;
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0; let overflowed = false; const chunks = [];
    request.on('data', chunk => {
      if (overflowed) return;
      size += chunk.length;
      // Pause rather than destroy: destroying the socket here would kill the connection before a
      // clean 413 can be written, and the client would just see a reset.
      if (size > MAX_BODY_BYTES) { overflowed = true; request.pause(); reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
function send(response, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const path = (request.url || '').split('?')[0];
  const ip = request.socket.remoteAddress || 'unknown';

  if (request.method === 'GET' && path === '/api/health') {
    const row = db.prepare('SELECT COUNT(*) AS total, MAX(recv) AS last FROM event').get();
    send(response, 200, { ok: true, total: row.total, lastRecv: row.last });
    return;
  }
  if (request.method !== 'POST' || path !== '/api/collect') { send(response, 404, { error: 'not found' }); return; }
  if (rateLimited(ip)) { send(response, 429, { error: 'rate limited' }); return; }

  let payload;
  try { payload = JSON.parse(await readBody(request)); }
  catch (error) {
    if (error.status === 413) response.setHeader('Connection', 'close');
    send(response, error.status || 400, { error: error.status === 413 ? 'payload too large' : 'bad request' });
    return;
  }
  const events = payload && Array.isArray(payload.events) ? payload.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
  const sid = typeof payload?.sid === 'string' ? payload.sid.slice(0, 32) : 'anonymous';
  if (!events.length) { send(response, 204); return; }

  const recv = Date.now(); const ipHash = hashIp(ip);
  let stored = 0;
  db.exec('BEGIN');
  try {
    for (const event of events) {
      if (!event || !EVENT_NAMES.has(event.n)) continue;
      const ts = Number.isFinite(event.t) ? Math.round(event.t) : recv;
      insert.run(new Date(recv).toISOString().slice(0, 10), sid, event.n, ts, recv, ipHash, JSON.stringify(cleanProps(event.p)));
      stored += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error: String(error && error.message) })}\n`);
    send(response, 500, { error: 'storage failed' });
    return;
  }
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), path, sid, stored, rejected: events.length - stored })}\n`);
  send(response, 204);
});

server.listen(PORT, HOST, () => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), listening: `${HOST}:${PORT}`, db: DB_PATH })}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); });
