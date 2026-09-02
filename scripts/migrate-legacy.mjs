// 一次性迁移脚本：tracking-data.json → data/raw/ 分文件
// 把旧的单文件数据拆成按「来源/引擎」分目录的 append-only 结构。
// 跑完后 tracking-data.json 保留作备份，本脚本保留作历史参考。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = '/Users/haibinyu/Desktop/航天宏图/geo-监测仪表盘';
const src = JSON.parse(readFileSync(join(BASE, 'tracking-data.json'), 'utf8'));

const write = (relPath, obj) => {
  const full = join(BASE, 'data/raw', relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log('写入', relPath);
};

// 1) WebSearch 海外索引（手动层）
for (const s of src.scans) write(`websearch/${s.date}.json`, s);

// 2) 百度人工搜索（手动层）
for (const s of src.baiduScans) write(`baidu/${s.date}.json`, s);

// 3) AI 引擎（自动层）：aiScans 里每个 query 的 engines 按引擎拆成独立文件
const ENGINE_DIR = {
  doubao: 'doubao',
  doubao_model: 'doubao_model',
  deepseek: 'deepseek',
  ark_deepseek: 'ark_deepseek',
};
for (const s of src.aiScans) {
  for (const [key, dir] of Object.entries(ENGINE_DIR)) {
    const queries = s.queries.map(q => ({
      id: q.id,
      ...(q.engines[key] || { found: false, rank: null }),
    }));
    write(`${dir}/${s.date}.json`, { date: s.date, source: key, queries });
  }
}

// 4) 百度站长第一方数据（手动层）
write(`baidu-console/${src.baiduSearchConsole.period}.json`, src.baiduSearchConsole);

console.log('迁移完成');
