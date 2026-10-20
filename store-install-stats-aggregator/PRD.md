# 三端商店安装量聚合接口与官网展示 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 产品 | 三端商店安装量聚合开源项目 |
| 版本 | V1.0（需求草案） |
| 状态 | 待评审 |
| 目标平台 | Chrome Web Store、Microsoft Edge Add-ons、Firefox Add-ons |
| 部署原则 | 开源、可配置、无自建服务器优先 |
| 统计口径 | 仅展示首次上架以来累计成功安装事件；不以用户数、下载量或活跃用户数替代 |

## 2. 背景与问题

官网目前只有商店安装入口，没有统一展示 Chrome、Edge、Firefox 三端的累计安装数。三个商店的数据口径和接口能力不同：

- Chrome 的精确安装/卸载分析位于开发者后台；商店详情页会公开展示一个用户数，但它不是安装事件数，页面采集也没有稳定 API 保证。
- Edge 的安装量和周用户数主要位于 Partner Center Analytics，未提供稳定的公开统计接口。
- Firefox AMO 公开 API 提供 `average_daily_users` 和 `weekly_downloads`，开发者统计也以用户和下载分析为主；这些都不是累计成功安装事件数。

旧项目 [Chrome-Webstore-Stats-API](https://github.com/navi1995/Chrome-Webstore-Stats-API) 已验证了“服务端抓取 Chrome 商店页面并返回 JSON”的基本思路，但项目较旧，仅支持 Chrome，且依赖页面正则解析，不能直接作为三端生产方案。

## 3. 产品目标

### 3.1 必须实现

1. 采集三个商店从首次上架以来的累计成功安装事件数；无同口径数据时明确不可用。
2. 官网展示分平台累计安装数、可计算的三端合计、来源和统计时间范围。
3. 单个平台报表缺失时不影响其他平台分项展示；缺失平台阻止三端合计。
4. 数据过期或不可用时明确显示状态，不展示误导性的 `0`，也不以用户数、下载量替代安装数。
5. 官网前端不保存商店账号、Cookie、API 密钥或其他敏感凭据。
6. 支持后续增加 Opera、Firefox Developer Edition 等平台适配器。

### 3.2 开源与可配置要求

1. 所有商店 ID、采集开关、输出路径和过期策略都通过配置文件管理，不写死在导入器中。
2. 默认运行不需要自建服务器；维护者导出官方报表后，通过本地脚本或 GitHub Actions 校验并生成静态 JSON。
3. 需要公开动态接口时，提供可选的 Cloudflare Worker 部署方式；Worker 只做缓存和接口转发，不保存商店账号凭据。
4. 提供本地 Node.js 命令用于开发、fixture 测试和手动采集。
5. 采集器、规范化层、存储层和官网展示层解耦，方便社区贡献新的商店适配器。

### 3.3 不在本期范围

- 不统计真实的实时在线用户数。
- 不通过插件主动上报用户设备标识来估算安装量。
- 不绕过商店登录、验证码、反爬或访问控制。
- 不把 Firefox 周下载量直接伪装为累计安装量。
- 不在浏览器端直接请求需要凭据的商店后台接口。

## 4. 关键口径

### 4.1 指标类型

每条数据必须带有明确的 `metricType`：

| 类型 | 含义 | 是否可加入总计 |
| --- | --- | --- |
| `cumulative_install_events` | 首次上架以来累计成功安装事件数；按各商店官方报表定义计算 | 只有统计起点一致、历史区间完整时才参与三端合计 |
| `unavailable` | 当前无法取得上述累计安装事件数 | 不参与计算；只要有平台不可用，就不显示三端合计 |

只展示累计安装事件数。商店页面展示用户数、当前用户数、平均每日用户、周用户、下载量均不能代替安装事件。三端任一平台无完整累计安装数据时，仍可展示有数据的平台累计数，但三端合计显示“暂无法计算”。

### 4.2 累计区间定义

“累计安装总数”定义为从商店首次上架日起，官方报表记录的成功安装事件之和；报表明确计入的回访/重装事件也计入总数。它不代表去重用户数或当前仍安装的用户数。页面显示统计起点与报表导出时间，不使用“实时安装量”。

## 5. 用户与使用场景

### 5.1 官网访客

希望快速了解插件在不同浏览器商店的安装规模，并能判断数据是否为最新。

### 5.2 项目维护者

希望新增或替换官方报表来源时不修改官网展示逻辑，只需增加一个 CSV 导入器。

### 5.3 运维人员

希望看到导入失败原因、最后成功数据和过期状态，能够重导单个平台而不影响其他数据。

## 6. 推荐技术方案

### 6.1 总体架构

```text
维护者从商店开发者后台导出官方 CSV
        |
        +-- Chrome CSV importer
        +-- Edge CSV importer
        +-- Firefox unavailable（当前无同口径来源）
        |
        +-- 规范化、校验、缓存、失败降级
        |
        +-- stats.json 或 /api/v1/store-stats
                         |
                      官网读取
```

首期推荐使用维护者从各商店开发者后台导出的安装统计 CSV，经过本地脚本校验并生成静态 `stats.json`，再由 GitHub Pages 发布；不在自动化中保存或使用后台登录凭据。Chrome 和 Edge 的官方报表可用于累计每日成功安装事件；Firefox 当前可验证的公开 API 字段不是安装事件，不能形成三端合计。Firefox 没有可验证的完整累计安装报表/导出前，标记 `unavailable`。Cloudflare Worker 不会补足缺失的官方数据，也不作为后台抓取代理。

### 6.2 配置与运行模式

项目提供 `config.example.json`，实际配置通过仓库文件或环境变量覆盖：

```json
{
  "stores": {
    "chrome": {
      "enabled": true,
      "extensionId": "emoeojemgbjcogiodobkpeohoailphgg",
      "source": "manual_export_csv"
    },
    "edge": {
      "enabled": true,
      "productId": "gafbkmdjmeamppdonbdcoekfcagfpcck",
      "source": "manual_export_csv"
    },
    "firefox": {
      "enabled": false,
      "guid": "github-chinese-localization@caodan.io",
      "source": "unavailable"
    }
  },
  "output": {
    "jsonPath": "assets/data/store-stats.json",
    "staleAfterHours": 48
  }
}
```

支持三种运行模式。运行时配置包含来源、开关、输出和过期策略；不配置自动登录或后台轮询计划。

| 模式 | 用途 | 是否需要服务器 |
| --- | --- | --- |
| GitHub Actions | 手动触发，校验已提供的官方 CSV/规范化输入后提交静态 `stats.json`、触发官网部署 | 否 |
| Cloudflare Worker | 仅在需要动态只读 API 时评估；不能获取后台数据或补足缺失平台 | 否，使用 CF 托管 |
| 本地 Node.js | 校验导出数据、合计完整历史区间、生成静态 JSON、fixture 测试 | 否 |

默认由维护者导出数据后运行本地脚本或手动触发 GitHub Actions。不得定时登录后台或将后台 Cookie/令牌放入自动任务。若后续出现官方授权 API，再单独评估自动同步。

### 6.3 适配器接口

每个平台实现统一接口：

```ts
type StoreStats = {
  store: 'chrome' | 'edge' | 'firefox';
  metricType: 'cumulative_install_events' | 'unavailable';
  value: number | null;
  unit: 'install_events';
  periodStart: string | null;
  periodEnd: string | null;
  reportedAt: string | null;
  dataQuality: 'official_dashboard_export' | 'none';
  sourceUrl: string;
  status: 'ok' | 'stale' | 'unavailable';
  error?: string;
};
```

导入器只负责解析并校验后台导出的安装报表；公共层验证统计起点、每日数据连续性、非负整数和来源后计算累计值。公开输出不得包含后台 CSV 原文、Cookie 或其他账号数据。

### 6.4 Chrome 适配器

- 输入：Chrome 扩展 ID `emoeojemgbjcogiodobkpeohoailphgg`。
- 官方分析数据位于开发者后台，包含按日安装/卸载报表，可按日期范围筛选并导出 CSV。商店详情页显示的 `20,000 users` 不是累计成功安装事件数，不得用于本需求。
- 通过后台导出完整的首次上架日至当前日每日安装报表，求和得到 `cumulative_install_events`。Chrome 报表包含新用户和回访用户，因此结果表示累计安装事件，不代表去重用户数或当前仍安装数量。
- 只有确认导出覆盖完整历史区间、每日行无缺失且字段语义为 installs 后才发布数值；无法确认时标记 `unavailable`，不以商店页面展示人数代替。

### 6.5 Edge 适配器

- 输入：Edge 产品 ID `gafbkmdjmeamppdonbdcoekfcagfpcck`。
- 官方来源：Partner Center Analytics 支持 All time（自扩展上架起）范围，Installs 指标为每日成功安装数，并可导出 CSV。
- 维护者导出完整 All time 每日安装报表；校验日期连续、指标列明确为成功安装后求和，标记 `dataQuality: official_dashboard_export`。
- 公开详情页中的 Schema.org `userInteractionCount` 语义未确认，不得映射为安装量；也不使用开发者后台 Cookie 写入仓库或前端。

### 6.6 Firefox 适配器

- AMO API 返回 `average_daily_users`、`weekly_downloads` 等字段，不提供累计成功安装事件数；下载不等于成功安装。
- 本次验证的 AMO GUID API 返回 HTTP 200，但不存在本需求所需的累计安装字段。Firefox 暂标 `unavailable`，不以用户数、下载数或页面标签替代。
- 只有 Mozilla 后续提供明确的安装事件累计字段或官方导出，且可验证自首次上架以来完整区间，才启用 Firefox 数据。

### 6.7 首期采集范围

| 平台 | 首期数据源 | 自动化 | 对外指标 | 失败时 |
| --- | --- | --- | --- | --- |
| Chrome | Developer Dashboard 首次上架日至今每日 Installs CSV | 手动导出并本地求和 | 累计成功安装事件 | 区间不完整或字段不明确时不可用 |
| Edge | Partner Center All time 每日 Installs CSV | 手动导出并本地求和 | 累计成功安装事件 | 区间不完整或字段不明确时不可用 |
| Firefox | 当前 AMO API 无累计成功安装字段 | 暂不可采集 | 不展示替代数字 | `unavailable` |

三端合计只有在 Chrome、Edge、Firefox 都提供首次上架以来完整的成功安装事件数时才显示。当前 Firefox 数据源缺失，因此默认不显示三端合计；可以展示 Chrome 和 Edge 各自的累计数，并将 Firefox 标为不可用。Chrome/Edge 的实际安装事件定义及统计起点需在首次导入时核验一致。

## 7. 数据文件与接口

### 7.1 官网静态数据文件

建议路径：`assets/data/store-stats.json`。

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-20T12:00:00Z",
  "summary": {
    "comparableTotal": null,
    "isComparable": false
  },
  "stores": [
    {
      "store": "chrome",
      "metricType": "cumulative_install_events",
      "value": 25000,
      "unit": "install_events",
      "periodStart": "YYYY-MM-DD",
      "periodEnd": "YYYY-MM-DD",
      "reportedAt": "2026-10-20T02:40:00Z",
      "dataQuality": "official_dashboard_export",
      "sourceUrl": "https://chrome.google.com/webstore/devconsole",
      "status": "ok"
    }
  ]
}
```

### 7.2 API 形式（后续可选）

```http
GET /api/v1/store-stats
```

响应必须包含 `schemaVersion`、`generatedAt`、各平台 `metricType`、`value`、`unit`、`periodStart`、`periodEnd`、`reportedAt`、`dataQuality`、`status` 和 `sourceUrl`。接口应支持 `Cache-Control`，默认缓存 10～60 分钟。示例数字仅用于展示结构，不代表真实商店数据。

若后续部署 Cloudflare Worker，必须支持：

- `GET /api/v1/store-stats`：读取规范化统计结果；
- `GET /api/v1/store-stats?store=chrome`：读取单个平台结果；
- `GET /health`：返回 Worker 和数据缓存状态；
- `Access-Control-Allow-Origin` 白名单配置；
- 基于 Cloudflare Cache API 的响应缓存；
- 上游失败时返回最近一次成功数据和 `status: "stale"`。

接口默认只读，不提供公开写入和任意 URL 抓取能力，避免被滥用为代理。

## 8. 官网展示要求

新增“安装量统计”卡片，至少包含：

- Chrome、Edge、Firefox 三个平台行。
- 各平台累计成功安装事件数和统计起点。
- 报表导出时间。
- 数据状态：正常、数据过期、暂不可用。
- 各平台商店链接。
- 只有三个平台都有完整、同定义历史区间时才显示合计；否则显示“暂无法计算三端累计安装总数”，并保留有数值的平台分项。

加载失败时保留最后一次成功数据，并显示“数据可能已过期”；没有历史数据时显示“暂无法获取”，不能显示 `0`。

## 9. 更新与失败策略

1. 不自动登录商店后台；维护者按需导出 All time CSV 并触发校验/发布。
2. 每个平台导入时验证首次上架日期、最后统计日期、日期连续性、每日值为非负整数及列名含义。
3. 缺失日期、截断区间、重复行或指标列不明时失败关闭，不能发布部分求和值。
4. 成功后原子写入数据文件，避免官网读取半写入 JSON。
5. 导出时间超过 48 小时标记 `stale`；重导出后恢复 `ok`。
6. 任何平台状态为 `stale` 或 `unavailable` 时不显示三端合计。

## 10. 安全与合规要求

- 不在 GitHub Pages 前端暴露商店账号、Cookie、Access Token 或 Partner Center 凭据。
- 不绕过登录、验证码、访问频率限制或反爬机制。
- 遵守各商店的服务条款、robots 和合理请求频率。
- 导出的报表只输出官网展示所需的聚合安装总数与统计起点，不公开原始明细。
- 第三方抓取服务若不可验证数据来源、隐私政策或稳定性，不作为生产依赖。
- 官网文案必须区分“安装量”“用户数”“下载量”，避免营销性误导。

### 10.1 开源交付要求

首期目录建议如下：

```text
store-install-stats-aggregator/
├── PRD.md
├── README.md
├── config.example.json
├── src/
│   ├── collectors/
│   ├── normalize/
│   └── storage/
├── worker/cloudflare/
├── fixtures/
├── scripts/
├── tests/
└── .github/workflows/update-stats.yml
```

必须提供：

- `config.example.json`，不提交真实密钥和后台 Cookie；
- 本地运行、测试、GitHub Actions 和 Cloudflare Worker 部署说明；
- 采集器贡献约定和 fixture 更新流程；
- 开源许可证和第三方依赖清单；
- 示例 API 响应与故障排查说明。

## 11. 累计安装数来源验证（2026-10-20）

使用临时 Node.js 普通脚本对 PRD 中配置的三个扩展标识发起一次 HTTPS GET；未登录开发者后台、未使用凭据，也未修改/安装浏览器插件。

| 来源 | 结果 | 方案结论 |
| --- | --- | --- |
| Chrome Web Store 详情页 | HTTP 200；可见 `20,000 users` | 这不是累计安装事件数，不采纳。官方 Developer Dashboard 提供按日 Installs/Uninstalls 报表和 CSV；需由发布者导出完整历史区间。 |
| Edge Add-ons 详情页 | HTTP 200；含 Schema.org `userInteractionCount=12262`，语义无法确认 | 不采纳。官方 Partner Center Analytics 支持 All time（自上架以来）和每日成功安装数 CSV；这是候选数据源。 |
| AMO API（按 GUID） | HTTP 200；字段含 `average_daily_users`、`weekly_downloads`，无累计安装事件字段 | 用户数与下载量均不采纳；Firefox 当前标记不可用，因此不能形成三端合计。 |

本次只验证公开入口和 API 字段，并查阅三家官方统计说明；没有登录后台或取得 Chrome/Edge CSV，也未验证其历史区间完整性。Firefox 缺少目标指标，当前方案不能输出可信的三端累计总数。用户数和下载量不作为替代值。

## 12. 测试要求

### 12.1 单元测试

- Chrome 与 Edge 准备有效、缺日期、重复日期、无效值/错列名 CSV fixture；Firefox 准备 unavailable 状态 fixture。fixture 不包含后台凭据或完整分析报表。
- 验证完整历史日期范围求和、安装事件指标名称、统计起点、过期判断和三端汇总门槛。
- 验证任一日期缺口、无效 CSV、Firefox 不可用均不会发布错误的 0 或三端总计。

### 12.2 集成测试

- Chrome、Edge 可独立导入并重算单个平台。
- Firefox 无同口径报表时仍生成完整 JSON，并正确标记 unavailable。
- 官网可以读取旧数据、处理新字段和处理缺失平台。
- `stats.json` schema 校验失败时阻止提交。

### 12.3 验收标准

- Chrome、Edge 汇总值与官方 All time 导出报表的每日数据总和一致。
- 存在日期缺口或无效报表时阻止发布该平台数字。
- Firefox 不提供累计安装报表时展示 unavailable，不显示三端合计。
- 页面明确展示统计区间和报表导出时间。
- 前端代码和公开仓库中不存在商店后台凭据。

## 13. 实施阶段

### Phase 1：数据模型与 Chrome/Edge 报表导入

1. 创建 `stats.json` schema，仅支持 `cumulative_install_events` 与 `unavailable`。
2. 实现 Chrome/Edge All time 每日安装 CSV 导入、区间完整性校验和累计求和。
3. Firefox 明确输出 `unavailable`，不接入 AMO 周下载/用户数字段。
4. 完成本地 CSV fixture、schema 校验和过期展示。

### Phase 2：Firefox 数据源评估

1. 只接受 Mozilla 官方新增的累计安装事件 API 或后台导出。
2. 用户数、下载量和页面展示值一律不映射为累计安装。

### Phase 3：官网展示与三端汇总门槛

1. 展示 Chrome/Edge 的分平台累计成功安装事件和统计起点。
2. 仅当 Firefox 也提供完整同口径区间数据时计算三端合计。
3. 任一平台缺数据或历史区间不完整时显示暂无法计算合计。

### Phase 4：无服务器手动发布与监控

1. 建立 GitHub Actions 手动 dispatch，处理维护者提供的官方报表，不自动登录后台。
2. 生成并提交 `assets/data/store-stats.json`，触发 GitHub Pages 更新。
3. 提供可选 Cloudflare Worker 部署和公开只读 API。
4. 增加失败告警、数据新鲜度检查和官网回归测试。

## 14. 当前限制与下一步

- 当前按“首次上架以来累计成功安装事件”定义累计安装总数；不代表当前仍安装的去重用户数。
- Chrome、Edge 数值需维护者提供开发者后台完整历史报表，本轮没有访问后台或核验实际累计值。
- Firefox 当前可验证 API 不提供累计安装事件数，因此目前无法给出可信的三端合计。不得使用 Firefox 用户数或下载量补位；需要 Mozilla 官方提供同口径报表后才能开放三端总计。
- 首期实现前，需用 Chrome/Edge 导出 CSV 验证“首次上架日至今”是否能完整导出且日期无缺口。

## 15. 参考资料

- [Chrome Web Store metrics](https://developer.chrome.com/docs/webstore/metrics)
- [Microsoft Edge extensions analytics](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/extensions-analytics)
- [Mozilla Add-ons API](https://mozilla.github.io/addons-server/topics/api/addons)
- [Chrome Web Store analytics dashboard overview](https://developer.chrome.com/blog/cws-analytics-revamp)
- [Chrome Web Store listing example](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg)
- [Microsoft Edge Add-ons listing example](https://microsoftedge.microsoft.com/addons/detail/gafbkmdjmeamppdonbdcoekfcagfpcck)
- [AMO API example by GUID](https://addons.mozilla.org/api/v5/addons/addon/github-chinese-localization%40caodan.io/)
- [Chrome-Webstore-Stats-API（参考项目）](https://github.com/navi1995/Chrome-Webstore-Stats-API)
