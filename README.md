<div align="center"><a name="readme-top"></a>

# GitHub 中文汉化插件

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

### [👉 前往 Chrome 应用商店安装 👈](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb)

## 🌟 功能特性

- 覆盖 `github.com`、`gist.github.com`、`skills.github.com`、`education.github.com`、`www.githubstatus.com`
- 使用内置词库与规则在本地执行界面翻译，无需依赖在线翻译服务
- 支持仓库 README 英文内容翻译（可选）：可配置翻译平台 API 或 OpenAI 兼容接口
- 弹窗提供总开关；切换后若当前标签页为 GitHub 页面，将自动刷新并立即生效
- 支持翻译记录、缓存复用与分段渐进翻译（可在设置中按需开启）

## 🔒 隐私与数据

- 默认仅进行本地界面翻译
- 仅本地保存插件配置（如开关状态、API 配置、缓存与记录）
- 不收集、不出售用户个人数据
- 当你主动开启 README 翻译时，仅会将待翻译内容发送到你所配置的翻译服务

## 💻 安装指南

### Chrome 应用商店安装（推荐）

[**前往 Chrome 应用商店安装**](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb)

1. 点击上方链接进入 Chrome 应用商店
1. 点击 `添加至 Chrome`，并确认安装
1. 安装后可在 `chrome://extensions/` 中确认扩展已启用（建议固定到工具栏）
1. 打开任意 GitHub 页面即可自动中文化；如未立即生效，请刷新页面或重启浏览器

### 开发者模式加载

1. 打开 `chrome://extensions/`
1. 开启右上角 `开发者模式`
1. 点击 `加载已解压的扩展程序`，选择本仓库的 `chrome` 目录（包含 `manifest.json`）
1. 确认扩展已启用后，刷新 GitHub 页面

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🔧 本地调试

1. 克隆本仓库到本地
1. 打开 `chrome://extensions/`，开启 `开发者模式`
1. 点击 `加载已解压的扩展程序`，选择 `chrome` 目录
1. 修改 `chrome/locals.js` 中的词条后，在扩展管理页点击刷新按钮即可生效

## 🔄 更新日志

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
[github-project-link]: https://github.com/MaydayV/github-chinese "GitHub 中文汉化插件"
[github-issues-link]: https://github.com/MaydayV/github-chinese/issues "议题"
[github-issues-shield]: https://img.shields.io/github/issues/MaydayV/github-chinese?style=flat-square&logo=github&label=Issue
[github-stars-link]: https://github.com/MaydayV/github-chinese/stargazers "星标"
[github-stars-shield]: https://img.shields.io/github/stars/MaydayV/github-chinese?style=flat-square&logo=github&label=Star
[github-forks-link]: https://github.com/MaydayV/github-chinese/network "复刻"
[github-forks-shield]: https://img.shields.io/github/forks/MaydayV/github-chinese?style=flat-square&logo=github&label=Fork
[github-license-link]: https://opensource.org/licenses/GPL-3.0  "许可证"
[github-license-shield]: https://img.shields.io/github/license/MaydayV/github-chinese?style=flat-square&logo=github&label=License
