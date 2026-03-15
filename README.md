# GitHub 中文化插件（Chrome 分支）

`chrome` 分支是本项目的 Chrome 扩展实现，目标是将 GitHub 站点常用界面词条与仓库 README 内容翻译为简体中文，降低英文阅读门槛并提升日常使用效率。

## 项目定位

- 面向浏览器用户：以 Chrome 插件形式运行，无需油猴脚本环境。
- 面向 GitHub 场景：覆盖仓库页、组织页、个人页等常见界面词条翻译。
- 面向 README 阅读：支持对仓库 README 动态翻译，并保留 Markdown 结构。

## 主要能力

- GitHub 页面词条中文化（基于内置词典与规则）。
- README 动态翻译（仅针对 README 内容区域）。
- README 描述区远程翻译（当前默认接入讯飞听见，可切换 DeepL）。
- DeepL 已按官方新规范改为 header-based authentication。

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

### Chrome 扩展

1. 点击扩展图标，可开启或关闭中文化功能。
2. 当前 Chrome 扩展本体不依赖在线翻译服务，刷新 GitHub 页面即可生效。

### 油猴脚本 README 描述翻译

1. 打开 `main.user.js`。
2. 默认使用 `iflyrec`；如果想切到 DeepL：
   - 将 `CONFIG.transEngine` 改为 `deepl`
   - 填入 `CONFIG.DEEPL_AUTH_KEY`
3. DeepL 现已使用请求头认证：`Authorization: DeepL-Auth-Key <your-key>`。
4. 如使用 DeepL Free，保持 `url_api` 为 `https://api-free.deepl.com/v2/translate`；Pro 版可改为 `https://api.deepl.com/v2/translate`。

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
