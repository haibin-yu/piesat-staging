// 月度定格快照 + 汇总的共享存储：所有读写幂等，供 freeze-month / backfill-baidu / migrate-monthly 复用。
// 结构：data/monthly/{YYYY-MM}.json（月度快照，只存聚合）+ data/summary.json（各月关键指标汇总）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

const monthlyPath = (month, base) => join(base, 'data', 'monthly', month + '.json');
const summaryPath = base => join(base, 'data', 'summary.json');

// '2026-08' → 对象 | null
export function readMonthly(month, base = DEFAULT_BASE) {
  try {
    return JSON.parse(readFileSync(monthlyPath(month, base), 'utf8'));
  } catch {
    return null;
  }
}

// 读 + 浅合并 + 写回，返回结果；幂等。首次创建时定格 frozenAt，后续合并保留原 frozenAt。
export function mergeMonthly(month, patch, base = DEFAULT_BASE) {
  const existing = readMonthly(month, base);
  const merged = existing
    ? { ...existing, ...patch, month }
    : { month, frozenAt: new Date().toISOString(), ...patch };
  mkdirSync(dirname(monthlyPath(month, base)), { recursive: true });
  writeFileSync(monthlyPath(month, base), JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

// → { months: [] } | null
export function readSummary(base = DEFAULT_BASE) {
  try {
    return JSON.parse(readFileSync(summaryPath(base), 'utf8'));
  } catch {
    return null;
  }
}

// entry = { month, ... }，按 month 定位 upsert；months 始终按 month 升序。
export function upsertSummaryMonth(entry, base = DEFAULT_BASE) {
  const summary = readSummary(base) || { months: [] };
  const i = summary.months.findIndex(m => m.month === entry.month);
  if (i >= 0) summary.months[i] = { ...summary.months[i], ...entry };
  else summary.months.push(entry);
  summary.months.sort((a, b) => a.month.localeCompare(b.month));
  mkdirSync(dirname(summaryPath(base)), { recursive: true });
  writeFileSync(summaryPath(base), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return summary;
}
