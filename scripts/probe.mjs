// 探测脚本：对 data/query-list.json 逐条跑「可自动引擎」，结果写 data/raw/<engine>/<date>.json
// 密钥优先级：环境变量（GitHub Actions Secrets）> 本地 ~/.config/piesat/keys.json（手动兜底）
// 用法：
//   node scripts/probe.mjs             # 跑所有有 key 的引擎（30 词全量）
//   node scripts/probe.mjs doubao      # 只跑豆包·搜索
//   node scripts/probe.mjs doubao 1 3  # 只跑豆包·搜索的第 1、3 条 query（本地快速验证）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 密钥 ----------
function loadKeys() {
  const keys = { doubao: '', doubao_model: '', deepseek: '' };
  if (process.env.DOUBAO_SEARCH_KEY) keys.doubao = process.env.DOUBAO_SEARCH_KEY;
  if (process.env.ARK_API_KEY) keys.doubao_model = process.env.ARK_API_KEY;
  if (process.env.DEEPSEEK_API_KEY) keys.deepseek = process.env.DEEPSEEK_API_KEY;
  // 本地兜底
  try {
    const local = JSON.parse(readFileSync(join(homedir(), '.config/piesat/keys.json'), 'utf8'));
    if (!keys.doubao) keys.doubao = local.doubao_search_key || '';
    if (!keys.doubao_model) keys.doubao_model = local.ark_api_key || '';
    if (!keys.deepseek) keys.deepseek = local.deepseek_api_key || '';
  } catch { /* 本地 keys.json 不存在则跳过 */ }
  return keys;
}
const keys = loadKeys();

// ---------- 判定：Url 是否官网 piesat.cn ----------
const isOfficial = url => typeof url === 'string' && url.includes('piesat.cn');

// ---------- 豆包·搜索（搜索层，search-infinity） ----------
async function probeDoubao(query) {
  const res = await fetch('https://open.feedcoopapi.com/search_api/web_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.doubao },
    body: JSON.stringify({
      Query: query, SearchType: 'web', Count: 20,
      Filter: { NeedContent: false, NeedUrl: true }, TimeRange: 'OneYear',
    }),
  });
  const data = await res.json();
  const results = data?.Result?.WebResults || [];
  const hit = results.find(r => r.Url && isOfficial(r.Url));
  if (hit) return { found: true, rank: hit.SortId, source: hit.SiteName, authority: hit.AuthInfoDes, url: hit.Url };
  return { found: false, rank: null };
}

// ---------- 豆包·模型（方舟 Responses API + web_search） ----------
async function probeDoubaoModel(query) {
  const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.doubao_model },
    body: JSON.stringify({
      model: 'doubao-seed-2-0-mini-260428',
      tools: [{ type: 'web_search' }],
      input: query,
    }),
  });
  const data = await res.json();
  const citations = [];
  for (const item of (data.output || [])) {
    const contents = item?.message?.content || item.content || [];
    for (const m of contents) {
      for (const a of (m.annotations || [])) if (a.type === 'url_citation') citations.push(a);
    }
  }
  const hit = citations.find(a => isOfficial(a.url));
  if (hit) return { found: true, rank: citations.indexOf(hit) + 1, source: hit.site_name, url: hit.url };
  return { found: false, rank: null };
}

// ---------- DeepSeek 官方（官方 Responses API + web_search） ----------
async function probeDeepseek(query) {
  const res = await fetch('https://api.deepseek.com/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keys.deepseek },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      tools: [{ type: 'web_search' }],
      input: query,
    }),
  });
  const data = await res.json();

  // 收集最终答案文本 + 模型主动打开的页面 URL（DeepSeek 无 url_citation，用这两种信号）
  let answerText = '';
  const openedUrls = [];
  for (const item of (data.output || [])) {
    if (item.type === 'message') {
      for (const c of (item.content || [])) if (c.text) answerText += c.text + '\n';
    } else if (item.type === 'web_search_call' && item.action?.type === 'open_page' && item.action?.url) {
      openedUrls.push(item.action.url);
    }
  }

  // 主信号：最终答案里出现官网域名
  const hit = answerText.match(/[a-zA-Z0-9.-]*piesat\.cn/g);
  if (hit) return { found: true, rank: 1, source: null, url: 'https://' + hit[0] };
  // 兜底：模型主动打开过官网页面
  const opened = openedUrls.find(u => isOfficial(u));
  if (opened) return { found: true, rank: 1, source: null, url: opened.replace(/#.*$/, '') };
  return { found: false, rank: null };
}

// ---------- 引擎注册表（只跑有 key 的） ----------
const ENGINES = [
  { key: 'doubao', label: '豆包·搜索', needs: 'doubao', run: probeDoubao },
  { key: 'doubao_model', label: '豆包·模型', needs: 'doubao_model', run: probeDoubaoModel },
  { key: 'deepseek', label: 'DeepSeek官方', needs: 'deepseek', run: probeDeepseek },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const queryList = JSON.parse(readFileSync(join(BASE, 'data/query-list.json'), 'utf8'));
  const date = new Date().toISOString().slice(0, 10);

  const onlyEngine = process.argv[2];
  const onlyIds = process.argv.slice(3).map(Number);
  const targets = queryList.filter(q => onlyIds.length === 0 || onlyIds.includes(q.id));
  const active = ENGINES.filter(e => (!onlyEngine || e.key === onlyEngine) && keys[e.needs]);

  if (active.length === 0) {
    console.error('没有可运行的引擎（检查密钥）。可用引擎：', ENGINES.map(e => e.key).join(', '));
    process.exit(1);
  }

  for (const engine of active) {
    console.log(`\n=== [${engine.label}] ${targets.length} 词，日期 ${date} ===`);
    const queries = [];
    for (const q of targets) {
      try {
        const result = await engine.run(q.text);
        queries.push({ id: q.id, ...result });
        console.log(`Q${q.id} ${q.text} → ${result.found ? '已引用 #' + result.rank : '未引用'}`);
      } catch (err) {
        queries.push({ id: q.id, found: false, rank: null, error: String(err.message || err).slice(0, 80) });
        console.log(`Q${q.id} ${q.text} → 出错：${String(err.message || err).slice(0, 80)}`);
      }
      await sleep(500); // 限速，避免超 QPS
    }
    const file = { date, source: engine.key, queries };
    const out = join(BASE, 'data/raw', engine.key, date + '.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(file, null, 2) + '\n', 'utf8');
    const hitN = queries.filter(x => x.found).length;
    console.log(`写入 data/raw/${engine.key}/${date}.json，命中 ${hitN}/${queries.length}`);
  }
  console.log('\n探测完成。运行 node scripts/aggregate.mjs 生成页面数据。');
}

main().catch(err => { console.error(err); process.exit(1); });
