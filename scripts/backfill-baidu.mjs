// 回填脚本：把客户导出的百度站长第一方数据（parse 后）填进 data/monthly/{month}.json 的 baiduConsole + 更新 summary.json。
// 用法：node scripts/backfill-baidu.mjs 2026-09
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeMonthly, upsertSummaryMonth } from './monthly-store.mjs';

const DEFAULT_BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

// 百度站长 schema → 聚合计数；ai.cited 缺省自适应为 null（Review Focus 5）
export function aggregateBaiduConsole(consoleJson) {
  const pc = (consoleJson.devices || []).find(d => d.device === 'pc') || { rows: [], totalShow: 0, totalClick: 0 };
  const mobile = (consoleJson.devices || []).find(d => d.device === 'mobile') || { rows: [], totalShow: 0, totalClick: 0 };
  return {
    period: consoleJson.period,
    pc: { keywords: (pc.rows || []).length, show: pc.totalShow || 0, click: pc.totalClick || 0 },
    mobile: { keywords: (mobile.rows || []).length, show: mobile.totalShow || 0, click: mobile.totalClick || 0 },
    ai: { cited: consoleJson.ai?.cited ?? null },
  };
}

// 主流程：读 data/raw/baidu-console/{month}.json → 聚合 → 写 monthly + summary
export function backfillBaidu(month, base = DEFAULT_BASE) {
  const consoleJson = JSON.parse(readFileSync(join(base, 'data/raw/baidu-console', month + '.json'), 'utf8'));
  const baiduConsole = aggregateBaiduConsole(consoleJson);
  mergeMonthly(month, { baiduConsole }, base);
  upsertSummaryMonth({
    month,
    pcShow: baiduConsole.pc.show,
    pcClick: baiduConsole.pc.click,
    mobileShow: baiduConsole.mobile.show,
    mobileClick: baiduConsole.mobile.click,
    aiCited: baiduConsole.ai.cited,
  }, base);
  return baiduConsole;
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const month = process.argv[2];
  if (!month) { console.error('用法：node scripts/backfill-baidu.mjs <month>'); process.exit(1); }
  const r = backfillBaidu(month);
  console.log(`回填 ${month}：PC ${r.pc.keywords} 词/展现 ${r.pc.show}/点击 ${r.pc.click}，移动 ${r.mobile.keywords} 词，AI 引用 ${r.ai.cited}`);
}
