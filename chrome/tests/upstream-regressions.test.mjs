import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const locales = [
  ['chrome', new URL('../locals.js', import.meta.url)],
  ['edge', new URL('../../edge/locals.js', import.meta.url)],
  ['firefox', new URL('../../firefox/locals.js', import.meta.url)],
];

const contentScripts = [
  ['chrome', new URL('../content.js', import.meta.url)],
  ['edge', new URL('../../edge/content.js', import.meta.url)],
  ['firefox', new URL('../../firefox/content.js', import.meta.url)],
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

test('repository hydration text changes stay eligible for translation', () => {
  for (const [browser, file] of locales) {
    const config = loadLocale(file).conf;
    assert.ok(config.characterDataPage.includes('repository'), `${browser}: 仓库首页应监听 hydration 文本变更`);
    assert.ok(config.characterDataPage.includes('repository/tree'), `${browser}: 仓库文件页应监听 hydration 文本变更`);
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

test('selected PR #800 additions are synchronized without replacing existing labels', () => {
  for (const [browser, file] of locales) {
    const i18n = loadLocale(file)['zh-CN'];
    assert.equal(i18n.public.static['GitHub Copilot app'], 'GitHub Copilot 应用', browser);
    assert.equal(i18n.public.static['Refresh for latest usage'], '刷新以获取最新用量', browser);
    assert.equal(i18n['page-dashboard'].static['Optimized for:'], '优化方向：', browser);
    assert.equal(i18n['repository/actions'].static['Upcoming change to GitHub App installation token format'], 'GitHub 应用安装令牌格式即将变更', browser);
    assert.equal(i18n['session-authentication'].static['Continue with passkey'], '使用通行密钥继续', browser);
    assert.equal(i18n.notifications.static['Review requested'], '请求审查', browser);
    assert.equal(i18n.issues.static['Mentioning me'], '提及我', browser);
    assert.equal(i18n.pulls.static['About the “Needs your review” section'], '关于“需要您的审查”版块', browser);
    assert.equal(i18n.orgs.static['GitHub Copilot billing for'], 'GitHub Copilot 计费：', browser);
  }
});

test('selected PR #801 Copilot textarea label is synchronized without changing search protections', () => {
  for (const [browser, file] of locales) {
    const localeData = loadLocale(file);
    const dashboard = localeData['zh-CN']['page-dashboard'].static;
    assert.equal(
      dashboard['Ask anything or type @ to add context with Copilot'],
      '使用 Copilot 询问任何问题或输入 @ 来添加上下文',
      browser,
    );
    const globalIgnore = localeData.conf.ignoreMutationSelectorPage['*'];
    assert.ok(globalIgnore.includes('header.GlobalNav [class*="Search-module__"]'), `${browser}: 顶部搜索框保护规则缺失`);
    assert.ok(globalIgnore.includes('qbsearch-input'), `${browser}: 快速搜索组件保护规则缺失`);
    assert.ok(!globalIgnore.includes('input'), `${browser}: 不能通过全局规则跳过 input 属性翻译`);
    assert.ok(!globalIgnore.includes('textarea'), `${browser}: 不能通过全局规则跳过 textarea 属性翻译`);
  }
});

test('recent upstream repository and search labels are synchronized', () => {
  for (const [browser, file] of locales) {
    const i18n = loadLocale(file)['zh-CN'];
    assert.equal(i18n.public.static['Try a different search query.'], '请尝试其他搜索查询。', browser);
    assert.equal(i18n.public.static['Repository files navigation'], '仓库文件导航', browser);
    assert.equal(i18n.public.static['Open more actions menu'], '打开更多操作菜单', browser);
    assert.equal(i18n['page-dashboard'].static['Join GitHub Education!'], '加入 GitHub 教育！', browser);
    assert.equal(i18n.repository.static['Folders and files'], '文件夹和文件', browser);
    assert.equal(i18n.repository.static['Policy insights'], '策略分析', browser);
    assert.equal(i18n['repository/pull_issue_public'].static['Assign to Agent'], '分配给智能体', browser);
    assert.equal(i18n['repository/actions'].static['Filter by Workflow'], '按工作流程筛选', browser);
  }
});

test('repository About descriptions support hashed SidebarAbout CSS-module classes', () => {
  for (const [browser, file] of contentScripts) {
    const content = readFileSync(file, 'utf8');
    assert.match(
      content,
      /querySelectorAll\('p\[class\*="SidebarAbout-module"\]\[class\*="description"\]'\)/,
      `${browser}: About 描述选择器未兼容新版 CSS-module 哈希类`,
    );
    assert.match(content, /function getRepoAboutElements\(\)/, `${browser}: About 描述应支持多个动态侧栏节点`);
    assert.match(content, /function isRepoAboutTranslationEnabled\(\)/, `${browser}: About 描述独立触发条件缺失`);
    assert.match(content, /About 描述未翻译：/, `${browser}: About 配置失败时应输出诊断信息`);
    assert.match(content, /const translationTasks = \[\];/, `${browser}: About 与 README 应使用独立并行任务`);
    assert.match(content, /await Promise\.all\(translationTasks\)/, `${browser}: About 与 README 不应串行等待`);
    assert.match(content, /TRANSLATION_CONCURRENCY: 3/, `${browser}: README 应限制并发请求数`);
    assert.match(content, /async function mapWithConcurrency\(items, concurrency, worker\)/, `${browser}: README 并发调度器缺失`);
    assert.match(content, /translateRepoAboutDescription/, `${browser}: About 描述翻译入口缺失`);
  }
});

test('selected PR #808 organization settings routes and labels are synchronized', () => {
  for (const [browser, file] of locales) {
    const localeData = loadLocale(file);
    const zh = localeData['zh-CN'];
    assert.ok(localeData.conf.rePagePathOrg.test('/orgs/acme/settings/custom-properties'), `${browser}: 自定义属性组织设置路由缺失`);
    assert.ok(localeData.conf.rePagePathOrg.test('/orgs/acme/settings/issue-fields'), `${browser}: 议题字段组织设置路由缺失`);
    assert.equal(zh['orgs/settings/custom-properties'].title.static['Custom properties'], '自定义属性', browser);
    assert.equal(zh['orgs/settings/issue-fields'].static['Manage issue fields for an organization.'], '管理组织的议题字段。', browser);
    assert.equal(zh['orgs/settings/copilot'].static['Internet access'], '访问互联网', browser);
    assert.equal(zh['settings/blocked_users'].static['For 30 days'], '30 天', browser);
  }
});

test('selected PR #668 review terminology improvements are synchronized', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    assert.equal(zh['repository/pull'].static['Add your review'], '添加您的审查意见', browser);
    assert.equal(zh['repository/pull'].static['Submit review'], '发表审查意见', browser);
    assert.equal(zh['repository/compare'].static['Re-request review'], '重新请求审查', browser);
    assert.equal(zh['session-authentication'].static['When you are ready, authenticate using the button below.'], '就绪后，请使用下面的按钮进行身份验证。', browser);
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
      'Try the new dashboard': '试用新版仪表板',
      'Switch to classic dashboard': '切换至经典仪表板',
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
