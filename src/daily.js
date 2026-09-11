// Daily-challenge calendar. The day boundary is a fixed UTC+8 rather than the device timezone:
// tests stay repeatable regardless of the machine's TZ, the audience is in that zone, and nobody
// can farm extra challenges by changing their phone's clock.
export const DAY_MS = 86400000;
export const DAILY_TZ_OFFSET_MS = 8 * 3600 * 1000;

export function dayKey(ms) {
  return new Date(Math.floor((ms + DAILY_TZ_OFFSET_MS) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

export function daysSinceEpoch(key) {
  const parsed = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / DAY_MS) : 0;
}

export function dailyIndex(key, count) {
  if (!count) return 0;
  return ((daysSinceEpoch(key) % count) + count) % count;
}

export function previousDayKey(key) {
  return new Date(daysSinceEpoch(key) * DAY_MS - DAY_MS).toISOString().slice(0, 10);
}
