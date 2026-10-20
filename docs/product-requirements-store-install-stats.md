# 三端商店安装量聚合接口与官网展示 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 产品 | GitHub 中文汉化翻译插件官网安装量统计 |
| 版本 | V1.0（需求草案） |
| 状态 | 待评审 |
| 目标平台 | Chrome Web Store、Microsoft Edge Add-ons、Firefox Add-ons |
| 统计口径 | 商店公开可取得的安装/用户/下载指标，不宣称实时活跃用户 |

## 2. 背景与问题

官网目前只有商店安装入口，没有统一展示 Chrome、Edge、Firefox 三端的安装规模。三个商店的公开数据口径和接口能力不同：

- Chrome 的安装、卸载和用户统计主要位于开发者后台；官方 Web Store API 主要用于扩展发布管理。
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

### 3.2 不在本期范围

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

首期推荐使用 GitHub Actions 定时运行并提交静态 `stats.json`，原因是当前官网部署在 GitHub Pages，不需要新增常驻服务。若后续要求更短刷新周期或隐藏采集逻辑，再迁移到 Cloudflare Worker/API。

### 6.2 适配器接口

每个平台实现统一接口：

```ts
type StoreStats = {
  store: 'chrome' | 'edge' | 'firefox';
  metricType: 'install_count' | 'average_daily_users' | 'weekly_downloads' | 'weekly_users' | 'unavailable';
  value: number | null;
  unit: 'users' | 'installs' | 'downloads';
  fetchedAt: string;
  sourceUrl: string;
  status: 'ok' | 'stale' | 'unavailable';
  error?: string;
};
```

采集器只负责取得原始数据和来源；规范化、缓存、总计和展示逻辑由公共层处理。

### 6.3 Chrome 适配器

- 输入：Chrome 扩展 ID `emoeojemgbjcogiodobkpeohoailphgg`。
- 优先来源：官方开发者后台导出的安装数据或可公开访问的商店页面。
- 可参考旧项目的页面提取结构，但不得依赖单一正则；需要多选择器、页面版本检测和字段完整性校验。
- 若页面结构变化或返回限流，保留上一次成功值并标记 `stale`。

### 6.4 Edge 适配器

- 输入：Edge 产品 ID `gafbkmdjmeamppdonbdcoekfcagfpcck`。
- 优先来源：Partner Center 导出的安装数据。
- 备用来源：公开商店页面抓取，但必须标记为非官方页面解析，并设置较长缓存和失败告警。
- 不使用开发者后台 Cookie 写入仓库或前端；如未来接入凭据，必须通过受保护的 CI Secret 或服务端 Secret 管理。

### 6.5 Firefox 适配器

- 输入：AMO slug `github-%E4%B8%AD%E6%96%87%E6%B1%89%E5%8C%96%E6%8F%92%E4%BB%B6` 或稳定 GUID `github-chinese-localization@caodan.io`。
- 优先来源：`https://addons.mozilla.org/api/v5/addons/addon/{slug}/`。
- 保存 `average_daily_users`、`weekly_downloads`、`current_version` 和 `last_updated` 等字段。
- 官网显示时明确标注“平均每日用户”或“近 7 日下载”，不得标注为累计安装量。

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
      "metricType": "install_count",
      "value": 1234,
      "unit": "installs",
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

响应必须包含 `schemaVersion`、`generatedAt`、各平台 `metricType`、`value`、`status`、`fetchedAt` 和 `sourceUrl`。接口应支持 `Cache-Control`，默认缓存 10～60 分钟，避免官网访问放大商店请求。

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

## 11. 测试要求

### 11.1 单元测试

- 每个平台至少准备 3 份真实页面/API fixture：正常、字段变化、空数据。
- 验证数字格式化、指标名称、时间转换和过期判断。
- 验证异常响应、超时、限流、HTML 结构变化不会写入错误的 0。

### 11.2 集成测试

- 定时任务可独立重跑单个平台。
- 三个平台部分失败时仍生成完整 JSON，并正确标记状态。
- 官网可以读取旧数据、处理新字段和处理缺失平台。
- `stats.json` schema 校验失败时阻止提交。

### 11.3 验收标准

- 连续 7 天定时运行成功率不低于 95%。
- 正常数据从采集完成到官网可见不超过一个同步周期。
- 任意一个平台不可用时，其他平台仍能正常展示。
- 页面明确展示统计口径和最近更新时间。
- 前端代码和公开仓库中不存在商店后台凭据。

## 12. 实施阶段

### Phase 1：数据模型与 Firefox

1. 创建 `stats.json` schema、状态模型和官网展示组件。
2. 接入 Firefox AMO 官方 API。
3. 完成本地 fixture、schema 校验和过期展示。

### Phase 2：Chrome

1. 参考旧项目实现 Chrome 页面解析器。
2. 增加多选择器、页面版本检测和失败保留机制。
3. 与商店页面实际数据进行人工对照。

### Phase 3：Edge

1. 确认公开页面可取得的字段和长期稳定性。
2. 优先落地 Partner Center CSV 导入；再评估公开页面抓取。
3. 在官网明确 Edge 数据来源和口径。

### Phase 4：定时发布与监控

1. 建立 GitHub Actions 定时任务和手动 dispatch。
2. 生成并提交 `assets/data/store-stats.json`。
3. 增加失败告警、数据新鲜度检查和官网回归测试。

## 13. 待确认事项

1. 官网是否允许展示“各平台指标”，还是必须只显示同口径合计？
2. Chrome、Edge 是否接受维护者定期导出 CSV 作为首期数据源？
3. 默认同步周期采用 12 小时还是 24 小时？
4. 是否允许使用 Cloudflare Worker 承载公开页面抓取和缓存？
5. 官网卡片显示“安装量统计”还是“商店用户数据”？

## 14. 参考资料

- [Chrome Web Store metrics](https://developer.chrome.com/docs/webstore/metrics)
- [Microsoft Edge extensions analytics](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/extensions-analytics)
- [Mozilla Add-ons API](https://mozilla.github.io/addons-server/topics/api/addons)
- [Chrome-Webstore-Stats-API（参考项目）](https://github.com/navi1995/Chrome-Webstore-Stats-API)
