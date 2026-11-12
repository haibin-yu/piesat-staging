// 跨月对比矩阵：读 query-list + article-dates（上线日期）+ raw 末轮探测 → 生成 data/aggregated/matrix.json。
// 每词每月两维：covered（覆盖 = 文章上线日期 ≤ 当月月末）＋ hit（AI 命中三态 true/false/null）。
// 用法：node scripts/build-matrix.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';

const DEFAULT_BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

// '2026-08' → '2026-08-31'
export function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return month + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
}

// 该 article 在该月是否已上线覆盖（article 无日期 → 未覆盖）
export function coverageFor(article, articleDates, month) {
  const d = articleDates[article];
  if (!d) return false;
  return d <= monthEnd(month);
}

// 命中三态：null=未探测，true=命中，false=探测但未命中
export function hitState(id, monthHits) {
  if (!monthHits) return null;
  const h = monthHits[id];
  if (h == null) return null;
  return !!h.found;
}

export function categoryOf(article, id) {
  if (article === '其他公告') return 'ir';
  if ([19, 20, 21, 22].includes(id)) return 'ir';
  return 'tech';
}

// 三引擎 raw 文件 → 每月末轮并集命中表 { month: { id: { found, rank } } }
export function buildHitsByMonth(filesByEngine, engines) {
  const byDate = new Map();
  for (const key of engines) {
    for (const f of (filesByEngine[key] || [])) {
      if (!byDate.has(f.date)) byDate.set(f.date, {});
      byDate.get(f.date)[key] = f;
    }
  }
  const dates = [...byDate.keys()].sort();
  const monthLast = {};
  for (const d of dates) monthLast[d.slice(0, 7)] = d; // 排序后覆盖 → 每月最大日期
  const result = {};
  for (const [month, lastDate] of Object.entries(monthLast)) {
    const byEngine = byDate.get(lastDate);
    const byId = {};
    for (const key of engines) {
      const file = byEngine[key];
      if (!file) continue;
      for (const q of (file.queries || [])) {
        if (!byId[q.id]) byId[q.id] = { found: false, rank: null };
        if (q.found) {
          byId[q.id].found = true;
          if (q.rank != null && (byId[q.id].rank == null || q.rank < byId[q.id].rank)) byId[q.id].rank = q.rank;
        }
      }
    }
    result[month] = Object.fromEntries(Object.entries(byId).map(([id, v]) => [id, { found: v.found, rank: v.rank }]));
  }
  return result;
}

export function buildMatrix(queryList, articleDates, months, hitsByMonth) {
  return {
    months,
    queries: (queryList || []).map(q => {
      const cells = {};
      for (const m of months) {
        cells[m] = {
          covered: coverageFor(q.article, articleDates, m),
          hit: hitState(q.id, hitsByMonth[m]),
        };
      }
      return {
        id: q.id,
        text: q.text,
        article: q.article || '—',
        category: categoryOf(q.article, q.id),
        months: cells,
      };
    }),
  };
}

function readSource(dir, base = DEFAULT_BASE) {
  let files;
  try { files = readdirSync(join(base, 'data/raw', dir)).filter(f => f.endsWith('.json')).sort(); }
  catch { return []; }
  return files.map(f => JSON.parse(readFileSync(join(base, 'data/raw', dir, f), 'utf8')));
}

export function generateMatrix(base = DEFAULT_BASE) {
  const config = loadConfig(base);
  const queryList = JSON.parse(readFileSync(join(base, config.queryList), 'utf8'));
  const articleDates = JSON.parse(readFileSync(join(base, 'data/article-dates.json'), 'utf8'));
  let summary = { months: [] };
  try { summary = JSON.parse(readFileSync(join(base, 'data/summary.json'), 'utf8')); } catch {}
  const months = (summary.months || []).map(m => m.month).sort();

  const filesByEngine = {};
  for (const key of config.engines) filesByEngine[key] = readSource(key, base);
  const hitsByMonth = buildHitsByMonth(filesByEngine, config.engines);

  const matrix = buildMatrix(queryList, articleDates, months, hitsByMonth);
  const out = join(base, 'data/aggregated/matrix.json');
  mkdirSync(join(base, 'data/aggregated'), { recursive: true });
  writeFileSync(out, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  return matrix;
}

// CLI：直接运行时生成
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = generateMatrix();
  console.log(`matrix.json 生成：${m.months.length} 月 × ${m.queries.length} 词`);
}
