<div align="center"><a name="readme-top"></a>

# GitHub 中文汉化翻译插件

> 将 GitHub 页面中的菜单、按钮、标题、提示语等界面文本进行本地化为简体中文，提升中文用户的浏览与协作效率。

**简体中文** · [反馈问题][github-issues-link]

<!-- SHIELD GROUP -->

[![GitHub stars][github-stars-shield]][github-stars-link]
[![GitHub forks][github-forks-shield]][github-forks-link]
[![GitHub issues][github-issues-shield]][github-issues-link]
[![license GPL-3.0][github-license-shield]][github-license-link]

</div>

<details>
<summary><kbd>目录树</kbd></summary>

#### TOC
- [🌟 功能特性](#-功能特性)
- [🔒 隐私与数据](#-隐私与数据)
- [💻 安装指南](#-安装指南)
- [🔧 本地调试](#-本地调试)
- [🔄 更新日志](#-更新日志)
- [📖 开源说明](#-开源说明)
</details>

<div align="center">

### [👉 前往 Chrome 应用商店安装 👈](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb)

### [👉 前往 Edge 加载项商店安装 👈](https://microsoftedge.microsoft.com/addons/detail/gafbkmdjmeamppdonbdcoekfcagfpcck)

### [👉 前往 Firefox 附加组件商店安装 👈](https://addons.mozilla.org/zh-CN/firefox/addon/github-%E4%B8%AD%E6%96%87%E6%B1%89%E5%8C%96%E6%8F%92%E4%BB%B6/)

</div>

## 🌟 功能特性

- 覆盖 `github.com`、`gist.github.com`、`skills.github.com`、`education.github.com`、`www.githubstatus.com`
- 使用内置词库与规则在本地执行界面翻译，无需依赖在线翻译服务
- 支持仓库 README 英文内容翻译（可选）：可配置 DeepL、Google Cloud Translation、Azure Translator、Qwen-MT 或 OpenAI 兼容接口
- 支持 Issue / Pull Request / Release 正文翻译（可选）：复用同一套翻译接口配置，可手动翻译单条正文或评论，并在原文、译文、双语视图间切换
- 弹窗提供总开关；切换后若当前标签页为 GitHub 页面，将自动刷新并立即生效
- 支持翻译记录、缓存复用与分段渐进翻译（可在设置中按需开启）；记录会标注来源为 README、Issue、Pull Request 或 Release
- 提供 Chrome、Edge、Firefox 三套浏览器扩展目录，便于按浏览器加载

## 🔒 隐私与数据

- 默认仅进行本地界面翻译
- 仅本地保存插件配置（如开关状态、API 配置、缓存与记录）
- 不收集、不出售用户个人数据
- 当你主动开启 README、Issue、Pull Request 或 Release 正文翻译时，仅会将待翻译内容发送到你所配置的翻译接口

## 💻 安装指南

### Chrome 应用商店安装（推荐）

[**前往 Chrome 应用商店安装**](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb)

1. 点击上方链接进入 Chrome 应用商店
1. 点击 `添加至 Chrome`，并确认安装
1. 安装后可在 `chrome://extensions/` 中确认扩展已启用（建议固定到工具栏）
1. 打开任意 GitHub 页面即可自动中文化；如未立即生效，请刷新页面或重启浏览器

### Edge 加载项商店安装

[**前往 Edge 加载项商店安装**](https://microsoftedge.microsoft.com/addons/detail/gafbkmdjmeamppdonbdcoekfcagfpcck)

1. 点击上方链接进入 Edge 加载项商店
1. 点击 `获取`，并确认安装
1. 安装后可在 `edge://extensions/` 中确认扩展已启用（建议固定到工具栏）
1. 打开任意 GitHub 页面即可自动中文化；如未立即生效，请刷新页面或重启浏览器

### Firefox 附加组件商店安装

[**前往 Firefox 附加组件商店安装**](https://addons.mozilla.org/zh-CN/firefox/addon/github-%E4%B8%AD%E6%96%87%E6%B1%89%E5%8C%96%E6%8F%92%E4%BB%B6/)

1. 点击上方链接进入 Firefox 附加组件商店
1. 点击 `添加到 Firefox`，并确认安装
1. 安装后可在 `about:addons` 中确认扩展已启用（建议固定到工具栏）
1. 打开任意 GitHub 页面即可自动中文化；如未立即生效，请刷新页面或重启浏览器

### 开发者模式加载（Chrome / Edge）

1. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`
1. 开启右上角 `开发者模式`
1. 点击 `加载已解压的扩展程序`
1. Chrome 选择本仓库的 `chrome` 目录；Edge 选择本仓库的 `edge` 目录
1. 确认扩展已启用后，刷新 GitHub 页面

### 临时加载（Firefox）

1. 打开 `about:debugging#/runtime/this-firefox`
1. 点击 `临时载入附加组件`
1. 选择本仓库 `firefox/manifest.json`
1. 确认扩展已启用后，刷新 GitHub 页面

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🔧 本地调试

1. 克隆本仓库到本地
1. Chrome / Edge 在扩展管理页开启 `开发者模式`，加载 `chrome` 或 `edge` 目录
1. Firefox 在 `about:debugging#/runtime/this-firefox` 中临时载入 `firefox/manifest.json`
1. 修改对应浏览器目录下的 `locals.js` 后，在扩展管理页点击刷新按钮即可生效

发版时在更新下方「更新日志」后执行以下命令，把内容同步到官网 `index.html` 并自检：

```bash
node script/build-changelog.js
node script/test-update-entry.js
```

官网更新日志板块由 README 生成，请勿直接编辑 `index.html` 中 `<!-- CHANGELOG:START -->` 与 `<!-- CHANGELOG:END -->` 之间的内容。

## 🔄 更新日志

### v2.4.8 (2026-08-17)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.8`
1. 同步上游一个月内新增的 122 条词条，覆盖拉取请求仪表板自定义版块、组织成员权限与应用访问请求、Copilot AI 额度、议题反馈弹窗等
1. 新增组织云沙盒设置页翻译，并补上 `orgs/settings/sandboxes` 页面匹配规则
1. 新增全局免翻区域：`.highlight` 语法高亮代码块、`.notranslate` 与 `[translate="no"]` 显式标记、`contenteditable` 可编辑区
1. 修复文本域内用户正在输入的内容被翻译的问题，同时保留输入框占位符与按钮文案翻译
1. 修复时间元素翻译后残留 `on`（如「打开于 on 7月15日」），并避免赋值时抹掉同级节点
1. 新增顶栏搜索框占位文案翻译，混排在文字中的 `<kbd>` 按键不再被拆碎
1. 插件主页地址更正为官网，新增官网入口与版本更新提示
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.7 (2026-08-13)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.7`
1. 补齐 Copilot 套内/超套用量、仓库复刻与标星列表、Issues 侧栏与子议题等界面词条
1. 补充仓库页 `Star` / `Unstar` 动态文案正则翻译
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.6 (2026-07-31)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.6`
1. 支持仓库侧栏 About 描述的 AI 内容翻译，并适配新版 README DOM 选择器
1. 增强 OpenAI 兼容接口返回解析，避免 `[object Object]` 污染译文与缓存
1. 改进 README 渐进翻译的补翻重试、DOM 变更守卫，以及后台消息通道瞬时失败重试
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.3 (2026-07-22)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.3`
1. 修复 Turbo 软导航（返回 / 切页）后仓库顶栏等界面漏译，需硬刷新才完整翻译的问题
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.2 (2026-07-22)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.2`
1. 补齐仓库设置（常规、规则集、Actions、OIDC、Copilot 云端智能体）、确认访问、Projects、Agents、Issues 等页面词条
1. 校正规则集升级提示、Actions 白名单横幅、OIDC 主题声明、MCP 拆句等翻译语义
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.1 (2026-07-16)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.1`
1. 补齐 GitHub Sponsors 仪表板个人资料上线、赞助按钮、推广、嵌入与完成状态词条
1. 修复 Sponsors 操作按钮动态 `Sponsor @用户名` 无障碍标签翻译
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.4.0 (2026-07-10)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.4.0`
1. 补充 GitHub Sponsors 仪表板、账单与 Copilot 用量页面的本地化词条
1. 按页面功能语义修正成就、排序、设置开关、拉取请求和 Sponsors 操作文本
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.3.5 (2026-07-06)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.3.5`
1. 补充 GitHub Sponsors 账户页、注册页、身份确认和账单信息表单相关词条
1. 新增 `settings/credentials` 凭据设置页翻译，覆盖访问令牌、OAuth 应用、GitHub Apps 和 SSH 密钥条目
1. 补齐新版全局搜索 `aria-label`、设置导航和数量统计文本翻译
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.3.4 (2026-06-28)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.3.4`
1. 修复 GitHub 新版快速搜索弹窗展开后 `Recent`、`Repositories`、`Suggestions`、`Jump to` 等内容漏译
1. 优化左上角菜单与右上角头像菜单的 React Portal 弹窗翻译速度，减少展开后的英文闪现
1. 补充快速搜索、搜索建议与 Copilot 入口相关词条
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.3.3 (2026-06-23)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.3.3`
1. 手动同步上游 React 全局导航、搜索弹层与 Primer Portal 弹层兼容修复，减少新版 GitHub 顶栏漏译和交互异常
1. 同步上游导航标签、组织被标记提示及 `Pricing`、`Healthcare`、`Nonprofits` 等词条修正
1. 修复 Firefox 第三方 API 翻译接口授权流程，点击“测试连通性”可正常触发域名授权弹窗
1. 重新打包 Chrome、Edge、Firefox 三端发布压缩包

### v2.3.1 (2026-06-14)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.3.1`
1. 适配 GitHub 最新 React 全局导航，等待组件 hydration 完成后再翻译
1. 修复开启插件后点击右上角搜索按钮无法打开搜索弹层的问题
1. 保留新版搜索按钮中文翻译，并避免破坏 GitHub 原生交互

### v2.3.0 (2026-06-05)

1. Chrome、Edge、Firefox 三端插件版本同步至 `2.3.0`
1. README 完整说明内容翻译能力，明确翻译接口同时用于 README、Issue、Pull Request 和 Release 正文翻译
1. 设置页标题与提示文案改为“内容翻译设置 / 翻译接口”，避免误解为仅支持 README 或 AI 翻译
1. 连通性测试请求文本改为中文，三端设置脚本保持一致

### v2.2.5 (2026-06-05)

1. 新增 Edge 插件目录，可通过 `edge/` 在 Edge 开发者模式加载
1. 新增 Firefox 插件目录，适配 Firefox 扩展后台脚本与 Gecko 配置
1. 更新插件图标资源与弹窗入口文件
1. 补充后台代理请求脚本，支持扩展内可选翻译接口请求
1. 同步 Chrome manifest 版本至 `2.2.5`，并更新版本检查脚本
1. 更新设置页和 README 文案，明确翻译接口同时服务 README、Issue、Pull Request 和 Release 正文翻译

### v2.2.4 (2026-05-26)

1. 新增 Issue / Pull Request / Release 正文翻译，可手动翻译正文与单条评论
1. 支持原文、译文、双语三种视图切换
1. 复用 README 翻译的分段渐进翻译、缓存复用与翻译记录能力
1. 翻译记录新增来源标签，区分 README、Issue、Pull Request 与 Release
1. 优化翻译按钮位置与 GitHub 绿色按钮样式
1. 修复插件上下文失效时的错误提示与重试状态

### v2.2.3 (2026-05-26)

1. 同步上游词条并补回 Chrome 插件本地补充词条
1. 清理重复翻译词条，减少词库冗余
1. 优化内容翻译设置页结构与交互文案
1. 改进翻译记录、缓存与高级功能开关的设置体验

### v2.2.2 (2026-05-26)

1. README 翻译支持多厂商翻译接口
1. 新增 OpenAI 兼容接口配置，支持自定义 API 地址与模型
1. 增加 DeepL、Google、Azure、Qwen-MT 等翻译服务配置入口
1. 优化 API 权限申请与连通性配置流程

### v2.2.1 (2026-05-05)

1. 同步 Chrome 插件上游词条
1. 增加页面文本翻译缓存，减少重复匹配与替换开销
1. 更新版本号并修正弹窗版本测试

### v2.2.0 (2026-04-07)

1. 同步上游新增词条（约 25 条）
1. 修正多处翻译一致性
1. 新增 Copilot 学生帐户、模型原生搜索、新版 PR 仪表板等词条
1. 修复 tooltip 悬浮翻译缺失

### v2.1.2 (2026-04-02)

1. 翻译 copilot/agents 试用按钮与能力链接
1. 修复 agents 页面分段漏翻与 trial 混排

### v2.0.0 (2026-03-11)

1. Chrome 扩展首个正式版本发布
1. 收敛主机权限并改为 API 域名按需授权
1. 完善 README 翻译体验并固定简体中文

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 📖 开源说明

本扩展为社区项目，非 GitHub 官方产品。

词条基于 [maboloshi/github-chinese](https://github.com/maboloshi/github-chinese) 项目，该项目由 [52cik](https://github.com/52cik) 创建，[maboloshi](https://github.com/maboloshi) 等社区成员持续维护，以 GPL-3.0 许可证开源。

如果你希望继续修改或完善，欢迎通过以下方式参与：

1. 直接向本仓库提交 PR，我们会基于变更内容进行 review 与合并
1. Fork 本仓库后继续开发，并将你的修改版本以开源仓库形式发布

请在二次发布时遵循本仓库许可证（GPL-3.0），并保留来源说明，方便社区持续协作与追溯。

<div align="right">

[![][back-to-top]](#readme-top)

</div>


<!-- LINK GROUP -->

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
[github-project-link]: https://github.com/MaydayV/github-chinese "GitHub 中文汉化翻译插件"
[github-issues-link]: https://github.com/MaydayV/github-chinese/issues "议题"
[github-issues-shield]: https://img.shields.io/github/issues/MaydayV/github-chinese?style=flat-square&logo=github&label=Issue
[github-stars-link]: https://github.com/MaydayV/github-chinese/stargazers "星标"
[github-stars-shield]: https://img.shields.io/github/stars/MaydayV/github-chinese?style=flat-square&logo=github&label=Star
[github-forks-link]: https://github.com/MaydayV/github-chinese/network "复刻"
[github-forks-shield]: https://img.shields.io/github/forks/MaydayV/github-chinese?style=flat-square&logo=github&label=Fork
[github-license-link]: https://opensource.org/licenses/GPL-3.0  "许可证"
[github-license-shield]: https://img.shields.io/github/license/MaydayV/github-chinese?style=flat-square&logo=github&label=License
