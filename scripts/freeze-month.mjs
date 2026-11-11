// 封存脚本：把某月所有 AI 探测聚合定格成 data/monthly/{month}.json 的 ai 字段 + 记入 summary.json。
// 用法：
//   node scripts/freeze-month.mjs            # 自动封存上个月
//   node scripts/freeze-month.mjs 2026-09    # 指定月份
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { mergeMonthly, upsertSummaryMonth } from './monthly-store.mjs';

const DEFAULT_BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig();

// 读某来源目录下所有 json，按文件名排序；目录不存在返回 []
function readSource(dir, base = DEFAULT_BASE) {
  let files;
  try { files = readdirSync(join(base, 'data/raw', dir)).filter(f => f.endsWith('.json')).sort(); }
  catch { return []; }
  return files.map(f => JSON.parse(readFileSync(join(base, 'data/raw', dir, f), 'utf8')));
}

// 一轮已合并的 queries → 任一引擎命中（去重并集）+ 各引擎命中数
export function computeUnionHit(queries) {
  const perEngine = {};
  let unionHits = 0;
  for (const q of queries) {
    const hits = Object.entries(q.engines || {}).filter(([, v]) => v && v.found);
    if (hits.length > 0) unionHits++;
    for (const [k] of hits) perEngine[k] = (perEngine[k] || 0) + 1;
  }
  return { unionHits, probedTotal: queries.length, perEngine };
}

// 多轮 → 每周趋势 + 月末命中率（取最后一轮并集）
export function buildAi(rounds) {
  const weekly = rounds.map(r => {
    const engines = {};
    for (const k of config.engines) {
      const qs = r.queries.filter(q => q.engines && q.engines[k]);
      engines[k] = { hit: qs.filter(q => q.engines[k].found).length, total: qs.length };
    }
    return { date: r.date, engines };
  });
  const last = rounds[rounds.length - 1];
  const { unionHits, probedTotal } = computeUnionHit(last.queries);
  const hitRate = probedTotal > 0 ? Math.round((unionHits / probedTotal) * 1000) / 1000 : 0;
  return { weekly, summary: { hitRate, unionHits, probedTotal } };
}

// 主流程；month 缺省 = 上个月
export function freezeMonth(month = prevMonth(), base = DEFAULT_BASE) {
  const byEngine = {};
  const dates = new Set();
  for (const key of config.engines) {
    byEngine[key] = readSource(key, base).filter(f => f.date && f.date.startsWith(month));
    for (const f of byEngine[key]) dates.add(f.date);
  }
  // 按 date 合并多引擎（复用 aggregate.mjs 的合并方式）
  const rounds = [...dates].sort().map(date => {
    const byId = {};
    for (const key of config.engines) {
      const file = byEngine[key].find(f => f.date === date);
      if (!file) continue;
      for (const q of (file.queries || [])) {
        if (!byId[q.id]) byId[q.id] = { id: q.id, engines: {} };
        const { id, ...rest } = q;
        byId[q.id].engines[key] = rest;
      }
    }
    const queries = Object.values(byId).sort((a, b) => a.id - b.id);
    return { date, queries };
  });
  if (rounds.length === 0) {
    mergeMonthly(month, { ai: null }, base);
    upsertSummaryMonth({ month, aiHitRate: null, probedTotal: null }, base);
    return null;
  }
  const ai = buildAi(rounds);
  mergeMonthly(month, { ai }, base);
  upsertSummaryMonth({ month, aiHitRate: ai.summary.hitRate, probedTotal: ai.summary.probedTotal }, base);
  return ai;
}

function prevMonth() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
}

// CLI：直接运行时封存
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const month = process.argv[2] || prevMonth();
  const ai = freezeMonth(month);
  console.log(`封存 ${month}：命中率 ${ai.summary.hitRate}（${ai.summary.unionHits}/${ai.summary.probedTotal}），周次 ${ai.weekly.length}`);
}
