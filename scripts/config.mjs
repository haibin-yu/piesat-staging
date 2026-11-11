// 模板化配置读取：所有脚本/页面共用一份 config.json，品牌名/站点/引擎/词表路径不写死在代码里。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(base = BASE) {
  return JSON.parse(readFileSync(join(base, 'config.json'), 'utf8'));
}
