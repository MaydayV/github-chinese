import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const locales = [
  ['chrome', new URL('../locals.js', import.meta.url)],
  ['edge', new URL('../../edge/locals.js', import.meta.url)],
  ['firefox', new URL('../../firefox/locals.js', import.meta.url)],
];

function loadLocale(file) {
  const context = {};
  createContext(context);
  runInContext(`${readFileSync(file, 'utf8')}\nglobalThis.__I18N = I18N;`, context, { filename: file.pathname });
  return context.__I18N;
}

function translate(rules, source) {
  for (const [pattern, replacement] of rules) {
    const translated = source.replace(pattern, replacement);
    if (translated !== source) return translated;
  }
  return source;
}

test('upstream relative-time regression keeps minutes and months distinct', () => {
  for (const [browser, file] of locales) {
    const publicLocale = loadLocale(file)['zh-CN'].public;
    for (const [source, expected] of Object.entries({
      '1m': '1 分钟之前',
      '1m ago': '1 分钟之前',
      '1mo': '1 个月之前',
      '12mo ago': '12 个月之前',
      '2h': '2 小时之前',
    })) {
      for (const rules of [publicLocale.regexp, publicLocale['time-regexp']]) {
        assert.equal(translate(rules, source), expected, `${browser}: ${source}`);
      }
    }
  }
});

test('upstream issue and PR fixes exist in every browser build', () => {
  for (const [browser, file] of locales) {
    const locales = loadLocale(file);
    const i18n = locales['zh-CN'];
    const issueLocale = i18n['repository/issues'];
    assert.equal(issueLocale.static['Load older activity'], '加载更早的活动', browser);
    assert.equal(issueLocale.static['Load newer activity'], '加载更新的活动', browser);
    assert.equal(issueLocale.static['Collapse sidebar'], '折叠侧边栏', browser);
    assert.equal(issueLocale.static['No projects were found. Please try a different search query.'], '未找到项目。请尝试其他搜索关键词。', browser);
    assert.equal(i18n['repository/releases'].static['Release list'], '发行版列表', browser);
    assert.ok(locales.conf.ignoreSelectorPage['repository/pull'].includes('span.PRIVATE_TreeView-item-content-text'), browser);
    assert.ok(locales.conf.ignoreMutationSelectorPage['repository/pull'].includes('span.PRIVATE_TreeView-item-content-text'), browser);
  }
});

test('Sponsors dashboard onboarding terms and action label are translated', () => {
  for (const [browser, file] of locales) {
    const localeData = loadLocale(file);
    const sponsors = localeData['zh-CN'].sponsors;
    for (const [source, expected] of Object.entries({
      'Your GitHub Sponsors profile': '您的 GitHub Sponsors 个人资料',
      'Enable the sponsor button': '启用赞助按钮',
      'Post on X': '发布到 X',
      'Embed it': '嵌入',
      'All requirements have been met': '已满足所有要求',
    })) {
      assert.equal(sponsors.static[source], expected, `${browser}: ${source}`);
    }
    assert.equal(localeData.conf.reactGlobalNavLabels['Sponsors dashboard navigation'], '赞助者仪表板导航', browser);
    assert.equal(translate(sponsors.regexp, 'Sponsor @MaydayV'), '赞助 @MaydayV', browser);
  }
});

test('upstream editable-content and notification fixes are present in every browser build', () => {
  for (const [browser, file] of locales) {
    const localeData = loadLocale(file);
    const config = localeData.conf;
    for (const [name, list] of Object.entries({
      mutation: config.ignoreMutationSelectorPage['*'],
      initial: config.ignoreSelectorPage['*'],
    })) {
      assert.ok(!list.includes('input'), `${browser}: ${name} 规则不能跳过 input，否则顶部搜索占位符无法翻译`);
      assert.ok(!list.includes('textarea'), `${browser}: ${name} 规则不能跳过 textarea 的属性处理`);
      assert.ok(list.includes('[contenteditable="true"]'), `${browser}: ${name} 应忽略可编辑区域`);
    }
    assert.equal(localeData['zh-CN'].notifications.static['Filter by…'], '筛选…', browser);
    assert.ok(config.ignoreSelectorPage['repository/pull'].includes('span.ActionList-item-label'), browser);
    assert.ok(config.ignoreSelectorPage['repository/pull'].includes('div[class^="CommitHeader-module__commitMessageContainer"]'), browser);
    assert.ok(config.ignoreMutationSelectorPage['repository/pull'].includes('div[class^="CommitHeader-module__commitMessageContainer"]'), browser);
  }
});

test('recent upstream Copilot, fork, and repository settings terms are synchronized', () => {
  for (const [browser, file] of locales) {
    const i18n = loadLocale(file)['zh-CN'];
    assert.equal(i18n.public.static['View token usage'], '查看令牌用量', browser);
    assert.equal(translate(i18n['settings/copilot'].regexp, '3 / 10 AI credits'), '3 / 10 AI 额度', browser);
    assert.equal(translate(i18n['settings/copilot'].regexp, '$5 / $20 budget'), '$5 / $20 预算', browser);
    assert.equal(i18n['page-new-repo'].static["You can't fork this repository at this time."], '您此时不能复刻此仓库。', browser);
    const repositorySettings = i18n['repository/settings'].static;
    assert.equal(repositorySettings['Security features will be interrupted:'], '安全功能将停止', browser);
    assert.equal(repositorySettings['Code scanning will be paused'], '代码扫描将暂停', browser);
    const copilot = i18n.copilot.static;
    assert.equal(copilot['View message token usage'], '查看此消息令牌用量', browser);
    assert.equal(copilot['Message token usage'], '此消息令牌用量', browser);
    assert.equal(copilot['New topic? A fresh chat keeps your usage lower.'], '新话题？新聊天有助于降低使用量。', browser);
  }
});

test('dashboard onboarding terms are synchronized without changing search protections', () => {
  for (const [browser, file] of locales) {
    const localeData = loadLocale(file);
    const dashboard = localeData['zh-CN']['page-dashboard'];
    for (const [source, expected] of Object.entries({
      'Start with GitHub Docs': '从 GitHub 文档开始',
      'GitHub Documentation': 'GitHub 文档',
      'Create your first code project': '创建您的第一个代码项目',
      'It’s your own space to experiment, learn, and share code with the world.': '这是您自己的空间，可以在这里实验、学习并与全世界分享代码。',
      'Start a Copilot chat': '开始 Copilot 聊天',
      'GitHub for beginners on YouTube': 'GitHub 初学者系列（YouTube）',
      'Watch video': '观看视频',
      'Open Copilot chat': '打开 Copilot 聊天',
      'Remove section': '移除该板块',
    })) {
      assert.equal(dashboard.static[source], expected, `${browser}: ${source}`);
    }
    assert.equal(translate(dashboard.regexp, 'Read · Est. 5m'), '阅读 · 预计 5 分钟', browser);

    const globalIgnore = localeData.conf.ignoreMutationSelectorPage['*'];
    assert.ok(globalIgnore.includes('header.GlobalNav [class*="Search-module__"]'), `${browser}: 顶部搜索框保护规则缺失`);
    assert.ok(globalIgnore.includes('qbsearch-input'), `${browser}: 快速搜索组件保护规则缺失`);
    assert.ok(!globalIgnore.includes('input'), `${browser}: 不能通过全局规则跳过 input 属性翻译`);
    assert.ok(!globalIgnore.includes('textarea'), `${browser}: 不能通过全局规则跳过 textarea 属性翻译`);
  }
});

test('two-factor authentication deadline accepts joined and spaced dates', () => {
  for (const [browser, file] of locales) {
    const publicLocale = loadLocale(file)['zh-CN'].public;
    const rule = publicLocale.regexp.find(([pattern]) => pattern.source.includes('to enable two-factor authentication'));
    assert.ok(rule, browser);
    for (const source of [
      'to enable two-factor authentication as an additional security measure. Your activity on GitHub includes you in this requirement. You will need to enable two-factor authentication on your account before2026年9月14日, or be restricted from account actions.',
      'to enable two-factor authentication as an additional security measure. Your activity on GitHub includes you in this requirement. You will need to enable two-factor authentication on your account before 2026年9月14日, or be restricted from account actions.',
    ]) {
      assert.match(translate([rule], source), /^启用双因素身份验证（2FA）/, `${browser}: ${source}`);
      assert.doesNotMatch(translate([rule], source), /to enable two-factor authentication/);
    }
  }
});
