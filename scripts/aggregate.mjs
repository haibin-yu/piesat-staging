// 聚合脚本：读 data/raw/** 所有分文件 → 生成 data/aggregated/trends.json
// 页面只读 trends.json，本脚本是 raw → 页面数据的唯一桥梁（只读合并，无并发写冲突）。
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(BASE, 'data/raw');
const OUT = join(BASE, 'data/aggregated/trends.json');

const meta = JSON.parse(readFileSync(join(BASE, 'data/meta.json'), 'utf8'));

// 读某来源目录下所有 json，按文件名（日期）排序；目录不存在返回 []
function readSource(dir) {
  let files;
  try { files = readdirSync(join(RAW, dir)).filter(f => f.endsWith('.json')).sort(); }
  catch { return []; }
  return files.map(f => JSON.parse(readFileSync(join(RAW, dir, f), 'utf8')));
}

// 1) WebSearch 海外索引（手动层）→ scans
const scans = readSource('websearch');

// 2) 百度人工搜索（手动层）→ baiduScans
const baiduScans = readSource('baidu');

// 3) 百度站长第一方（手动层）→ baiduSearchConsole（取最新 period）
const consoles = readSource('baidu-console');
const baiduSearchConsole = consoles.length ? consoles[consoles.length - 1] : null;

// 4) AI 引擎（自动层）：按 date 合并多引擎 → aiScans
const ENGINE_KEYS = ['doubao', 'doubao_model', 'deepseek'];
const dates = new Set();
for (const key of ENGINE_KEYS) {
  for (const f of readSource(key)) dates.add(f.date);
}
const aiScans = [...dates].sort().map(date => {
  const byId = {};
  for (const key of ENGINE_KEYS) {
    const file = readSource(key).find(f => f.date === date);
    if (!file) continue;
    for (const q of (file.queries || [])) {
      if (!byId[q.id]) byId[q.id] = { id: q.id, engines: {} };
      const { id, ...rest } = q;
      byId[q.id].engines[key] = rest;
    }
  }
  const queries = Object.values(byId).sort((a, b) => a.id - b.id);
  const total = queries.length;
  const hit = k => queries.filter(q => q.engines[k] && q.engines[k].found).length;
  const summary = `豆包·搜索 ${hit('doubao')}/${total}、豆包·模型 ${hit('doubao_model')}/${total}、DeepSeek官方 ${hit('deepseek')}/${total}`;
  return { date, source: 'ai-engines-api', summary, queries };
});

const trends = { ...meta, scans, baiduScans, aiScans, baiduSearchConsole };
mkdirSync(join(BASE, 'data/aggregated'), { recursive: true });
writeFileSync(OUT, JSON.stringify(trends, null, 2) + '\n', 'utf8');
console.log(`trends.json 生成：scans=${scans.length} baidu=${baiduScans.length} ai=${aiScans.length} console=${baiduSearchConsole ? '有' : '无'}`);
