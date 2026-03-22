# Apple Developer 中文汉化插件（apple-dev-cn）

`apple-dev-cn` 是一个面向 Apple Developer 后台的 Chrome 扩展，使用**本地词库**将界面英文翻译为简体中文，提升中文开发者在证书、标识符、设备、描述文件、CloudKit/APNs 等页面的阅读与操作效率。

- 作用站点：`https://developer.apple.com/account/*`、`https://icloud.developer.apple.com/*`
- 翻译方式：静态词典 + 选择器规则 + 正则规则
- 数据策略：纯本地处理，不上传页面内容，不调用在线翻译服务

---

## 功能特性

- 页面文本自动翻译（标题、按钮、标签、说明文案、占位符等）
- SPA 路由切换自动重检并重新注入翻译
- 词库分层管理，降低误翻和维护成本
- 提供词条提取脚本，便于持续补全遗漏翻译

---

## 目录结构

```text
apple-dev-cn/
  manifest.json
  content.js
  popup/
    popup.html
    popup.css
    popup.js
  dicts/
    common/
      base.json
    pages/
      *.json
  tools/
    extract-terms.js
  assets/
    icons/
  marketing/
```

---

## 词库设计规范

### 1) 通用词条：`dicts/common/base.json`

放跨页面稳定词条（例如：`Create`、`Delete`、`Status`、`Learn more`）。

### 2) 页面词条：`dicts/pages/*.json`

放页面特有词条，按页面职责拆分，避免超大单文件和词义污染。

示例：

- `account-resources-certificates-list.json`
- `account-resources-identifiers-list.json`
- `account-resources-devices-list.json`
- `cloudkit-console.json`

### 3) 消歧规则：`selectorRules`

同一英文在不同区域语义不同，优先用 CSS 选择器精确翻译，避免全局误替换。

### 4) 动态文本：`regexp`

包含数字、日期、状态等变量内容时，使用正则替换。

---

## 词条文件格式（示例）

```json
{
  "scope": {
    "page": "account-resources-certificates",
    "pathPrefix": "/account/resources/certificates"
  },
  "static": {
    "Create": "创建"
  },
  "selectorRules": [
    {
      "selector": "button[aria-label='Create a certificate']",
      "source": "Create",
      "target": "创建证书"
    }
  ],
  "regexp": [
    {
      "pattern": "^(\\d+) Certificates$",
      "replacement": "$1 个证书"
    }
  ]
}
```

---

## 本地开发与加载

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择目录：`apple-dev-cn/`
5. 打开 Apple Developer 页面进行验证

---

## 如何补充遗漏翻译词条（推荐流程）

当你发现页面“部分中文 + 部分英文”时，按以下流程补齐：

### 步骤 1：确认脚本已注入

在目标页面 DevTools Console 执行：

```js
typeof chrome !== 'undefined' && !!document.querySelector('script[src*="content"]')
```

如果返回 `false`，先确认：

- 当前 URL 是否在扩展匹配范围
- 扩展是否已启用并重新加载
- 页面是否是新的子域/路径（需补 manifest host 权限或路由映射）

### 步骤 2：提取页面未翻译词条

先执行一次提取脚本：

```js
// 将 tools/extract-terms.js 内容粘贴到 Console 执行
```

再执行：

```js
copy(JSON.stringify(window.__APPLE_DEV_CN_EXTRACT_TERMS__(), null, 2))
```

该结果适合提取：标题、按钮、菜单、标签、短句。

### 步骤 3：提取长说明文案（小字段落）

```js
copy(JSON.stringify(window.__APPLE_DEV_CN_EXTRACT_TERMS_FULL__(), null, 2))
```

重点关注：

- `longText`：段落说明、提示文案
- `placeholders`：输入框 placeholder

### 步骤 4：词条归档

- 通用词条放 `dicts/common/base.json`
- 页面专有词条放对应 `dicts/pages/*.json`
- 歧义词放 `selectorRules`
- 动态模板句放 `regexp`

### 步骤 5：回归验证

- 重新加载扩展
- 刷新目标页面或执行 SPA 路由切换
- 验证是否存在误翻（尤其是 `Create`、`Enable`、`Type`、`Usage` 等高频词）

---

## 开发调试建议

- 每次新增词条后，先在对应页面做最小回归
- 优先保证“按钮、表单标签、告警提示、操作入口”翻译准确
- 品牌名/产品名（如 `CloudKit`、`WeatherKit`、`MapKit JS`）通常保留英文
- 对时间、ID、邮箱、团队名等动态用户数据避免翻译

---

## 隐私与安全

本插件仅在匹配页面内进行本地文本替换：

- 不收集账号信息
- 不上传页面内容
- 不接入第三方翻译 API

如后续增加权限（如 `tabs`、新增 host 权限），请同步更新说明并最小化权限范围。

---

## 提交规范（建议）

- 一个页面一组词条变更，便于审阅
- 提交信息明确写出影响页面
- PR 中附“变更前后截图 + 未翻译词条来源”

示例：

- `feat(dicts): 补充 cloudkit-console logs/usage 页面词条`
- `fix(content): 修复 SPA 路由切换后词典未重载问题`

