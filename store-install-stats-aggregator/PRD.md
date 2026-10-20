# 三端商店安装量聚合接口与官网展示 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 产品 | 三端商店安装量聚合开源项目 |
| 版本 | V1.0（需求草案） |
| 状态 | 待评审 |
| 目标平台 | Chrome Web Store、Microsoft Edge Add-ons、Firefox Add-ons |
| 部署原则 | 开源、可配置、无自建服务器优先 |
| 统计口径 | 商店公开可取得的安装/用户/下载指标，不宣称实时活跃用户 |

## 2. 背景与问题

官网目前只有商店安装入口，没有统一展示 Chrome、Edge、Firefox 三端的安装规模。三个商店的公开数据口径和接口能力不同：

- Chrome 的精确安装/卸载分析位于开发者后台；商店详情页会公开展示一个用户数，但它不是安装事件数，页面采集也没有稳定 API 保证。
- Edge 的安装量和周用户数主要位于 Partner Center Analytics，未提供稳定的公开统计接口。
- Firefox AMO 提供公开 API，可读取 `average_daily_users` 和 `weekly_downloads`，但这不是累计安装总数。

旧项目 [Chrome-Webstore-Stats-API](https://github.com/navi1995/Chrome-Webstore-Stats-API) 已验证了“服务端抓取 Chrome 商店页面并返回 JSON”的基本思路，但项目较旧，仅支持 Chrome，且依赖页面正则解析，不能直接作为三端生产方案。

## 3. 产品目标

### 3.1 必须实现

1. 统一采集三个商店的可用安装相关指标。
2. 官网展示分平台数据、总计数据、来源和更新时间。
3. 单个平台接口失败时不影响其他平台展示。
4. 数据过期或不可用时明确显示状态，不展示误导性的 `0`。
5. 官网前端不保存商店账号、Cookie、API 密钥或其他敏感凭据。
6. 支持后续增加 Opera、Firefox Developer Edition 等平台适配器。

### 3.2 开源与可配置要求

1. 所有商店 ID、采集开关、同步周期、输出路径和过期策略都通过配置文件管理，不写死在采集器中。
2. 默认运行不需要自建服务器；GitHub Actions 负责定时采集并生成静态 JSON。
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
| `install_count` | 商店公开显示或后台导出的安装数量 | 仅与同口径数据相加 |
| `store_listing_users` | 商店详情页公开展示的用户数 | 不能默认等同累计安装量；只有口径明确相同时才比较或合计 |
| `average_daily_users` | Firefox AMO 平均每日用户数 | 不与累计安装量相加 |
| `weekly_downloads` | 最近 7 天下载量 | 不与累计安装量相加 |
| `weekly_users` | 最近 7 天用户数 | 不与累计安装量相加 |
| `unavailable` | 当前无法取得数据 | 不参与计算 |

官网默认展示“各平台统计值”，只有所有参与平台的 `metricType` 相同且数据新鲜时，才展示“同口径合计”。否则显示“平台数据不可直接相加”。

### 4.2 “实时”定义

产品文案使用“最近更新时间”或“最近同步”，不使用“实时安装量”。默认同步周期为 12 小时，允许后续调整为 6～24 小时。

## 5. 用户与使用场景

### 5.1 官网访客

希望快速了解插件在不同浏览器商店的安装规模，并能判断数据是否为最新。

### 5.2 项目维护者

希望新增或替换商店来源时不修改官网展示逻辑，只需增加一个采集适配器。

### 5.3 运维人员

希望看到采集失败原因、最后成功数据和过期状态，能够重跑单个平台而不影响其他数据。

## 6. 推荐技术方案

### 6.1 总体架构

```text
定时任务（GitHub Actions / Cloudflare Worker）
        |
        +-- Chrome collector
        +-- Edge collector
        +-- Firefox AMO collector
        |
        +-- 规范化、校验、缓存、失败降级
        |
        +-- stats.json 或 /api/v1/store-stats
                         |
                      官网读取
```

首期推荐使用 GitHub Actions 定时运行并提交静态 `stats.json`，原因是当前官网部署在 GitHub Pages，不需要新增常驻服务。自动采集只接入字段语义明确的来源：Firefox AMO API，以及经页面验证后可读取的 Chrome 商店展示用户数。Edge 暂用维护者从 Partner Center 导出的汇总 CSV/手工值；拿不到该数据时输出 `unavailable`，不从语义不明的页面字段推算。Cloudflare Worker 仅在确实需要公开动态 API 时再评估，不承担绕过后台登录或代理抓取。

### 6.2 配置与运行模式

项目提供 `config.example.json`，实际配置通过仓库文件或环境变量覆盖：

```json
{
  "stores": {
    "chrome": {
      "enabled": true,
      "extensionId": "emoeojemgbjcogiodobkpeohoailphgg",
      "source": "store_listing"
    },
    "edge": {
      "enabled": true,
      "productId": "gafbkmdjmeamppdonbdcoekfcagfpcck",
      "source": "manual_export"
    },
    "firefox": {
      "enabled": true,
      "guid": "github-chinese-localization@caodan.io",
      "source": "amo_api"
    }
  },
  "output": {
    "jsonPath": "assets/data/store-stats.json",
    "staleAfterHours": 48
  }
}
```

支持三种运行模式。`schedule` 属于 GitHub Actions workflow 配置，不放在采集器运行时配置中；运行时配置只包含来源、开关、超时、重试、输出和过期策略。

| 模式 | 用途 | 是否需要服务器 |
| --- | --- | --- |
| GitHub Actions | 定时采集 Firefox 与通过稳定性门槛的 Chrome 来源；校验后提交静态 `stats.json`、触发官网部署 | 否 |
| Cloudflare Worker | 提供 `/api/v1/store-stats`、边缘缓存和按需刷新 | 否，使用 CF 托管 |
| 本地 Node.js | 开发调试、单个平台重跑、fixture 测试、验证/导入 Edge 汇总值 | 否 |

GitHub Actions 是默认模式；Cloudflare Worker 只在需要公开动态接口、缩短缓存时间或不希望提交统计文件时启用。

### 6.3 适配器接口

每个平台实现统一接口：

```ts
type StoreStats = {
  store: 'chrome' | 'edge' | 'firefox';
  metricType: 'install_count' | 'store_listing_users' | 'average_daily_users' | 'weekly_downloads' | 'weekly_users' | 'unavailable';
  value: number | null;
  unit: 'users' | 'installs' | 'downloads';
  dataQuality: 'official_api' | 'store_listing' | 'manual_export' | 'none';
  fetchedAt: string;
  sourceUrl: string;
  status: 'ok' | 'stale' | 'unavailable';
  error?: string;
};
```

采集器只负责取得原始数据和来源；规范化、缓存、总计和展示逻辑由公共层处理。`metricType` 描述指标含义，`dataQuality` 描述取得途径，两者不可互相替代。公开输出不得包含后台 CSV 原文、Cookie 或其他账号数据。

### 6.4 Chrome 适配器

- 输入：Chrome 扩展 ID `emoeojemgbjcogiodobkpeohoailphgg`。
- 官方分析数据位于开发者后台；商店公开详情页显示的是用户数，不应改称累计安装数，也不等于新增安装次数。
- 本次验证中，目标扩展公开详情页返回 HTTP 200，并显示 `20,000 users`。若首期采纳此公开字段，使用 `metricType: store_listing_users`、`dataQuality: store_listing`，官网明确标注“商店展示用户数”。采集器仅提取页面可见标签及其值，保留原始标签供校验；不从压缩脚本或未文档化内部状态猜字段。
- 页面结构、标签、数值范围校验失败或限流时，失败关闭：保留上次成功值并标记 `stale`；没有历史值时标记 `unavailable`，不能写入 0。
- 该页面解析属于可选的低稳定性来源；进入定时任务前需固定公开页面 fixture、字段变化测试和人工对照记录。若页面不再稳定展示该字段，关闭自动采集，不改用后台接口绕过登录。

### 6.5 Edge 适配器

- 输入：Edge 产品 ID `gafbkmdjmeamppdonbdcoekfcagfpcck`。
- 官方来源：Partner Center 的扩展分析面板，可按时间范围查看指标并导出 CSV。首期由维护者从后台导出后，只录入官网要展示的聚合指标和统计时间，标记 `dataQuality: manual_export`；原始 CSV 留在本地，不提交仓库。
- 本次验证中，公开详情页返回 HTTP 200，但页面中的 Schema.org `userInteractionCount` 没有可验证的安装/用户定义；不得把它映射为安装量或用户数。
- 暂无可安全自动读取的官方公开统计 API。未提供有效人工导出值时发布 `unavailable`，而不是用页面元数据填数。
- 不使用开发者后台 Cookie 写入仓库或前端；未来如评估官方凭据 API，凭据只能放在受保护的 CI Secret 或服务端 Secret 中，并需另行确认官方支持与最小权限。

### 6.6 Firefox 适配器

- 输入：稳定 GUID `github-chinese-localization@caodan.io`；slug 可从 API 响应读取，不应硬编码易变化的展示 slug。
- 优先来源：`https://addons.mozilla.org/api/v5/addons/addon/{guid}/`。
- 保存 `average_daily_users`、`weekly_downloads`、`current_version` 和 `last_updated` 等字段。
- 官网显示时明确标注“平均每日用户”或“近 7 日下载”，不得标注为累计安装量。
- 本次验证中，GUID API 返回 HTTP 200，响应字段包含上述指标；页面/API 当前值仅作连通性与字段验证，不写入 PRD 样例作为长期基准。

### 6.7 首期采集范围

| 平台 | 首期数据源 | 自动化 | 对外指标 | 失败时 |
| --- | --- | --- | --- | --- |
| Chrome | 商店详情页可见用户数（需通过 fixture 稳定性门槛） | 可选定时采集 | 商店展示用户数 | 保留上次成功值并标记过期；无历史值则不可用 |
| Edge | Partner Center 汇总 CSV/人工录入 | 手动更新 | CSV 中明确命名的用户/安装指标 | 不可用；不得解析语义不明的公开元数据 |
| Firefox | AMO 官方 API | 定时采集 | 平均每日用户、近 7 日下载 | 保留上次成功值并标记过期 |

首期不承诺三端同口径总量。即使 Chrome 与 Edge 页面都出现整数，也只有指标定义、时间范围和计量方式一致时才允许求和；Firefox 的平均每日用户和近 7 日下载不得并入累计安装量。

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
      "metricType": "store_listing_users",
      "value": 20000,
      "unit": "users",
      "dataQuality": "store_listing",
      "fetchedAt": "2026-10-20T11:58:00Z",
      "sourceUrl": "https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg",
      "status": "ok"
    }
  ]
}
```

### 7.2 API 形式（后续可选）

```http
GET /api/v1/store-stats
```

响应必须包含 `schemaVersion`、`generatedAt`、各平台 `metricType`、`value`、`unit`、`dataQuality`、`status`、`fetchedAt` 和 `sourceUrl`。接口应支持 `Cache-Control`，默认缓存 10～60 分钟，避免官网访问放大商店请求。

Cloudflare Worker 版本必须支持：

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
- 数值和指标名称，例如“安装量”“平均每日用户”“近 7 日下载”。
- 最近同步时间。
- 数据状态：正常、数据过期、暂不可用。
- 各平台商店链接。
- 只有同口径时才显示合计；否则显示“各平台口径不同，暂不合计”。

加载失败时保留最后一次成功数据，并显示“数据可能已过期”；没有历史数据时显示“暂无法获取”，不能显示 `0`。

## 9. 更新与失败策略

1. 定时任务每 12 小时执行一次，并允许手动触发。
2. 单个平台失败最多重试 2 次，采用指数退避。
3. 成功后原子写入数据文件，避免官网读取半写入 JSON。
4. 连续 3 次失败创建 GitHub Actions 告警或维护者通知。
5. 数据超过 48 小时未更新，状态改为 `stale`。
6. 新采集值必须通过非负整数、合理范围、字段类型和时间格式校验。
7. 页面解析器发现结构变化时失败关闭，不写入猜测值。

## 10. 安全与合规要求

- 不在 GitHub Pages 前端暴露商店账号、Cookie、Access Token 或 Partner Center 凭据。
- 不绕过登录、验证码、访问频率限制或反爬机制。
- 遵守各商店的服务条款、robots 和合理请求频率。
- 抓取页面仅保存聚合统计，不保存用户个人信息。
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

## 11. 公开来源快速验证（2026-10-20）

使用临时 Node.js 普通脚本对 PRD 中配置的三个扩展标识发起一次 HTTPS GET；未登录开发者后台、未使用凭据，也未修改/安装浏览器插件。

| 来源 | 结果 | 方案结论 |
| --- | --- | --- |
| Chrome Web Store 详情页 | HTTP 200；可见 `20,000 users` | 可作为商店展示用户数候选；不是累计安装事件，也没有官方公开采集 API 保证页面字段稳定。 |
| Edge Add-ons 详情页 | HTTP 200；含 Schema.org `userInteractionCount=12262`，但字段语义无法从页面或官方统计文档确认 | 页面可达不代表统计可用；不采纳该字段。用 Partner Center 导出 CSV 或标记不可用。 |
| AMO API（按 GUID） | HTTP 200；包含 `average_daily_users`、`weekly_downloads`、`current_version`、`last_updated` | 可用于自动采集；前两项保持独立指标，不能冒充累计安装。 |

本次结果只证明验证时点的连通性与字段存在，不证明长期稳定、7 天运行成功率、官网部署效果或商店条款允许的采集频率。实际值随时间变化，因此没有把本次计数写成产品数据。

## 12. 测试要求

### 12.1 单元测试

- Chrome 准备正常、字段/标签变化、缺失标签的商店页面 fixture；Firefox 准备正常、空值、异常响应 JSON fixture；Edge 准备有效、列变化、无效值 CSV fixture。fixture 不包含后台凭据或完整分析报表。
- 验证数字格式化、指标名称、时间转换和过期判断。
- 验证异常响应、超时、限流、HTML 结构变化不会写入错误的 0。

### 12.2 集成测试

- 定时任务可独立重跑单个平台。
- 三个平台部分失败时仍生成完整 JSON，并正确标记状态。
- 官网可以读取旧数据、处理新字段和处理缺失平台。
- `stats.json` schema 校验失败时阻止提交。

### 12.3 验收标准

- 连续 7 天定时运行成功率不低于 95%。
- 正常数据从采集完成到官网可见不超过一个同步周期。
- 任意一个平台不可用时，其他平台仍能正常展示。
- 页面明确展示统计口径和最近更新时间。
- 前端代码和公开仓库中不存在商店后台凭据。

## 13. 实施阶段

### Phase 1：数据模型与 Firefox

1. 创建 `stats.json` schema、状态模型和官网展示组件，支持指标来源质量及 `store_listing_users`。
2. 接入 Firefox AMO 官方 API；使用 GUID 定位并准备正常、空值、错误响应 fixture。
3. 用 Chrome 页面 fixture 验证“商店展示用户数”标签的稳定性；未达到稳定门槛前默认不可用，不放入定时任务。
4. 完成本地 fixture、schema 校验和过期展示。

### Phase 2：Chrome

1. 根据公开页面可见标签实现 Chrome 解析器，不依赖旧项目的单一正则解析。
2. 增加 fixture、标签/数值完整性校验和失败保留机制。
3. 与商店页面实际显示人工对照，并确认标注为“商店展示用户数”。

### Phase 3：Edge

1. 实现本地 Partner Center 汇总 CSV/手工值导入，只输出批准公开的聚合字段与统计时间。
2. 未确认官方公开接口和字段语义前，不启用 Edge 页面抓取。
3. 在官网明确 Edge 数据来源和口径；未录入时显示不可用状态。

### Phase 4：无服务器定时发布与监控

1. 建立 GitHub Actions 定时任务和手动 dispatch，默认不依赖服务器。
2. 生成并提交 `assets/data/store-stats.json`，触发 GitHub Pages 更新。
3. 提供可选 Cloudflare Worker 部署和公开只读 API。
4. 增加失败告警、数据新鲜度检查和官网回归测试。

## 14. 待确认事项

1. 官网是否允许展示“各平台指标”，还是必须只显示同口径合计？
2. Chrome 商店展示的用户数是否满足首期展示需要，还是也必须使用后台导出数据？
3. 默认同步周期采用 12 小时还是 24 小时？
4. 是否有公开动态 API 的实际需要；如无，首期不启用 Cloudflare Worker？
5. 官网卡片显示“安装量统计”还是“商店用户数据”？

## 15. 参考资料

- [Chrome Web Store metrics](https://developer.chrome.com/docs/webstore/metrics)
- [Microsoft Edge extensions analytics](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/extensions-analytics)
- [Mozilla Add-ons API](https://mozilla.github.io/addons-server/topics/api/addons)
- [Chrome Web Store listing example](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg)
- [Microsoft Edge Add-ons listing example](https://microsoftedge.microsoft.com/addons/detail/gafbkmdjmeamppdonbdcoekfcagfpcck)
- [AMO API example by GUID](https://addons.mozilla.org/api/v5/addons/addon/github-chinese-localization%40caodan.io/)
- [Chrome-Webstore-Stats-API（参考项目）](https://github.com/navi1995/Chrome-Webstore-Stats-API)
