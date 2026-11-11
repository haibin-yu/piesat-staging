// 一次性迁移脚本：把 8/9/10 月历史数据生成 monthly/ 快照 + summary.json。
// 复用 freeze-month / backfill-baidu / monthly-store；跑完保留作历史参考。
import { freezeMonth } from './freeze-month.mjs';
import { backfillBaidu } from './backfill-baidu.mjs';
import { mergeMonthly, upsertSummaryMonth } from './monthly-store.mjs';

// 8 月竞品内容形态：从 data/raw/websearch/2026-08-*.json 提取（competitorCount 平均约 9.9，contentTypes 几乎全 article，video/qa 为 0）
const COMPETITOR_INSIGHT = '8 月竞品内容形态：海外索引结果以文章为主（竞品约 10 条/词），视频与问答内容为 0，存在视频/问答占位空白。';

for (const month of ['2026-08', '2026-09', '2026-10']) {
  backfillBaidu(month);
}
for (const month of ['2026-09', '2026-10']) {
  freezeMonth(month);
}
// 8 月无 AI 引擎探测（2026-09-01 才开启），补 ai:null + 竞品洞察 + summary 的 aiHitRate:null
mergeMonthly('2026-08', { ai: null, competitorInsight: COMPETITOR_INSIGHT });
upsertSummaryMonth({ month: '2026-08', aiHitRate: null, probedTotal: null });

console.log('迁移完成：8/9/10 月快照 + summary.json 已生成');
