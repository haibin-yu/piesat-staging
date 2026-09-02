# 豆包 / 方舟 联网引用接入要点

> 用途：把仪表盘里「AI 引擎引用」这一层从**人工抽样**升级为**API 自动探测**。
> 两条路径：
> ① **豆包搜索 API（搜索层，免费 500 次/月）**——判断官网内容**进没进豆包搜索库**、排第几（第一~六章，已跑通）。
> ② **方舟 Responses API + `web_search`（模型层，按量计费）**——拿到豆包模型**最终答复实际采用的引用来源**（`url_citation`），更贴近用户在豆包 App 里看到的引用（第七章）。
>
> 结论先行：豆包搜索 API 返回结构化引用来源（每条带 Url / 站点名 / 权威分级），可直接映射到「已引用 / 未引用 + 名次」；但它给的是**搜索层网页列表**，不是「模型答复里实际标注的引用」。要复现后者，走方舟 Responses API 的 `web_search` 工具。

---

## 一、接口信息

| 项 | 值 |
|----|----|
| 接入方式 A（API Key） | `POST https://open.feedcoopapi.com/search_api/web_search` |
| 接入方式 B（AK/SK 鉴权） | `https://mercury.volcengineapi.com?Action=WebSearch&Version=2025-01-01` |
| Method | POST |
| Content-Type | application/json |
| 鉴权 | 请求头 `Authorization: Bearer <API_KEY>`（API Key 方式） |

开通入口：火山引擎控制台 → **联网搜索（搜索 Infinity）** → API Key 管理（`console.volcengine.com/search-infinity/api-key`）。免费 500 次/月/账号（次月 1 日重置）、5 QPS。拿 Key 步骤：注册登录火山引擎 → 实名认证 → 进入 search-infinity 开通 → API Key 管理里创建 → 复制保存。权威分级（`AuthInfoLevel`）走 **Custom 版**才有。

---

## 二、请求参数（web 搜索）

```json
{
  "Query": "pie-engine 遥感",
  "SearchType": "web",
  "Count": 10,
  "Filter": {
    "NeedContent": false,
    "NeedUrl": true
  },
  "TimeRange": "OneYear"
}
```

| 参数 | 必填 | 说明 | 本项目怎么用 |
|------|------|------|-------------|
| `Query` | 是 | 1–100 字符 | 传探测词表的每一条 query |
| `SearchType` | 是 | `"web"` | 固定 web |
| `Count` | 否 | 默认 10，最多 50 | 取 20，覆盖前 20 名 |
| `Filter.NeedUrl` | 否 | `true`=只返回有落地页链接的结果 | 设 `true`，确保能拿到 Url 判断归属 |
| `Filter.Sites` | 否 | 指定站点，`\|` 分隔，最多 20 个 | 反向验证时填 `piesat.cn` |
| `Filter.BlockHosts` | 否 | 屏蔽站点，最多 5 个 | 可屏蔽 `baidu.com` 等噪声 |
| `Filter.AuthInfoLevel` | 否 | `0` 不限 / `1` 仅「非常权威」 | 默认 `0`，另跑一轮 `1` 看权威源 |
| `TimeRange` | 否 | OneDay/OneWeek/OneMonth/OneYear/日期区间 | 一般 `OneYear` |

---

## 三、返回字段（WebItem，映射的关键）

响应结构：`ResponseMetadata`（元信息）→ `Result` → `WebResults: Array[WebItem]`。

`WebItem` 每条结果的核心字段：

| 字段 | 类型 | 说明 | 本项目用哪个 |
|------|------|------|-------------|
| `SortId` | Number | 排序序号（从 1 起） | ✅ **名次** |
| `Title` | String | 标题 | 记录是谁截胡 |
| `SiteName` | String | 站点名（如「搜狐网」「航天宏图」） | ✅ 判断来源 |
| `Url` | String | 落地页链接 | ✅ **判断是否官网** |
| `Snippet` | String | ~200 字片段 | 仅列表展示，不做判断 |
| `Summary` | String | 500–1000 字相关摘要 | 品牌提及的二次判断 |
| `Content` | String | 正文 | 可选 |
| `PublishTime` | String | ISO 时间 | 时效性判断 |
| `RankScore` | Float | 相关性得分 0–1 | 排名质量 |
| `AuthInfoDes` | String | 权威度描述（非常权威/正常权威/一般权威/一般不权威） | ✅ 权威分级 |
| `AuthInfoLevel` | Number | 1 非常权威 / 2 正常 / 3 一般 / 4 一般不权威 | ✅ 权威分级 |

---

## 四、字段映射到仪表盘

### 判定口径（与现有仪表盘完全一致）

> 「已引用」= 官网 `piesat.cn` 出现在该 query 的搜索结果里；名次 = 它在结果列表里的序号。

### 映射规则

| 仪表盘字段 | 豆包 API 来源 |
|-----------|--------------|
| `found`（已引用） | 遍历 `WebResults`，存在任一条 `Url` 含 `piesat.cn` → `true`，否则 `false` |
| `rank`（名次） | 命中那条的 `SortId`（即数组下标 + 1） |
| 竞品密度 | `WebResults.length`（返回结果总条数） |
| 来源类型 | `SiteName` + `AuthInfoDes`（谁截胡了，是权威源还是普通源） |

### 转换伪代码

```javascript
// 对每条 query 调一次 web_search，返回 result.Result.WebResults
function mapToDashboard(webResults) {
  const hit = webResults.find(r => r.Url && r.Url.includes('piesat.cn'));
  if (hit) {
    return {
      found: true,
      rank: hit.SortId,            // 名次
      source: hit.SiteName,        // 官网子域/栏目名
      authority: hit.AuthInfoDes,  // 官网这条的权威分级
    };
  }
  return { found: false, rank: null };
}
```

### 两个探测方向

1. **正向探测（主）**：正常搜 query（不限站点），看 `piesat.cn` 是否进 `WebResults` 及名次 → 直接喂给仪表盘 `aiScans`。
2. **收录验证（辅）**：`Filter.Sites = "piesat.cn"`，只看豆包搜索库里有没有官网内容 → 验证豆包是否已收录官网博客（独立于排名）。

### 落盘位置

写进 `tracking-data.json` 的 `aiScans[]`。**结构按渲染层实际读取的 `engines` 格式**（不是 `baiduScans` 的扁平 `found/rank`）：

```json
{
  "date": "2026-09-01",
  "source": "doubao-api",
  "summary": "豆包搜索 API 自动探测 30 词：命中 3/30（10%）…",
  "queries": [
    { "id": 1,  "engines": { "doubao": { "found": false, "rank": null } } },
    { "id": 17, "engines": { "doubao": { "found": true, "rank": 1, "source": "PIE-Engine", "authority": "正常权威", "url": "https://engine.piesat.cn/download-home" } } }
  ]
}
```

要点：
- 每个 query 挂 `engines` 对象，引擎键（`doubao`/`deepseek`/`kimi`）对应各自结果；**未接入的引擎不写键**，渲染层会显示「未抽样」而非「未引用」。
- 命中时 `found=true` 并带 `rank`（SortId）；可额外带 `source`/`authority`/`url` 供审计（渲染层忽略，但数据留痕）。
- 未命中：`{ "found": false, "rank": null }`。

---

## 五、免费配额与限制

| 项 | 值 | 影响 |
|----|----|----|
| 免费额度 | **500 次 / 月 / 账号** | 30 条 query 一轮 = 30 次，每月可跑约 16 轮，够每周用 |
| 默认 QPS | 5 | 串行请求即可，无需并发 |
| Query 长度 | 1–100 字符 | 探测词表均满足 |
| 上线时间 | 2026-07-28 发布 | 较新，字段可能迭代 |

> 注意：豆包搜索的「web 搜索」结果与用户在豆包 App 里问 AI 得到的**引用**是两回事——API 给的是**搜索层**结果（相当于「豆包搜索的网页列表」），不是「豆包大模型最终答复里实际标注的引用」。若要精确复现用户问 AI 时的引用，仍需人工抽样比对；但 API 这层已经能自动判断「官网内容是否进豆包搜索库 + 排第几」，作为收录监控足够。

---

## 六、落地建议

1. **先拿 Key 跑通一条**：开通后先对「pie-engine 遥感」跑一次，核对 `WebResults` 里官网是否在 #1（应与已跑通结论一致），验证映射无误。
2. **每周一轮**：30 条 query 串行跑，每条约 1 次调用，一轮 30 次，远低于 500 次月配额。
3. **与 DeepSeek / Kimi 并列**：DeepSeek（V4-Flash Responses API 的 `web_search` → `search_results`）与 Kimi（`$web_search` 工具 → 内联 citations）同样能返回引用来源，三引擎可共用同一套「Url 是否含 piesat.cn → found/rank」的判定逻辑，把 `aiScans` 从「人工抽样」整体升级为「API 自动探测 + 人工抽检兜底」。

---

## 七、方舟 Responses API + web_search（模型层引用）

> 路径①（豆包搜索 API）拿的是**搜索层**结果——官网内容进没进豆包搜索库、排第几。若要复现「用户在豆包 App 问 AI 时，AI 答复底部标注的那几个引用」，走这条路径②：火山方舟的 Responses API 联网搜索，返回模型最终答复**实际采用**的引用（`url_citation`）。

### 接口信息

| 项 | 值 |
|----|----|
| 端点 | `https://ark.cn-beijing.volces.com/api/v3/responses` |
| Method | POST |
| Content-Type | application/json |
| 鉴权 | 请求头 `Authorization: Bearer <ARK_API_KEY>`（方舟 API Key，**与 search-infinity 的 Key 不通用，需单独创建**） |
| 开通 | 方舟控制台 → 服务组件库 → 联网内容插件 → 开通（免费开通，按 token + 搜索次数计费） |

### 请求示例

```json
{
  "model": "deepseek-v4-flash-ga-260731",
  "tools": [{"type": "web_search"}],
  "input": "雷达卫星为什么能穿透云层"
}
```

### 返回里的引用字段（2026-09-01 已实测跑通）

- `output` 数组里有三类条目：`web_search_call`（只含搜索 query，**不含结果**）、`reasoning`（推理过程）、`message`（最终回答）。
- **引用来源在 `message.content[0].annotations[]` 数组里**，每条 `type == "url_citation"`，字段如下（实测返回）：

| 字段 | 说明 |
|------|------|
| `type` | 固定 `"url_citation"` |
| `title` | 引用标题 |
| `url` | **引用落地页 URL（判断官网命中的关键）** |
| `site_name` | 站点名 |
| `publish_time` | 发布时间 |
| `summary` | 摘要 |
| `logo_url` | 站点图标 |

- **判定**：遍历 `annotations`，存在 `url` 含 `piesat.cn` → `found=true`，名次 = 它在数组里的序号（下标 + 1）。
- **实测样例**：`pie-engine 遥感` → 引用第 1 条即 `https://engine.piesat.cn/engine-studio/docs/`（官网命中 **rank=1**），第 2/3/4 条为 escience.org.cn、北京市科委；与路径①搜索层「engine.piesat.cn 排 #1」结论一致。

### 推荐模型

| 模型 | 特点 | 耗时 |
|------|------|------|
| `deepseek-v4-flash-ga-260731` | 自动多轮搜索，来源丰富质量高（**已实测跑通**） | ~15s |
| `doubao-seed-2-0-mini-260428` | 最快最省，通常只搜 1 轮 | ~8s |
| `doubao-seed-2-1-pro-260628` | 深度推理 | ~70s |

### 与路径①的关系

- **路径①（豆包搜索 API）**：免费 500 次/月，适合**每周批量跑 30 词**，监控「收录 + 排名」。
- **路径②（方舟 Responses API）**：按量计费，适合**抽检核心词**，验证「模型实际引用官网没有」，更贴近 App 真实体验。
- 两者共用同一套「URL 含 piesat.cn → found/rank」判定，结果可并存进 `aiScans`（如 `engines.doubao` = 搜索层、`engines.doubao_model` = 模型层）。
