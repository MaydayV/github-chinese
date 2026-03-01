# GitHub 中文化插件（Chrome 扩展版）

此目录为独立的 Chrome Manifest V3 扩展实现，用于将 GitHub 相关站点界面翻译为简体中文。

## 功能说明

- 页面界面中文化：菜单、按钮、标题、提示文案等
- 总开关控制：弹窗内一键启用/关闭
- 即时生效：切换开关后，当前 GitHub 页面自动刷新
- 本地处理：使用内置词库与规则进行替换，不依赖在线翻译服务

## 支持站点

- `https://github.com/*`
- `https://gist.github.com/*`
- `https://skills.github.com/*`
- `https://education.github.com/*`
- `https://www.githubstatus.com/*`

## 本地加载

1. 打开 Chrome：`chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录（包含 `manifest.json` 的 `chrome/` 目录）
5. 打开 GitHub 页面并刷新
