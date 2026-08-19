#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BROWSERS = ['chrome', 'edge', 'firefox'];
const HOMEPAGE_URL = 'https://maydayv.github.io/github-chinese/';

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

// 官网更新日志必须与 README 同步
execFileSync('node', [path.join(ROOT, 'script', 'build-changelog.js'), '--check'], { stdio: 'pipe' });

const page = read('index.html');
const readme = read('README.md');
const latest = readme.match(/^###\s+v([\d.]+)\s*\(/m);
assert.ok(latest, 'README.md 中应存在版本条目');

assert.ok(page.includes('<section id="changelog"'), '官网应包含更新日志板块');
assert.ok(page.includes('<a href="#changelog">更新日志</a>'), '官网导航应包含更新日志入口');
assert.ok(
  page.includes(`id="v${latest[1].replace(/\./g, '-')}"`),
  `官网应包含最新版本锚点 v${latest[1]}`,
);

// 三端共享文件保持一致，避免只改了 chrome 目录
const baseBackground = read('chrome', 'background.js');
const basePopupJs = read('chrome', 'popup', 'popup.js');
const basePopupHtml = read('chrome', 'popup', 'popup.html');
const basePopupCss = read('chrome', 'popup', 'popup.css');

for (const browser of BROWSERS) {
  const manifest = JSON.parse(read(browser, 'manifest.json'));
  assert.strictEqual(
    manifest.homepage_url,
    HOMEPAGE_URL,
    `${browser} manifest 的 homepage_url 应指向官网`,
  );
  assert.ok(
    !JSON.stringify(manifest).includes('star.caodan.io'),
    `${browser} manifest 不应再引用旧站点`,
  );

  assert.strictEqual(read(browser, 'background.js'), baseBackground, `${browser} background.js 应与 chrome 版本一致`);
  assert.strictEqual(read(browser, 'popup', 'popup.js'), basePopupJs, `${browser} popup.js 应与 chrome 版本一致`);
  assert.strictEqual(read(browser, 'popup', 'popup.html'), basePopupHtml, `${browser} popup.html 应与 chrome 版本一致`);
}

// 更新提示链路：background 写入状态并打角标，popup 消费并跳官网
assert.ok(baseBackground.includes(HOMEPAGE_URL), 'background.js 应引用官网地址');
assert.ok(/onInstalled\.addListener/.test(baseBackground), 'background.js 应监听 onInstalled');
assert.ok(/reason !== 'update'/.test(baseBackground), 'background.js 应只在版本更新时提示');
assert.ok(/update_notice/.test(baseBackground), 'background.js 应写入 update_notice 状态');
assert.ok(/setBadgeText/.test(baseBackground), 'background.js 应设置角标');

assert.ok(basePopupHtml.includes('id="updateNotice"'), 'popup 应包含更新提示横幅');
assert.ok(!basePopupHtml.includes('id="openHomepage"'), 'popup 不应再有常驻官网按钮');
assert.ok(
  /\.update-notice\[hidden\]\s*\{\s*display:\s*none/.test(basePopupCss),
  'popup.css 需要 [hidden] 守卫，否则 display:flex 会盖掉 hidden 属性',
);
assert.ok(basePopupJs.includes(HOMEPAGE_URL), 'popup.js 应引用官网地址');
assert.ok(/update_notice/.test(basePopupJs), 'popup.js 应读取 update_notice 状态');
assert.ok(/storage\.local\.remove\('update_notice'\)/.test(basePopupJs), 'popup.js 应在点击后清除提示');

// 不应为此功能引入新权限
const permissions = JSON.parse(read('chrome', 'manifest.json')).permissions;
assert.deepStrictEqual(permissions, ['storage'], 'chrome manifest 权限不应变化');

console.log('PASS');
