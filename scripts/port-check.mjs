// Portability guardrail. The plan is web first and a WeChat/Douyin mini-game port later, so the
// rules layer (levels, physics, progress, daily, share, analytics, constants) has to stay free of
// browser globals. Only the presentation layer is allowed to touch the DOM, and this script fails
// the build if that ever stops being true.
import fs from 'node:fs';
import path from 'node:path';

const BROWSER_GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'AudioContext', 'matchMedia', 'requestAnimationFrame', 'File', 'Blob', 'fetch', 'location'];
// main.js is the presentation shell: rendering, DOM wiring and the input path live here by design.
const PRESENTATION_LAYER = new Set(['main.js']);
// Adapters necessarily touch the host's network and share APIs, but they take those as injectable
// parameters, so a port swaps the call site rather than the module.
const ADAPTER_LAYER = new Set(['analytics.js', 'share.js']);

const dir = 'src';
const files = fs.readdirSync(dir).filter(name => name.endsWith('.js')).sort();
const offenders = [];
const rows = [];

for (const name of files) {
  const source = fs.readFileSync(path.join(dir, name), 'utf8');
  const hits = BROWSER_GLOBALS.filter(global => new RegExp(`\\b${global}\\b`).test(source));
  const isPresentation = PRESENTATION_LAYER.has(name);
  const isAdapter = ADAPTER_LAYER.has(name);
  rows.push({ name, isPresentation, isAdapter, hits });
  if (!isPresentation && !isAdapter && hits.length) offenders.push(`${name}: ${hits.join(', ')}`);
}

const width = Math.max(...rows.map(row => row.name.length));
for (const row of rows) {
  const layer = row.isPresentation ? '平台层' : row.isAdapter ? '适配层' : '规则层';
  const state = row.hits.length ? `引用了 ${row.hits.join(', ')}` : '无浏览器依赖';
  console.log(`${row.name.padEnd(width)}  ${layer}  ${state}`);
}

if (offenders.length) {
  console.error(`\n以下规则层模块引用了浏览器全局，移植时无法直接复用：\n  ${offenders.join('\n  ')}`);
  process.exitCode = 1;
} else {
  const pure = rows.filter(row => !row.isPresentation && !row.isAdapter).length;
  console.log(`\n规则层 ${pure} 个模块与浏览器无关。适配层通过注入宿主 API 隔离，移植时只需替换调用点。`);
}
