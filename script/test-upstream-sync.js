#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const BROWSERS = ['chrome', 'edge', 'firefox'];

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const context = {};
vm.createContext(context);
vm.runInContext(read('chrome', 'locals.js'), context);
const { I18N } = context;
const conf = I18N.conf;

// —— 全局免翻区域（上游 #757 / #774）——
const REQUIRED_SKIPS = [
  '.highlight',
  '.notranslate',
  '[translate="no"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
];

for (const key of ['ignoreMutationSelectorPage', 'ignoreSelectorPage']) {
  const list = conf[key]['*'];
  for (const selector of REQUIRED_SKIPS) {
    assert.ok(list.includes(selector), `${key}['*'] 应包含 ${selector}`);
  }
  // input / textarea 一旦进忽略名单，TreeWalker 的 FILTER_REJECT 会连元素本身一起跳过，
  // handleElement 里的 placeholder / value 属性翻译就再也走不到了
  assert.ok(!list.includes('input'), `${key}['*'] 不应包含 input，否则占位符翻译失效`);
  assert.ok(!list.includes('textarea'), `${key}['*'] 不应包含 textarea，改由 TreeWalker 只拦文本节点`);
}

// —— 组织云沙盒设置页 ——
const sandboxes = I18N['zh-CN']['orgs/settings/sandboxes'];
assert.ok(sandboxes, '应存在 orgs/settings/sandboxes 页面块');
assert.strictEqual(sandboxes.static['Cloud sandbox access'], '云沙盒访问');
assert.strictEqual(sandboxes.title.static['Sandboxes'], '沙盒');
assert.ok(
  conf.rePagePathOrg.test('/orgs/acme/settings/sandboxes'),
  'rePagePathOrg 应匹配组织云沙盒设置页',
);
assert.ok(
  conf.rePagePathOrg.test('/orgs/acme/settings/copilot'),
  'rePagePathOrg 原有匹配不应被破坏',
);

// —— 上游同步过来的代表性词条 ——
const SAMPLES = [
  ['pulls', 'Customize sections', '自定义版块'],
  ['orgs/settings/member_privileges', 'Branch renames', '分支重命名'],
  ['orgs/people', 'Membership via:', '成员资格来源：'],
  ['orgs/settings/apps', 'organization role assignments', '组织角色分配'],
];
for (const [page, key, expected] of SAMPLES) {
  assert.strictEqual(I18N['zh-CN'][page]?.static?.[key], expected, `${page} 缺少词条 ${key}`);
}

// —— content.js 的三处修复 ——
const content = read('chrome', 'content.js');

assert.ok(
  /isUserInputText\s*=\s*node\s*=>\s*node\.parentElement\?\.tagName === 'TEXTAREA'/.test(content),
  'content.js 应拦截 textarea 内的文本节点',
);
assert.ok(
  content.includes('if (!isUserInputText(rootNode)) handleTextNode(rootNode);'),
  'characterData 变更路径也应跳过用户输入',
);
assert.ok(
  content.includes("replace(/^(\\s*)on\\b\\s*/, '$1')"),
  'transTimeElement 应容忍 on 前的空白，避免残留',
);
assert.ok(
  content.includes('function translateReactGlobalNavSearchPlaceholder()'),
  'content.js 应包含顶栏搜索占位符翻译',
);
assert.ok(
  content.includes('translateReactGlobalNavSearchPlaceholder();'),
  '顶栏搜索占位符翻译应被调用',
);

// —— 三端共享文件保持一致 ——
for (const file of ['locals.js', 'content.js']) {
  const base = read('chrome', file);
  for (const browser of BROWSERS.slice(1)) {
    assert.strictEqual(read(browser, file), base, `${browser}/${file} 应与 chrome 版本一致`);
  }
}

console.log('PASS');
