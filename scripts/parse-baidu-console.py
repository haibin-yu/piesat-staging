#!/usr/bin/env python3
# 解析百度站长平台导出的 .numbers（PC/移动两个文件）→ data/raw/baidu-console/<period>.json
# 用法：每月拿到 .numbers 后改下面三个变量重跑即可。
# 依赖：numbers_parser（pip install numbers-parser）
from numbers_parser import Document

PC_PATH = "/Users/haibinyu/Desktop/航天宏图/数据监测/数据监测10月 /百度站长数据-10月pc端.numbers"
MB_PATH = "/Users/haibinyu/Desktop/航天宏图/数据监测/数据监测10月 /百度站长数据-10月移动端.numbers"
AI_PATH = "/Users/haibinyu/Desktop/航天宏图/数据监测/数据监测10月 /百度站长数据-AI热门关键词下载10月.numbers"
OUT = "/Users/haibinyu/Desktop/航天宏图/geo-监测仪表盘/data/raw/baidu-console/2026-10.json"

PERIOD = "2026-10"
IMPORTED_AT = "2026-11-11"
# 百度站长平台 AI 搜索模块：官网页面被 AI 答案引用的次数（10 月起导出「AI 热门关键词」明细，AI_CITED 从该文件汇总，不再硬编码）

def rows_of(path):
    doc = Document(path)
    return doc.sheets[0].tables[0].rows()

def parse_pc(path):
    out = []
    for i, r in enumerate(rows_of(path)):
        if i == 0:  # 表头：关键词 / 点击量 / 展现量 / 点击率 / 排名
            continue
        v = [c.value for c in r]
        kw, click, show, ctr, rank = v[0], v[1], v[2], v[3], v[4]
        out.append({
            "kw": str(kw).strip(),
            "show": int(show or 0),
            "click": int(click or 0),
            "ctr": float(str(ctr).replace('%', '')) if ctr is not None else 0.0,  # '5.46%' -> 5.46
            "rank": float(rank) if rank is not None else None,
            "url": "",
        })
    return out

def parse_mobile(path):
    out = []
    for i, r in enumerate(rows_of(path)):
        if i == 0:  # 表头：序号 / 关键词 / 展现量 / 点击量 / 点击率 / 实例url
            continue
        v = [c.value for c in r]
        kw, show, click, ctr, url = v[1], v[2], v[3], v[4], v[5]
        out.append({
            "kw": str(kw).strip(),
            "show": int(show or 0),
            "click": int(click or 0),
            "ctr": float(ctr) * 100 if ctr is not None else 0.0,  # 0.02 -> 2.0（百分比数值）
            "rank": None,
            "url": str(url).strip() if url else "",
        })
    return out

def parse_ai_keywords(path):
    # 表头：关键词 / AI引用量 / AI曝光量 / AI点击量 / AI点击率
    out = []
    for i, r in enumerate(rows_of(path)):
        if i == 0:
            continue
        v = [c.value for c in r]
        kw, cited, show, click, ctr = v[0], v[1], v[2], v[3], v[4]
        out.append({
            "kw": str(kw).strip(),
            "cited": int(cited or 0),
            "show": int(show or 0),
            "click": int(click or 0),
            "ctr": float(str(ctr).replace('%', '')) if ctr is not None else 0.0,
        })
    return out

pc_rows = parse_pc(PC_PATH)
mb_rows = parse_mobile(MB_PATH)
ai_keywords = parse_ai_keywords(AI_PATH)
AI_CITED = sum(k["cited"] for k in ai_keywords)

data = {
    "source": "baidu-search-console",
    "note": "百度站长平台第一方搜索数据（用户在百度真实搜索、官网被展现/点击的真实回流）。ctr 为百分比数值，rank 为百度平均排名（仅 PC 端有）。",
    "period": PERIOD,
    "importedAt": IMPORTED_AT,
    "ai": {
        "cited": AI_CITED,
        "note": "官网页面被百度 AI 答案引用的次数（百度站长平台 AI 搜索模块；AI 引用量 为「AI 热门关键词」各词 cited 之和）",
        "keywords": ai_keywords,
    },
    "devices": [
        {
            "device": "pc",
            "label": "PC 端",
            "totalShow": sum(r["show"] for r in pc_rows),
            "totalClick": sum(r["click"] for r in pc_rows),
            "rows": pc_rows,
        },
        {
            "device": "mobile",
            "label": "移动端",
            "totalShow": sum(r["show"] for r in mb_rows),
            "totalClick": sum(r["click"] for r in mb_rows),
            "rows": mb_rows,
        },
    ],
}

import json
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"✅ 生成 {OUT}")
print(f"   PC 端：{len(pc_rows)} 词，展现 {data['devices'][0]['totalShow']}，点击 {data['devices'][0]['totalClick']}")
print(f"   移动端：{len(mb_rows)} 词，展现 {data['devices'][1]['totalShow']}，点击 {data['devices'][1]['totalClick']}")
print(f"   AI 引用：{AI_CITED}")
