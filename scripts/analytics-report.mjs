// Reads the collector's SQLite file and prints the numbers the retention review asked for:
// where players stop, why they die, and whether anyone comes back. Read-only — it never writes to
// the production database.
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.ZS_COLLECT_DB || `${process.env.HOME}/zero-second-analytics/events.db`;
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const arg = process.argv[2] || '--funnel';

function query(sql, params = []) { return db.prepare(sql).all(...params); }
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
function table(headers, rows) {
  if (!rows.length) { console.log('（暂无数据）'); return; }
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => String(row[index]).length)));
  const line = row => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
  console.log(line(headers));
  console.log(widths.map(width => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

if (arg === '--funnel') {
  // For every level: how many reached it, how many cleared it, and where the run ended.
  const rows = query(`
    SELECT json_extract(props, '$.levelId') AS level,
           SUM(name = 'level_start') AS reached,
           SUM(name = 'level_end' AND json_extract(props, '$.outcome') IN ('clear', 'victory')) AS cleared,
           SUM(name = 'level_end' AND json_extract(props, '$.hits') = 0) AS flawless,
           SUM(name = 'level_end' AND json_extract(props, '$.outcome') = 'gameOver') AS died
    FROM event WHERE name IN ('level_start', 'level_end') GROUP BY level ORDER BY level
  `);
  table(['关卡', '到达', '通关', '无伤', '阵亡', '通关率'], rows.map(row => [
    row.level, row.reached, row.cleared, row.flawless, row.died, row.reached ? `${Math.round(row.cleared / row.reached * 100)}%` : '-',
  ]));
} else if (arg === '--pacing') {
  const rows = query(`
    SELECT json_extract(props, '$.levelId') AS level,
           json_extract(props, '$.moves') AS moves, json_extract(props, '$.par') AS par,
           json_extract(props, '$.realMs') AS ms, json_extract(props, '$.maxCombo') AS combo
    FROM event WHERE name = 'level_end' AND json_extract(props, '$.outcome') = 'clear'
  `);
  const byLevel = new Map();
  for (const row of rows) {
    if (!byLevel.has(row.level)) byLevel.set(row.level, []);
    byLevel.get(row.level).push(row);
  }
  table(['关卡', '通关次数', '中位步数', '目标步数', '中位用时', '中位连击'], [...byLevel].sort().map(([level, runs]) => [
    level, runs.length, median(runs.map(run => run.moves).filter(Number.isFinite)), runs[0].par,
    `${(median(runs.map(run => run.ms).filter(Number.isFinite)) / 1000).toFixed(1)}s`,
    median(runs.map(run => run.combo).filter(Number.isFinite)),
  ]));
} else if (arg === '--deaths') {
  const rows = query(`
    SELECT json_extract(props, '$.levelId') AS level, json_extract(props, '$.cause') AS cause, COUNT(*) AS n
    FROM event WHERE name = 'death' GROUP BY level, cause ORDER BY n DESC
  `);
  table(['关卡', '死因', '次数'], rows.map(row => [row.level, row.cause, row.n]));
} else if (arg === '--retention') {
  const rows = query(`
    SELECT sid, MIN(day) AS first_day, MAX(day) AS last_day, COUNT(DISTINCT day) AS active_days
    FROM event WHERE name = 'session_start' GROUP BY sid
  `);
  const byFirstDay = new Map();
  for (const row of rows) {
    if (!byFirstDay.has(row.first_day)) byFirstDay.set(row.first_day, []);
    byFirstDay.get(row.first_day).push(row);
  }
  table(['首次到访', '新会话', '次日回访', '次日留存'], [...byFirstDay].sort().map(([day, sessions]) => {
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const returned = sessions.filter(session => session.last_day >= next).length;
    return [day, sessions.length, returned, sessions.length ? `${Math.round(returned / sessions.length * 100)}%` : '-'];
  }));
} else if (arg === '--sessions') {
  const row = query(`SELECT COUNT(DISTINCT sid) AS sessions, COUNT(*) AS events, MIN(day) AS since, MAX(day) AS until FROM event`)[0];
  console.log(`会话 ${row.sessions}  ·  事件 ${row.events}  ·  区间 ${row.since || '-'} ~ ${row.until || '-'}`);
} else {
  console.log('用法: node scripts/analytics-report.mjs [--funnel|--pacing|--deaths|--retention|--sessions]');
  process.exitCode = 1;
}
db.close();
