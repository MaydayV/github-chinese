'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const context = { URL };
vm.runInNewContext(read('chrome/src/core/maintenance-tools.js'), context);
const T = context.GhcnMaintenance;
const location = { hostname: 'github.com', pathname: '/owner/repo/issues' };
const data = T.validateData({ entries: [
  { source: 'Custom label', target: '通用译文', scope: '*' },
  { source: 'Custom label', target: '页面译文', scope: 'github.com/owner/repo/*' },
], excluded: ['github.com/owner/repo/*', 'github.com/owner/repo/*'] });
assert.equal(data.excluded.length, 1);
assert.equal(T.lookup(data.entries, 'Custom label', location), '页面译文');
assert.equal(T.lookup(data.entries, 'Custom label', { ...location, pathname: '/other/repo' }), '通用译文');
assert.equal(T.lookup(data.entries, 'custom label', location), undefined);
assert.equal(T.matches('github.com/owner/repo', location), false);
assert.equal(T.matches('github.com/owner/repo/*', location), true);
for (const invalid of ['evil.example/*', 'https://github.com/*', 'github.com/*/settings', 'github.com/x?key=secret', 'github.com/white space']) assert.throws(() => T.scope(invalid));
assert.throws(() => T.validateData({ entries: [{ source: '', target: '译文' }] }));
assert.throws(() => T.validateData({ entries: [data.entries[0], data.entries[0]] }));
assert.throws(() => T.validateData({ excluded: Array(101).fill('*') }));
assert.throws(() => T.validateData({ entries: [{ source: 'line\nbreak', target: '译文' }] }));
assert.equal(T.normalize('  Hello\u00a0\n\t world  '), 'Hello world');
assert.equal(T.collectable('No projects were found'), true);
assert.equal(T.collectable('  No projects\n\t were found  '), true);
assert.equal(T.collectable('Bad\x00control text'), false);
for (const text of ['https://example.com/private', 'Email user@example.com', 'Secret sk-abcdefghijklmnopqrstuv', 'Commit aabbccddeeff0011223344', '中文说明 text content']) assert.equal(T.collectable(text), false, text);
assert.equal(T.collectable('Billing address details', '/settings/billing'), false);
const defaults = { enabled: false, api_key: '', readme_enable_token_record: false, model: '' };
const input = { enabled: true, api_key: 'test-sensitive-value', readme_enable_token_record: true, model: 'test', unknown: 'ignore' };
assert.equal(T.settings(input, defaults).api_key, undefined);
assert.equal(T.settings(input, defaults).readme_enable_token_record, true);
assert.equal(T.settings(input, defaults, true).api_key, 'test-sensitive-value');
assert.equal(T.settings(input, defaults, true).unknown, undefined);
assert.equal(T.settings({ service_api_url: 'https://user:pass@example.com/v1?api_key=private&api-version=3.0#secret' }, { service_api_url: '' }).service_api_url, 'https://example.com/v1?api-version=3.0');
assert.equal(T.settings({ service_api_url: 'https://user:pass@example.com/v1?api_key=private' }, { service_api_url: '' }, true).service_api_url, 'https://user:pass@example.com/v1?api_key=private');
assert.throws(() => T.settings({ service_api_url: 'javascript:alert(1)' }, { service_api_url: '' }));
assert.throws(() => T.settings({ service_api_url: 'file:///etc/passwd' }, { service_api_url: '' }, true));
assert.throws(() => T.settings({ enabled: 'true' }, defaults));
assert.throws(() => T.backup({ format: 'other', version: 1, data }, defaults));
const restored = T.backup({ format: 'ghcn-backup', version: 1, settings: input, data }, defaults);
assert.equal(restored.settings.api_key, undefined);
assert.equal(restored.data.entries.length, 2);
// User entries can form cycles; mutation replay must never alternate translations indefinitely.
{
  const runtime = { URL, console, window: { location }, FeatureSet: { enable_extension: true },
    Node: { TEXT_NODE: 3 }, pageConfig: { textCache: new Map(), staticDict: {}, regexpRules: [] } };
  vm.createContext(runtime);
  vm.runInContext(read('chrome/src/core/maintenance-tools.js') + '\n' + read('chrome/src/features/maintenance.js'), runtime);
  const source = read('chrome/src/features/ui-localization.js');
  function extract(name) {
    const start = source.indexOf(`function ${name}(`); let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name);
  }
  vm.runInContext(['transElement', 'transText', 'fetchTranslatedText', 'transPageAttributes'].map(extract).join('\n'), runtime);
  vm.runInContext('maintenanceData.entries = [{scope:"*",source:"Alpha label",target:"Beta label"},{scope:"*",source:"Beta label",target:"Alpha label"}];', runtime);
  const node = { data: 'Alpha label' };
  runtime.transElement(node, 'data'); runtime.transElement(node, 'data');
  assert.equal(node.data, 'Beta label');
  node.data = 'Alpha label'; runtime.transElement(node, 'data'); assert.equal(node.data, 'Beta label');
  const element = { value: 'Alpha label', getAttribute() { return this.value; }, setAttribute(name, value) { this.value = value; }, matches: () => true };
  runtime.applyCustomAttributes(element); runtime.applyCustomAttributes(element); assert.equal(element.value, 'Beta label');
  const nullAttrEl = { value: '  Alpha\n  label  ', getAttribute(n) { return n === 'aria-label' ? this.value : null; }, setAttribute(n, v) { if (n === 'aria-label') this.value = v; }, matches: () => true };
  runtime.applyCustomAttributes(nullAttrEl); assert.equal(nullAttrEl.value, 'Beta label');
  element.value = 'Alpha label';
  runtime.transPageAttributes(element, [['button', 'aria-label', { 'Alpha label': '内置翻译' }]]);
  assert.equal(element.value, 'Beta label', '自定义属性词条优先于内置 scoped 规则');
}
{
  const sent = [];
  let publicContent = 'true';
  const missRuntime = {
    URL, console,
    document: { querySelector: (sel) => (sel.includes('octolytics-dimension-repository_public') ? { getAttribute: () => publicContent } : null) },
    window: { location: { hostname: 'github.com', pathname: '/owner/repo' }, setTimeout(fn) { fn(); return 1; } },
    FeatureSet: { enable_extension: true, collect_ui_misses: true },
    pageConfig: { currentPageType: 'repository/issues' },
    chrome: { runtime: { lastError: null, sendMessage(msg, cb) { sent.push(msg); cb(); } } },
  };
  vm.createContext(missRuntime);
  vm.runInContext(read('chrome/src/core/maintenance-tools.js') + '\n' + read('chrome/src/features/maintenance.js'), missRuntime);
  missRuntime.recordUiMiss('  Filter\n  all\u00a0labels  ');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].rows)), [{ page: 'repository/issues', text: 'Filter all labels', count: 1 }]);
  assert.equal(typeof sent[0].capturedAt, 'number', 'UI 漏译上报应包含 capturedAt 时间戳');
  publicContent = 'false';
  missRuntime.recordUiMiss('Private repo action');
  assert.equal(sent.length, 1, '私有仓库页面不得收集 UI 漏译');
  publicContent = 'true';

  // matches() / lookup() / validateData() / collectable() 新增边界校验
  assert.equal(T.matches('github.com/Owner/Repo/*', { hostname: 'github.com', pathname: '/owner/repo' }), true, '通配符应大小写无关匹配仓库根路径');
  assert.equal(T.matches('github.com/Owner/Repo/*', { hostname: 'github.com', pathname: '/owner/repo/issues' }), true);
  assert.equal(T.matches('github.com/Owner/Repo/*', { hostname: 'github.com', pathname: '/owner/repo2' }), false, '不得误匹配前缀相似的仓库名');
  assert.equal(
    T.lookup([
      { scope: 'github.com/a/b/*', source: 'Settings', target: '通配符译文' },
      { scope: 'github.com/a/b', source: 'Settings', target: '精确译文' },
    ], 'Settings', { hostname: 'github.com', pathname: '/a/b' }),
    '精确译文',
    '精确范围优先级应高于同路径通配符',
  );
  assert.equal(
    T.validateData({ entries: [{ scope: '*', source: 'Multi   space\u00a0text', target: '多空格' }] }).entries[0].source,
    'Multi space text',
    'validateData 应规范化词条内部空白与 lookup 一致',
  );
  assert.throws(
    () => T.validateData({ entries: [{ scope: '*', source: 'Line1\nLine2', target: '多行' }] }),
    /控制字符/,
    'validateData 应在规范化前拒绝换行和控制字符',
  );
  for (const sensitivePath of ['/orgs/acme/people', '/login/oauth', '/enterprises/foo', '/settings/two-factor']) {
    assert.equal(T.collectable('Normal interface text', sensitivePath), false, `敏感路径 ${sensitivePath} 不得采集`);
  }
  for (const secretSample of [
    'Use token gho_1234567890abcdef',
    'Slack token xoxb-12345-67890',
    'Key AKIAIOSFODNN7EXAMPLE here',
    'Header Bearer super.secret.token',
    'Jwt eyJhbGciOiJIUzI1NiJ9.payload here',
  ]) {
    assert.equal(T.collectable(secretSample, '/owner/repo'), false, `疑似密钥文本不得采集: ${secretSample}`);
  }
  // *_api_url 内部空白清洗
  assert.equal(
    T.settings({ service_api_url: '  https://api.example.com/v1/\n  translate  ' }, { service_api_url: '' }, false).service_api_url,
    'https://api.example.com/v1/translate',
    '非涉密导出时应剔除 *_api_url 内部空白',
  );
  assert.equal(
    T.settings({ service_api_url: '  https://api.example.com/v1/\n  translate  ' }, { service_api_url: '' }, true).service_api_url,
    'https://api.example.com/v1/translate',
    '含密导出时也应剔除 *_api_url 内部空白',
  );
}
{
  let observerCallback;
  const scheduled = [];
  let currentRoot = { id: 'readme-1' };
  const domRuntime = {
    I18N: { conf: { OBSERVER_CONFIG: { attributeFilter: ['value'] } } },
    CONFIG: { OBSERVER_CONFIG: { attributeFilter: ['value'] } },
    pageConfig: { currentPageType: 'repository', attributeTranslations: [] },
    FeatureSet: { enable_extension: true, enable_readme_translation: false, prefer_chinese_readme: true },
    readmeRuntime: { isApplyingTranslation: false },
    window: { location: { href: 'https://github.com/owner/repo' } },
    document: { body: {} },
    refreshPageObserver: () => {},
    isReadmePage: () => true,
    getReadmeRootElement: () => currentRoot,
    chineseReadme: { state: null, bypass: new WeakSet() },
    scheduleReadmeTranslation: (reason) => scheduled.push(reason),
    MutationObserver: class { constructor(cb) { observerCallback = cb; } observe() {} disconnect() {} },
  };
  const domSource = read('chrome/src/core/dom-observer.js');
  const extractDom = (name) => {
    const start = domSource.indexOf(`function ${name}(`); let depth = 0;
    for (let i = domSource.indexOf('{', start); i < domSource.length; i++) {
      if (domSource[i] === '{') depth++;
      if (domSource[i] === '}' && --depth === 0) return domSource.slice(start, i + 1);
    }
    throw new Error(name);
  };
  vm.createContext(domRuntime);
  vm.runInContext(['getPageObserverConfig', 'watchUpdate'].map(extractDom).join('\n'), domRuntime);
  domRuntime.watchUpdate();
  observerCallback([]);
  assert.equal(scheduled.length, 1, '开启 prefer_chinese_readme 时 DOM 变化应调度中文 README 检查');
  domRuntime.chineseReadme.state = { root: currentRoot };
  observerCallback([]);
  assert.equal(scheduled.length, 1, '已挂载中文 README 时不再重复调度');
  currentRoot = null;
  observerCallback([]);
  assert.equal(scheduled.length, 2, 'README 根节点消失时应调度清理残留控制栏');

  // ?search#hash URL 口径一致与 WeakMap bypass 检查
  const scheduledQuery = [];
  const rootQuery = { id: 'readme-query' };
  const queryDomRuntime = {
    URL,
    I18N: { conf: { OBSERVER_CONFIG: { attributeFilter: ['value'] } } },
    CONFIG: { OBSERVER_CONFIG: { attributeFilter: ['value'] } },
    pageConfig: { currentPageType: 'repository', attributeTranslations: [] },
    FeatureSet: { enable_extension: true, enable_readme_translation: false, prefer_chinese_readme: true },
    readmeRuntime: { isApplyingTranslation: false },
    window: { location: { origin: 'https://github.com', pathname: '/owner/repo', search: '?tab=readme-ov-file', href: 'https://github.com/owner/repo?tab=readme-ov-file#快速开始' } },
    document: { body: {} },
    refreshPageObserver: () => {},
    isReadmePage: () => true,
    getReadmeRootElement: () => rootQuery,
    chineseReadme: { state: { root: rootQuery, pageUrl: 'https://github.com/owner/repo?tab=readme-ov-file' }, bypass: new WeakMap() },
    scheduleReadmeTranslation: (reason) => scheduledQuery.push(reason),
    MutationObserver: class { constructor(cb) { observerCallback = cb; } observe() {} disconnect() {} },
  };
  vm.createContext(queryDomRuntime);
  vm.runInContext(['getPageObserverConfig', 'watchUpdate'].map(extractDom).join('\n'), queryDomRuntime);
  queryDomRuntime.watchUpdate();
  observerCallback([]);
  assert.equal(scheduledQuery.length, 0, '带 ?search#hash 时已挂载中文 README 不应重复调度');
  queryDomRuntime.chineseReadme.state = null;
  queryDomRuntime.chineseReadme.bypass.set(rootQuery, 'https://github.com/owner/repo?tab=readme-ov-file');
  observerCallback([]);
  assert.equal(scheduledQuery.length, 0, 'WeakMap bypass 命中去 hash URL 时不应重复调度');
}
{
  const uiSource = read('chrome/src/features/ui-localization.js');
  const extractUi = (name) => {
    const start = uiSource.indexOf(`function ${name}(`); let depth = 0;
    for (let i = uiSource.indexOf('{', start); i < uiSource.length; i++) {
      if (uiSource[i] === '{') depth++;
      if (uiSource[i] === '}' && --depth === 0) return uiSource.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const itemEl = {
    nodeType: 1, tagName: 'SPAN', attributes: { 'data-content': 'Issues' }, textContent: 'Issues',
    getAttribute(n) { return this.attributes[n] ?? null; },
    setAttribute(n, v) { this.attributes[n] = v; },
    closest: () => null, matches: () => false,
  };
  const btnEl = {
    nodeType: 1, tagName: 'BUTTON', attributes: { 'aria-label': 'Issues' },
    getAttribute(n) { return this.attributes[n] ?? null; },
    setAttribute(n, v) { this.attributes[n] = v; },
    closest: () => null, matches: () => false,
  };
  const textNode = { nodeType: 3, data: 'Issues', parentElement: { closest: () => null, matches: () => false } };
  const headerEl = {
    nodeType: 1, tagName: 'HEADER', attributes: {}, textContent: '',
    getAttribute: () => null, setAttribute: () => {}, closest: () => null, matches: () => false, childNodes: [],
  };
  let now = 1e12;
  let takeRecordsCalls = 0;
  const navRuntime = {
    URL, console, Date: { now: () => (now += 1000) },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    CONFIG: { LANG: 'zh-CN' },
    FeatureSet: { enable_extension: true },
    I18N: { conf: { reactGlobalNavLabels: { Issues: '内置议题', BetaLabel: '内置Beta' } }, 'zh-CN': { public: { static: {}, regexp: [] } } },
    window: {
      location: { hostname: 'github.com', pathname: '/' },
      addEventListener: () => {},
      setTimeout: (fn) => { navRuntime.__scheduled.push(fn); return navRuntime.__scheduled.length; },
      clearTimeout: () => {},
      requestAnimationFrame: (fn) => fn(),
    },
    __scheduled: [],
    scheduleReactGlobalNavRefresh: () => {},
    isReactGlobalNavPortalNode: () => false,
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() { takeRecordsCalls += 1; return []; }
    },
    document: {
      readyState: 'complete',
      activeElement: null,
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: (sel) => (sel === 'header.GlobalNav' ? headerEl : null),
      querySelectorAll: (sel) => (sel.includes('[data-content]') ? [itemEl] : []),
      createTreeWalker: () => {
        const list = [btnEl, textNode];
        return { nextNode: () => list.shift() || null };
      },
    },
  };
  vm.createContext(navRuntime);
  vm.runInContext(read('chrome/src/core/maintenance-tools.js') + '\n' + read('chrome/src/features/maintenance.js'), navRuntime);
  vm.runInContext(extractUi('setupReactGlobalNavTranslation'), navRuntime);
  vm.runInContext(`maintenanceData.entries = [
    { scope: '*', source: 'Issues', target: 'CustomIssues' },
    { scope: '*', source: 'CustomIssues', target: 'Issues' },
  ];`, navRuntime);
  navRuntime.setupReactGlobalNavTranslation();
  navRuntime.scheduleReactGlobalNavRefresh();
  const timerFn = navRuntime.__scheduled.shift();
  timerFn();
  assert.equal(itemEl.textContent, 'CustomIssues', 'GlobalNav data-content 优先命中自定义词条');
  assert.equal(btnEl.getAttribute('aria-label'), 'CustomIssues', 'GlobalNav 属性优先命中自定义词条');
  assert.equal(textNode.data, 'CustomIssues', 'GlobalNav 文本节点优先命中自定义词条');
  assert.ok(takeRecordsCalls >= 1, 'GlobalNav 应用译文结束时应调用 takeRecords 清空自身引发的突变队列');
  // 同一 data-content 元素的 firstChild 文本节点再经 TreeWalker 访问时不应发生跨节点二次回跳
  const childText = { nodeType: 3, data: 'Issues', parentElement: null };
  const nestedSpan = {
    nodeType: 1, tagName: 'SPAN', attributes: { 'data-content': 'Issues' },
    _text: 'Issues',
    firstChild: childText,
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; childText.data = v; },
    getAttribute(n) { return this.attributes[n] ?? null; },
    setAttribute(n, v) { this.attributes[n] = v; },
    closest: () => null, matches: () => false,
  };
  childText.parentElement = nestedSpan;
  navRuntime.document.querySelectorAll = (sel) => (sel.includes('[data-content]') ? [nestedSpan] : []);
  navRuntime.document.createTreeWalker = () => {
    const list = [nestedSpan, childText];
    return { nextNode: () => list.shift() || null };
  };
  timerFn();
  assert.equal(nestedSpan.textContent, 'CustomIssues');
  assert.equal(childText.data, 'CustomIssues', 'data-content 子文本节点不得被 TreeWalker 二次回写回原文');
  timerFn();
  assert.equal(itemEl.textContent, 'CustomIssues', 'GlobalNav 环状词条重放不回跳');
  assert.equal(btnEl.getAttribute('aria-label'), 'CustomIssues', 'GlobalNav 属性环状词条重放不回跳');
  assert.equal(textNode.data, 'CustomIssues', 'GlobalNav 文本环状词条重放不回跳');
}
const { execFileSync } = require('node:child_process');
const checked = JSON.parse(execFileSync(process.execPath, ['script/locale-maintenance.js', 'check', '--strict'], { cwd: ROOT, encoding: 'utf8' }));
assert.equal(checked.warnings.length, 0, '词库冲突必须通过严格校验');
assert.ok(checked.expandedAttributeRules > 0, '应统计并校验 attributes 规则');
const sample = JSON.stringify({ format: 'ghcn-ui-misses', version: 1, rows: [
  { page: 'repository/projects', text: '  No\n  closed projects ', count: 1 },
  { page: 'repository/projects', text: 'No closed projects', count: 2 },
  { page: 'repository/projects', text: 'Loading projects', count: 1 },
  { page: 'repository/projects', text: 'A genuinely missing interface sentence', count: 2 },
  { page: 'repository/projects', text: 'Email user@example.com', count: 1 },
] });
const report = JSON.parse(execFileSync(process.execPath, ['script/locale-maintenance.js', 'coverage', '-'], { cwd: ROOT, input: sample, encoding: 'utf8' }));
assert.equal(report.sampleCount, 3); assert.equal(report.covered, 2); assert.equal(report.missing.length, 1);
const harvested = JSON.parse(execFileSync(process.execPath, ['script/locale-maintenance.js', 'harvest', '-'], { cwd: ROOT, input: sample, encoding: 'utf8' }));
assert.equal(harvested.rows.length, 3);
assert.equal(harvested.rows.find(row => row.text === 'No closed projects').count, 3, 'harvest 应累加同词条计数');

for (const browser of ['chrome', 'edge', 'firefox']) {
  assert.equal(read(`${browser}/maintenance-tools.js`), read('chrome/src/core/maintenance-tools.js'));
  assert.equal(read(`${browser}/options/maintenance.js`), read('chrome/options/maintenance.js'));
  assert.equal(read(`${browser}/options/options.html`), read('chrome/options/options.html'));
  assert.equal(read(`${browser}/options/options.css`), read('chrome/options/options.css'));
  assert.equal(read(`${browser}/popup/popup.html`), read('chrome/popup/popup.html'));
  assert.equal(read(`${browser}/popup/popup.css`), read('chrome/popup/popup.css'));
  const html = read(`${browser}/options/options.html`);
  for (const id of ['prefer_chinese_readme', 'collect_ui_misses', 'missExportHint', 'customEntryList', 'excludedPaths', 'backupSecrets', 'exportBackup', 'importBackup']) assert.ok(html.includes(`id="${id}"`), `${browser}: ${id}`);
  assert.ok(html.indexOf('</form>') < html.indexOf('data-tab-panel="maintenance"'), `${browser}: 维护面板应位于 settingsForm 外`);
  assert.match(read(`${browser}/options/options.css`), /input:not\(\[type="checkbox"\]\)/, `${browser}: 复选框不应继承全宽文本输入框样式`);
  assert.match(read(`${browser}/popup/popup.css`), /\.options-btn:disabled/, `${browser}: popup 应定义禁用按钮样式`);
  const popupHtml = read(`${browser}/popup/popup.html`);
  assert.ok(popupHtml.indexOf('maintenance-tools.js') < popupHtml.indexOf('popup.js'), `${browser}: maintenance-tools.js 应在 popup.js 之前加载`);
  const source = read(`${browser}/content.js`);
  assert.match(source, /getCurrentRepoInfo\(\)[\s\S]*url\.origin !== window\.location\.origin/);
  assert.match(source, /state\.root\.hidden = state\.hidden/);
  assert.match(source, /pageUrl !== getDocumentUrlWithoutHash\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /if \(await preferChineseReadme\(\)\) \{[\s\S]*?'readme_skipped'[\s\S]*?'native_chinese_readme'/);
  assert.match(source, /collect_ui_misses: false/);
  assert.match(source, /#qb-input-query/);
}
new vm.Script('(' + execFileSync(process.execPath, ['script/maintenance-browser-test.js'], { cwd: ROOT, encoding: 'utf8' }) + ')');

async function chineseReadmeTests() {
  function makeHtmlNode(text = '这是仓库的中文说明文档。', tagName = 'ARTICLE') {
    return {
      tagName, textContent: text, attributes: [], dataset: {}, hidden: false, children: [], className: '',
      getAttribute(n) { return this.attributes.find(a => a.name === n)?.value ?? null; },
      hasAttribute(n) { return this.attributes.some(a => a.name === n); },
      setAttribute(n, v) { const e = this.attributes.find(a => a.name === n); if (e) e.value = v; else this.attributes.push({ name: n, value: v }); },
      removeAttribute(n) { this.attributes = this.attributes.filter(a => a.name !== n); },
      querySelectorAll() { return []; },
      append(...nodes) { this.children.push(...nodes); },
      addEventListener() {},
      remove() { this.removed = true; },
    };
  }
  function makeLink(href) { return { getAttribute: (n) => (n === 'href' ? href : null) }; }
  function makeRoot({ links = [], text = 'English README content.' } = {}) {
    return {
      hidden: false, isConnected: true, beforeCalls: [], textContent: text,
      before(...nodes) { this.beforeCalls.push(...nodes); },
      closest: () => null,
      querySelectorAll: (sel) => (sel === 'a[href]' ? links : []),
      cloneNode: () => ({ textContent: text, querySelectorAll: () => [] }),
    };
  }
  let root = makeRoot();
  let guardCalls = 0;
  let docLinks = [];
  let fetchHandler = async () => ({ ok: true, url: 'https://github.com/owner/repo/blob/main/README_zh-CN.md', text: async () => '<article>这是仓库自带的中文说明内容。</article>' });
  const env = {
    URL, AbortController, console,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    FeatureSet: { enable_extension: true, prefer_chinese_readme: true, enable_readme_translation: false },
    window: { location: { origin: 'https://github.com', hostname: 'github.com', pathname: '/owner/repo', href: 'https://github.com/owner/repo' }, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    getCurrentRepoInfo: () => {
      const m = env.window.location.pathname.match(/^\/([^/]+)\/([^/]+)/);
      return m ? { fullName: `${m[1]}/${m[2]}`.toLowerCase() } : null;
    },
    isReadmePage: () => true,
    getReadmeRootElement: () => root,
    withReadmeDomMutationGuard: (fn) => { guardCalls++; return fn(); },
    scheduleReadmeTranslation: () => {},
    fetch: (url, opts) => fetchHandler(url, opts),
    DOMParser: class { parseFromString(html) { return { querySelector: () => (html.includes('<article>') ? makeHtmlNode('这是仓库自带的中文说明内容。') : null) }; } },
    document: {
      querySelectorAll: (sel) => (sel.startsWith('a[') ? docLinks : []),
      importNode: (node) => makeHtmlNode(node.textContent, node.tagName),
      createElement: (tag) => makeHtmlNode('', tag.toUpperCase()),
    },
  };
  vm.createContext(env);
  vm.runInContext(read('chrome/src/core/maintenance-tools.js') + '\n' + read('chrome/src/features/maintenance.js'), env);

  // 1. 非 README 的 blob 文件页（如 CONTRIBUTING.md）不应被侧栏中文 README 替换
  env.window.location.pathname = '/owner/repo/blob/main/CONTRIBUTING.md';
  env.window.location.href = 'https://github.com/owner/repo/blob/main/CONTRIBUTING.md';
  docLinks = [makeLink('/owner/repo/blob/main/README_zh-CN.md')];
  assert.equal(env.findChineseReadme(root), null, '非 README 的 Markdown 文件不应被替换');

  // 2. 原 README 已是中文时，不应被繁体 README 替换
  env.window.location.pathname = '/owner/repo';
  env.window.location.href = 'https://github.com/owner/repo';
  root = makeRoot({ links: [makeLink('/owner/repo/blob/main/README_zh-TW.md')], text: '这是一个完整的中文说明文档，包含项目的安装方式、使用说明和常见问题解答。' });
  docLinks = [];
  assert.equal(env.findChineseReadme(root), null, '已是中文的 README 不应被替换');

  // 3. 正在浏览 README_zh-CN.md 时，不应替换为 README_zh-TW.md
  env.window.location.pathname = '/owner/repo/blob/main/README_zh-CN.md';
  env.window.location.href = 'https://github.com/owner/repo/blob/main/README_zh-CN.md';
  root = makeRoot({ links: [makeLink('/owner/repo/blob/main/README_zh-TW.md')] });
  assert.equal(env.findChineseReadme(root), null, '中文 README blob 页不应切换成繁体版');

  // 4. 子目录 tree 页面不应使用侧栏的根目录中文 README
  env.window.location.pathname = '/owner/repo/tree/main/packages/a';
  env.window.location.href = 'https://github.com/owner/repo/tree/main/packages/a';
  root = makeRoot();
  docLinks = [makeLink('/owner/repo/blob/main/README_zh-CN.md')];
  assert.equal(env.findChineseReadme(root), null, '子目录 tree 页面不应使用根目录中文 README');

  // 5. Monorepo 根 README 中即使首个链接是 packages/a/README_zh-CN.md，也不应替换根 README
  env.window.location.pathname = '/owner/repo';
  env.window.location.href = 'https://github.com/owner/repo';
  root = makeRoot({ links: [makeLink('/owner/repo/blob/main/packages/a/README_zh-CN.md')] });
  docLinks = [];
  assert.equal(env.findChineseReadme(root), null, '子包中文 README 不应替换仓库根 README');

  // 6. 根文件列表中的 README_zh-CN.md 应优先于正文里更深层的 docs/sub/README_zh-CN.md
  root = makeRoot({ links: [makeLink('/owner/repo/blob/main/docs/sub/README_zh-CN.md')] });
  docLinks = [makeLink('/owner/repo/blob/main/README_zh-CN.md')];
  assert.equal(env.findChineseReadme(root), 'https://github.com/owner/repo/blob/main/README_zh-CN.md');

  // 7. 导航取消导致的未完成请求不得写入 5 分钟失败冷却
  let resolvePending;
  fetchHandler = () => new Promise(resolve => { resolvePending = resolve; });
  env.window.location.pathname = '/owner/repo-nav';
  env.window.location.href = 'https://github.com/owner/repo-nav';
  root = makeRoot({ links: [makeLink('/owner/repo-nav/blob/main/README_zh-CN.md')] });
  docLinks = [];
  const navPromise = env.preferChineseReadme();
  env.window.location.href = 'https://github.com/owner/other';
  resolvePending({ ok: true, url: 'https://github.com/owner/repo-nav/blob/main/README_zh-CN.md', text: async () => '<article>这是仓库自带的中文说明内容。</article>' });
  assert.equal(await navPromise, false);
  assert.equal(vm.runInContext('chineseReadme.failures.size', env), 0, '切走取消不应记录失败冷却');
  fetchHandler = async (u) => ({ ok: true, url: u, text: async () => '<article>这是仓库自带的中文说明内容。</article>' });
  env.window.location.href = 'https://github.com/owner/repo-nav';
  root = makeRoot({ links: [makeLink('/owner/repo-nav/blob/main/README_zh-CN.md')] });
  assert.equal(await env.preferChineseReadme(), true, '切回仓库应立即可用中文 README');
  env.restoreChineseReadme();

  // 8. 跨仓库快速切换应中止旧请求并加载新仓库中文 README
  let abortedSignalA;
  fetchHandler = (url, opts) => {
    if (url.includes('repo-a')) {
      abortedSignalA = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    }
    return Promise.resolve({ ok: true, url, text: async () => '<article>仓库 B 的中文说明内容。</article>' });
  };
  env.window.location.pathname = '/owner/repo-a';
  env.window.location.href = 'https://github.com/owner/repo-a';
  root = makeRoot({ links: [makeLink('/owner/repo-a/blob/main/README_zh-CN.md')] });
  const pendingA = env.preferChineseReadme();
  env.window.location.pathname = '/owner/repo-b';
  env.window.location.href = 'https://github.com/owner/repo-b';
  root = makeRoot({ links: [makeLink('/owner/repo-b/blob/main/README_zh-CN.md')] });
  const resultB = await env.preferChineseReadme();
  assert.equal(abortedSignalA.aborted, true, '切到新仓库时应中止旧仓库请求');
  assert.equal(await pendingA, false);
  assert.equal(resultB, true, '新仓库中文 README 应正常挂载');
  assert.equal(vm.runInContext("chineseReadme.failures.has('https://github.com/owner/repo-a/blob/main/README_zh-CN.md')", env), false, '被中止的旧请求不应记为失败');

  // 9. 挂载中文副本后 getReadmeRootElement 必须跳过带 data-ghcn-chinese-readme 的副本找到原节点，且受 DOM 变更守卫保护
  env.restoreChineseReadme();
  const mdSource = read('chrome/src/features/markdown-translation.js');
  const extractMd = (name) => {
    const start = mdSource.indexOf(`function ${name}(`); let depth = 0;
    for (let i = mdSource.indexOf('{', start); i < mdSource.length; i++) {
      if (mdSource[i] === '{') depth++;
      if (mdSource[i] === '}' && --depth === 0) return mdSource.slice(start, i + 1);
    }
    throw new Error(name);
  };
  vm.runInContext(`var README_CONFIG = { ROOT_SELECTORS: ['#readme article.markdown-body'] };\n${extractMd('getReadmeRootElement')}`, env);
  const mountedCopies = [];
  env.document.importNode = (node) => {
    const copy = makeHtmlNode(node.textContent, node.tagName);
    copy.closest = (sel) => (sel === '[data-ghcn-chinese-readme]' && copy.dataset.ghcnChineseReadme ? copy : null);
    copy.remove = () => {
      copy.removed = true;
      const idx = mountedCopies.indexOf(copy);
      if (idx >= 0) mountedCopies.splice(idx, 1);
    };
    return copy;
  };
  env.document.querySelectorAll = (sel) => (sel.startsWith('a[') ? docLinks : [...mountedCopies, root]);
  env.window.location.pathname = '/yetone/magpie';
  env.window.location.href = 'https://github.com/yetone/magpie';
  root = makeRoot({ links: [makeLink('/yetone/magpie/blob/main/README.zh-CN.md')] });
  const origBefore = root.before.bind(root);
  root.before = (...nodes) => {
    origBefore(...nodes);
    nodes.filter(n => n.dataset?.ghcnChineseReadme).forEach(n => mountedCopies.push(n));
  };
  docLinks = [];
  const guardsBefore = guardCalls;
  assert.equal(await env.preferChineseReadme(), true, '首次挂载中文 README 应成功');
  assert.equal(guardCalls, guardsBefore + 1, '挂载中文 README 应经过 DOM mutation 守卫');
  assert.equal(env.getReadmeRootElement(), root, 'getReadmeRootElement 必须跳过前置中文副本返回原始 README 节点');
  assert.equal(await env.preferChineseReadme(), true, '二次检查应保持已挂载状态');
  assert.equal(root.beforeCalls.length, 2, '不得卸载并重复挂载导致闪烁死循环');
  assert.equal(vm.runInContext('chineseReadme.state !== null', env), true);

  // 10. 点击目录 #hash 锚点时，不应卸载中文 README 或破坏 bypass
  env.window.location.href = 'https://github.com/yetone/magpie#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B';
  assert.equal(await env.preferChineseReadme(), true, '仅变更 #hash 时应保持已挂载中文 README');
  assert.equal(root.beforeCalls.length, 2, '仅变更 #hash 时不得重新插入副本');

  // 11. 拉取到非中文 / 无正文页时不得写入缓存
  env.restoreChineseReadme();
  const badUrl = 'https://github.com/owner/repo-bad/blob/main/README.zh-CN.md';
  env.window.location.pathname = '/owner/repo-bad';
  env.window.location.href = 'https://github.com/owner/repo-bad';
  fetchHandler = async () => ({ ok: true, url: badUrl, text: async () => '<html>English error page without CJK</html>' });
  root = makeRoot({ links: [makeLink('/owner/repo-bad/blob/main/README.zh-CN.md')] });
  assert.equal(await env.preferChineseReadme(), false);
  assert.equal(vm.runInContext(`chineseReadme.cache.has(${JSON.stringify(badUrl)})`, env), false, '无效 HTML 不得写入中文 README 缓存');

  // 12. 对已经 API 翻译的 README 挂载原生中文 README 前，必须先恢复英文原稿以便“查看原文”正常
  let restoredOriginal = false;
  env.getReadmeElementState = () => ({ originalHtml: '<p>Original English</p>', translatedHash: 'hash-zh' });
  env.restoreReadmeTranslation = () => {
    restoredOriginal = true;
    root.innerHTML = '<p>Original English</p>';
  };
  env.window.location.pathname = '/owner/repo-api-orig';
  env.window.location.href = 'https://github.com/owner/repo-api-orig';
  fetchHandler = async (u) => ({ ok: true, url: u, text: async () => '<article>已提供官方中文说明文档，包含完整介绍。</article>' });
  root = makeRoot({ links: [makeLink('/owner/repo-api-orig/blob/main/README.zh-CN.md')] });
  root.innerHTML = '<p>已翻译的中文内容</p>';
  assert.equal(await env.preferChineseReadme(), true);
  assert.equal(restoredOriginal, true, '挂载原生中文 README 前应恢复 API 改写前的英文原文');
  assert.equal(root.innerHTML, '<p>Original English</p>');

  const guardsBeforeRestore = guardCalls;
  env.restoreChineseReadme();
  assert.equal(guardCalls, guardsBeforeRestore + 1, '卸载中文 README 应经过 DOM mutation 守卫');
  assert.equal(mountedCopies.length, 0);
}

async function optionsMaintenanceTest() {
  const listeners = [];
  const makeEl = (id) => {
    const handlers = {};
    return {
      id, value: id === 'newEntryScope' ? '*' : '', checked: false, children: [], listeners: handlers,
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      setAttribute() {},
      replaceChildren(...items) { this.children = items; },
      append(...items) { this.children.push(...items); },
      click() { (handlers.click || []).forEach(fn => fn()); },
    };
  };
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) {
      const node = makeEl(id);
      if (id === 'missExportHint') node.hidden = true;
      elements.set(id, node);
    }
    return elements.get(id);
  };
  let downloads = 0;
  const store = {
    local: { [T.DATA_KEY]: { entries: [{ scope: '*', source: 'First', target: '第一' }, { scope: '*', source: 'Second', target: '第二' }], excluded: [] } },
    sync: { prefer_chinese_readme: true, collect_ui_misses: false },
  };
  const area = (name) => ({
    get: async (q) => typeof q === 'string' ? { [q]: store[name][q] } : Object.fromEntries(Object.entries(q).map(([k, v]) => [k, store[name][k] ?? v])),
    set: async (vals) => Object.assign(store[name], vals),
  });
  let domReady;
  const ctx = {
    GhcnMaintenance: T, DEFAULTS: { enable_readme_translation: false },
    confirm: () => true, location: { reload() {} },
    URL: { createObjectURL: () => { downloads++; return 'blob:test'; }, revokeObjectURL: () => {} },
    Blob, setTimeout: globalThis.setTimeout.bind(globalThis),
    chrome: {
      storage: { local: area('local'), sync: area('sync'), onChanged: { addListener: (fn) => listeners.push(fn) } },
      runtime: { sendMessage: (msg, cb) => { if (msg?.clear) store.local[T.MISS_KEY] = []; cb({ ok: true }); } },
    },
    document: {
      addEventListener: (_t, fn) => { domReady = fn; },
      getElementById: getEl,
      createElement: () => makeEl('dyn'),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(read('chrome/options/maintenance.js'), ctx);
  domReady();
  await new Promise(r => setTimeout(r, 20));
  getEl('excludedPaths').value = 'github.com/draft/repo/*';
  const firstRow = getEl('customEntryList').children[0];
  firstRow.children[2].value = '第一改';
  firstRow.children[3].click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(store.local[T.DATA_KEY].entries[0].source, 'First', '行内保存应保持原有词条顺序');
  assert.equal(store.local[T.DATA_KEY].entries[0].target, '第一改');
  assert.equal(getEl('excludedPaths').value, 'github.com/draft/repo/*', '修改词条不应覆盖未保存的排除路径草稿');
  listeners.forEach(fn => fn({ [T.DATA_KEY]: { newValue: { entries: store.local[T.DATA_KEY].entries, excluded: ['github.com/popup/repo/*'] } } }, 'local'));
  assert.equal(getEl('excludedPaths').value, 'github.com/popup/repo/*', '外部变更排除路径时应同步更新输入框');

  getEl('exportMisses').click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(downloads, 0, '无漏译记录时不应下载空文件');
  assert.equal(getEl('missExportHint').hidden, true);
  assert.match(getEl('maintenanceStatus').textContent, /暂无漏译记录/);

  store.local[T.MISS_KEY] = [{ page: 'repository/issues', text: 'Missing UI text', count: 2 }];
  getEl('exportMisses').click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(downloads, 1, '有漏译记录时应导出 JSON 文件');
  assert.equal(getEl('missExportHint').hidden, false, '导出后应显示提交 Issue 提示');
  const issueLink = getEl('missExportHint').children.at(-1);
  assert.ok(issueLink.href.startsWith('https://github.com/MaydayV/github-chinese/issues/new'), '导出提示应链接到仓库新建 Issue 页面');
  assert.equal(issueLink.target, '_blank');
  assert.equal(issueLink.rel, 'noopener noreferrer');
  assert.match(getEl('maintenanceStatus').textContent, /提交 Issue/);

  getEl('clearMisses').click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(getEl('missExportHint').hidden, true, '清空漏译后应隐藏导出提示');
  assert.equal(getEl('missExportHint').children.length, 0);

  // 即使勾选了“包含密钥”，导入更改了 *_api_url 域名但未携带 *_api_key 的无密钥备份时也必须清空旧密钥
  const backupElements = new Map();
  const makeBackupEl = (id) => {
    const handlers = {};
    return {
      id, value: '', checked: false, children: [], files: [], textContent: '',
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      dispatch(type) { return Promise.all((handlers[type] || []).map(fn => fn())); },
      setAttribute() {}, replaceChildren(...items) { this.children = items; }, append() {},
    };
  };
  const getBackupEl = (id) => (backupElements.has(id) ? backupElements.get(id) : (backupElements.set(id, makeBackupEl(id)), backupElements.get(id)));
  const backupSync = {
    readme_openai_api_url: 'https://old-provider.example/v1',
    readme_openai_api_key: 'sk-old-secret',
  };
  let backupDomReady;
  const backupCtx = {
    GhcnMaintenance: T,
    DEFAULTS: { readme_openai_api_url: 'https://api.deepseek.com', readme_openai_api_key: '' },
    confirm: () => true, location: { reload() {} },
    URL: class extends URL {
      static createObjectURL() { return 'blob:b'; }
      static revokeObjectURL() {}
    },
    Blob, setTimeout: globalThis.setTimeout.bind(globalThis),
    chrome: {
      storage: {
        local: area('local'),
        sync: {
          get: async (q) => Object.fromEntries(Object.keys(q).map((k) => [k, backupSync[k] ?? q[k]])),
          set: async (vals) => Object.assign(backupSync, vals),
        },
        onChanged: { addListener() {} },
      },
      runtime: { sendMessage: (_m, cb) => cb?.({ ok: true }) },
    },
    document: {
      addEventListener: (_t, fn) => { backupDomReady = fn; },
      getElementById: getBackupEl,
      createElement: () => makeBackupEl('dyn'),
    },
  };
  vm.createContext(backupCtx);
  vm.runInContext(read('chrome/options/maintenance.js'), backupCtx);
  backupDomReady();
  await new Promise(r => setTimeout(r, 20));
  getBackupEl('backupSecrets').checked = true;
  getBackupEl('importBackup').files = [{
    size: 120,
    text: async () => JSON.stringify({
      format: 'ghcn-backup',
      version: 1,
      settings: { readme_openai_api_url: 'https://new-provider.example/v1' },
      data: { entries: [], excluded: [] },
    }),
  }];
  await getBackupEl('importBackup').dispatch('change');
  assert.equal(backupSync.readme_openai_api_url, 'https://new-provider.example/v1');
  assert.equal(backupSync.readme_openai_api_key, '', '勾选包含密钥时导入无密钥但变更域名的备份也必须清空旧密钥');
}

async function backgroundTest() {
  let handler;
  const storage = { [T.MISS_KEY]: [{ page: 'repository/issues', text: 'Existing  label', count: 1 }] };
  const sandbox = {
    GhcnMaintenance: T, URL,
    chrome: { runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { handler = fn; } } },
      storage: { sync: { get: async () => ({ collect_ui_misses: true }) }, local: {
        get: async key => ({ [key]: storage[key] }), set: async values => Object.assign(storage, values),
      } } },
  };
  vm.runInNewContext(read('chrome/background.js'), sandbox);
  const send = message => new Promise(resolve => handler({ type: 'ghcn-ui-misses', ...message }, {}, resolve));
  const row = { page: 'repository/issues', text: 'Brand\n  new\u00a0interface label', count: 2 };
  await Promise.all([send({ rows: [row] }), send({ rows: [{ page: 'repository/issues', text: 'Brand new interface label', count: 2 }] })]);
  assert.equal(storage[T.MISS_KEY].length, 2);
  assert.equal(storage[T.MISS_KEY][0].text, 'Existing label');
  assert.equal(storage[T.MISS_KEY][1].text, 'Brand new interface label');
  assert.equal(storage[T.MISS_KEY][1].count, 4);
  await send({ rows: [{ ...row, text: 'Email user@example.com' }] });
  assert.equal(storage[T.MISS_KEY].length, 2);
  await send({ clear: true });
  assert.equal(storage[T.MISS_KEY].length, 0);
}
let allAsyncTestsCompleted = false;
process.on('beforeExit', () => {
  if (!allAsyncTestsCompleted && !process.exitCode) {
    console.error('test-maintenance.js exited before async tests completed.');
    process.exitCode = 1;
  }
});

Promise.all([chineseReadmeTests(), optionsMaintenanceTest(), backgroundTest()])
  .then(() => {
    // sanitizeChineseReadme 安全净化与 #anchor 保留测试
    const makeDomNode = (tagName, attrs = {}, children = []) => {
      const node = {
        tagName: tagName.toUpperCase(),
        attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
        children,
        dataset: {},
        removed: false,
        hasAttribute(n) { return this.attributes.some(a => a.name.toLowerCase() === n.toLowerCase()); },
        getAttribute(n) { return this.attributes.find(a => a.name.toLowerCase() === n.toLowerCase())?.value ?? null; },
        setAttribute(n, v) {
          const e = this.attributes.find(a => a.name.toLowerCase() === n.toLowerCase());
          if (e) e.value = String(v); else this.attributes.push({ name: n, value: String(v) });
        },
        removeAttribute(n) { this.attributes = this.attributes.filter(a => a.name.toLowerCase() !== n.toLowerCase()); },
        remove() { this.removed = true; },
        querySelectorAll(sel) {
          const selectors = sel.split(',').map(s => s.trim().toUpperCase());
          const out = [];
          const walk = (parent) => {
            for (const c of parent.children || []) {
              if (selectors.includes('*') || selectors.includes(c.tagName)) out.push(c);
              walk(c);
            }
          };
          walk(this);
          return out;
        },
      };
      return node;
    };
    const turbo = makeDomNode('turbo-frame', { id: 'evil-frame' });
    const tmpl = makeDomNode('template');
    const h2 = makeDomNode('h2', { id: 'user-content-install', 'data-turbo-action': 'replace', onclick: 'evil()' });
    const cjkH2 = makeDomNode('h2', { id: 'user-content-快速开始' });
    const anchor = makeDomNode('a', { href: '#install' });
    const cjkAnchorRaw = makeDomNode('a', { href: '#快速开始' });
    const cjkAnchorEncoded = makeDomNode('a', { href: '#%E5%BF%AB%E9%80%9F%E5%BC%80%E5%A7%8B' });
    const cjkAnchorPrefixed = makeDomNode('a', { href: '#user-content-快速开始' });
    const badIdH3 = makeDomNode('h3', { id: 'bad/id with space' });
    const badImg = makeDomNode('img', { src: 'javascript:alert(1)', srcset: 'javascript:alert(1) 1x' });
    const goodVideo = makeDomNode('video', { poster: 'https://github.com/owner/repo/poster.png' });
    const article = makeDomNode('article', { id: 'readme' }, [turbo, tmpl, h2, cjkH2, anchor, cjkAnchorRaw, cjkAnchorEncoded, cjkAnchorPrefixed, badIdH3, badImg, goodVideo]);
    const sanEnv = {
      URL, console,
      document: { importNode: (n) => n },
      window: { location: { href: 'https://github.com/owner/repo' } },
      FeatureSet: {}, pageConfig: {},
      GhcnMaintenance: T,
    };
    vm.createContext(sanEnv);
    vm.runInContext(read('chrome/src/core/maintenance-tools.js') + '\n' + read('chrome/src/features/maintenance.js'), sanEnv);
    const cleaned = sanEnv.sanitizeChineseReadme(article, 'https://github.com/owner/repo/blob/main/README_zh-CN.md');
    assert.equal(turbo.removed, true, '应移除 turbo-frame');
    assert.equal(tmpl.removed, true, '应移除 template');
    assert.equal(h2.hasAttribute('data-turbo-action'), false, '应移除 data-turbo-action');
    assert.equal(h2.hasAttribute('onclick'), false, '应移除 onclick');
    assert.equal(h2.getAttribute('id'), 'ghcn-cr-install', '标题 id 应加上 安全前缀');
    assert.equal(cjkH2.getAttribute('id'), 'ghcn-cr-快速开始', '中文 Unicode 标题 id 应保留并加上安全前缀');
    assert.equal(anchor.getAttribute('href'), '#ghcn-cr-install', '页内 #anchor 链接应重写为安全前缀');
    assert.equal(cjkAnchorRaw.getAttribute('href'), '#ghcn-cr-快速开始', '中文目录裸锚点应正确映射到安全前缀');
    assert.equal(cjkAnchorEncoded.getAttribute('href'), '#ghcn-cr-快速开始', '中文目录百分比编码锚点应正确映射到安全前缀');
    assert.equal(cjkAnchorPrefixed.getAttribute('href'), '#ghcn-cr-快速开始', '带 user-content- 前缀中文锚点应正确映射到安全前缀');
    assert.equal(badIdH3.hasAttribute('id'), false, '含空白或斜杠的危险 id 仍应剥离');
    assert.equal(badImg.hasAttribute('src'), false, '应移除 javascript src');
    assert.equal(badImg.hasAttribute('srcset'), false, '应移除非法 srcset');
    assert.equal(goodVideo.getAttribute('poster'), 'https://github.com/owner/repo/poster.png', '合法 HTTPS poster 应保留');
    assert.equal(cleaned.dataset.ghcnChineseReadme, 'true');

    // locale-maintenance.js coverage 对原型属性应使用 Object.hasOwn 防护
    const protoSample = JSON.stringify({
      format: 'ghcn-ui-misses',
      version: 1,
      rows: [{ page: 'repository/projects', text: 'Custom toString constructor check', count: 1 }],
    });
    const protoReport = JSON.parse(execFileSync(process.execPath, ['script/locale-maintenance.js', 'coverage', '-'], { cwd: ROOT, input: protoSample, encoding: 'utf8' }));
    assert.equal(protoReport.covered, 0);
    assert.equal(protoReport.missing.length, 1);

    // index_translate 配置备份与密钥剥离边界
    const indexSettingsInput = {
      readme_provider: 'index_translate',
      readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
      readme_index_translate_api_key: 'optional-relay-key',
      readme_index_translate_model: 'Index-Translate-35B-A3B',
    };
    const indexSettingsDefaults = {
      readme_provider: 'deepseek',
      readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
      readme_index_translate_api_key: '',
      readme_index_translate_model: 'Index-Translate-35B-A3B',
    };
    const safeIndexSettings = T.settings(indexSettingsInput, indexSettingsDefaults, false);
    assert.equal(safeIndexSettings.readme_provider, 'index_translate');
    assert.equal(safeIndexSettings.readme_index_translate_api_url, 'http://127.0.0.1:8080/v1');
    assert.equal(safeIndexSettings.readme_index_translate_api_key, undefined);
    assert.equal(T.settings(indexSettingsInput, indexSettingsDefaults, true).readme_index_translate_api_key, 'optional-relay-key');

    allAsyncTestsCompleted = true;
    console.log('Maintenance settings, privacy and concurrent collection tests passed.');
  })
  .catch((error) => { console.error(error); process.exitCode = 1; });
