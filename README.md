# GitHub 中文化插件（Chrome 分支）

`chrome` 分支是本项目的 Chrome 扩展实现，目标是将 GitHub 站点常用界面词条与仓库 README 内容翻译为简体中文，降低英文阅读门槛并提升日常使用效率。

## 项目定位

- 面向浏览器用户：以 Chrome 插件形式运行，无需油猴脚本环境。
- 面向 GitHub 场景：覆盖仓库页、组织页、个人页等常见界面词条翻译。
- 面向 README 阅读：支持对仓库 README 动态翻译，并保留 Markdown 结构。

## 主要能力

- GitHub 页面词条中文化（基于内置词典与规则）。
- README 动态翻译（仅针对 README 内容区域）。
- 支持多类翻译服务：
  - DeepL
  - Google Cloud Translation
  - Microsoft Translator (Azure)
  - OpenAI 兼容接口（如 DeepSeek、Kimi 等兼容平台）
- 接口连通性测试（在设置页直接测试）。
- 高级能力（可开关）：
  - 翻译消耗记录（含 tokens）
  - 仓库级翻译缓存（README 未变化时复用结果）
  - 分段渐进翻译（长文档分批显示）

## 安装方式（Chrome 应用商店，推荐）

1. 安装地址（原链接）：https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb
2. 点击安装页（超链接）：[https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb](https://chromewebstore.google.com/detail/emoeojemgbjcogiodobkpeohoailphgg?utm_source=item-share-cb)
3. 在 Chrome 商店页面点击“添加至 Chrome”，并确认安装。
4. 打开 `chrome://extensions/`，确认扩展已启用。
5. 打开任意 GitHub 页面即可生效；如未立即生效，请刷新页面或重启浏览器。

## 安装方式（开发者模式）

1. 拉取本仓库并切换到 `chrome` 分支。
2. 打开 Chrome：`chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库下的 `chrome/` 目录。

## 使用说明

1. 点击扩展图标，进入“README 翻译设置”。
2. 在“API 设置”中填写接口地址、Key（及模型名）并保存。
3. 点击“测试连通性”确认配置可用。
4. 在“功能开关”中启用 README 翻译，并按需启用高级能力。
5. 在“翻译记录”中查看状态、tokens 与缓存命中情况。

## 分支说明

- `chrome`：Chrome 插件实现（当前默认分支）。
- 其他分支：用于历史产物或其他发布渠道，不作为当前 Chrome 插件主线。

## 目录说明

- `chrome/`：插件主体代码（manifest、content script、options、popup 等）。
- `script/`：辅助脚本与简单测试脚本。

## 开源说明

词条仓库原作者已将相关内容开源发布，因此本插件也继续采用开源方式维护。

如果你希望继续修改和完善，欢迎通过以下方式参与：

1. 向本仓库提交 PR，我们会基于变更内容进行 review 与合并。
2. Fork 本仓库后继续开发，并将你的修改版本以开源仓库形式发布。

二次发布时请遵循本仓库许可证（GPL-3.0），并保留来源说明，方便社区持续协作与追溯。

## 致谢

- 词条原仓库（感谢）：https://github.com/maboloshi/github-chinese
