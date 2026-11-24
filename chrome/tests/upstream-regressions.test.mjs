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

test('dictionary conflict cleanup preserves page-specific effective regex translations', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    for (const [page, source, expected] of [
      ['public', 'Chatting with 2 attachments', '附加 2 个附件'],
      ['repository/issues', 'Edited 2 times', '已编辑 2 次'],
      ['repository/labels', 'Edited 2 times', '已编辑 2 次'],
      ['repository/pull_issue_public', 'Edited 2 times', '编辑 2 次'],
      ['repository/pull', '2 successful checks', '2 次成功检查'],
      ['repository-public', '2 successful checks', '2 个成功的检查'],
      ['repository/settings/access', '2 members', '2 位成员'],
      ['repository-public', '2 members', '2 个成员'],
      ['repository/pulse', '2 authors', '2 作者'],
    ]) assert.equal(translate(zh[page].regexp, source), expected, `${browser}: ${page} ${source}`);
    assert.equal(zh.public.static['Copied!'], '复制成功！', browser);
    assert.equal(zh.repository.static.Name, '文件名', browser);
  }
});

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

test('Less programming language name stays unchanged while ordinary less labels translate', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    assert.equal(zh.public.static.Less, 'Less', `${browser}: Less 语言名称应保留原文`);
    assert.equal(zh.public.static['Show less'], '显示更少', `${browser}: 普通 Show less 文案仍应翻译`);
  }
});

test('relative-time rules do not rewrite duration-like words in ordinary text', () => {
  for (const [browser, file] of locales) {
    const rules = loadLocale(file)['zh-CN'].public.regexp;
    for (const text of [
      'Windows Search sometimes steals focus when I press the physical Windows key on a second monitor',
      'Wait a second',
      'A 2 minute delay',
      'Support a secondhand monitor',
    ]) {
      assert.equal(translate(rules, text), text, `${browser}: ${text}`);
    }
    for (const [text, expected] of [
      ['a second', '1 秒之前'],
      ['7 months', '7 个月之前'],
      ['2 hours ago', '2 小时之前'],
      ['Updated about a day ago', 'Updated 大约 1 天之前'],
      ['Expires in 6 minutes', 'Expires 6 分钟之内'],
    ]) {
      assert.equal(translate(rules, text), expected, `${browser}: ${text}`);
    }
  }
});

test('PAT permission preview has a scoped long-text limit and translations', () => {
  for (const [browser, file] of locales) {
    const data = loadLocale(file);
    const zh = data['zh-CN'];
    const page = zh['settings/personal-access-tokens'];
    assert.ok(data.conf.characterDataPage.includes('settings/personal-access-tokens'), `${browser}: PAT 页应监听动态权限文本`);
    assert.equal(data.conf.maxTextNodeLengthPage['settings/personal-access-tokens'], 2000, `${browser}: PAT 长文本上限`);
    assert.equal(page.static['Delete this token'], '删除此令牌', browser);
    assert.equal(page.static['This token does not have any user permissions.'], '此令牌没有任何用户权限。', browser);
    assert.equal(
      translate(page.regexp, 'Read and write access to contents, issues, and pull requests.'),
      '内容、议题和拉取请求的读写访问权限。',
      `${browser}: PAT 权限预览`
    );
  }
});

test('dynamic dialog and menu text is translated without enabling search-query echo', () => {
  for (const [browser, file] of contentScripts) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /LIVE_SURFACE_SELECTOR[\s\S]*\[role="menu"\][\s\S]*\.dropdown-menu/);
    assert.match(source, /SEARCH_QUERY_SELECTOR[\s\S]*#search-suggestions-dialog[\s\S]*#qb-input-query/);
    assert.match(source, /pageConfig\.characterData \|\| isLiveSurfaceCharacterData\(target\)/);
    assert.match(source, /!element\.closest\?\.\(pageConfig\.ignoreMutationSelectors\)/);
    assert.match(source, /!isReactGlobalNavPortalNode\(element\)[\s\S]*isLiveSurfaceCharacterData\(node\)/);
    assert.ok(loadLocale(locales.find(([name]) => name === browser)[1]).conf.ignoreMutationSelectorPage['*'].includes('qbsearch-input'), `${browser}: 顶部搜索保护仍在`);
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
      /ABOUT_SELECTORS[\s\S]*SidebarAbout-module[\s\S]*description/,
      `${browser}: About 描述选择器未兼容新版 CSS-module 哈希类`,
    );
    assert.match(
      content,
      /ABOUT_SELECTORS[\s\S]*borderGrid__|borderGrid__.*description__/,
      `${browser}: About 描述应兼容 BorderGrid/description 哈希类`,
    );
    assert.match(content, /\.f4\.tmp-my-3/, `${browser}: About 描述应保留经典 UI 选择器`);
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

test('selected upstream settings and Copilot additions are synchronized', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    const blocked = zh['settings/blocked_users'].static;
    assert.equal(blocked['Block settings'], '拉黑设置', browser);
    assert.equal(blocked['Select one or more reasons for blocking.'], '请选择一项或多项拉黑原因。', browser);
    assert.equal(blocked['Please don\'t include any personal information such as legal names or email addresses. Markdown is supported. This note will only be visible to you.'], '请勿包含法定姓名或电子邮箱地址等个人信息。支持 Markdown。此备注仅对您可见。', browser);

    const packages = zh['settings/packages'].static;
    assert.equal(packages['I understand the consequences, restore this package.'], '我了解后果，恢复此软件包。', browser);
    assert.equal(packages['This will restore the package'], '这将恢复软件包', browser);

    const repositorySettings = zh['repository/settings'].static;
    assert.equal(repositorySettings['MCP servers'], 'MCP 服务器', browser);
    assert.equal(repositorySettings['Agent suggestions for issues'], '议题智能体建议', browser);

    const dashboard = zh['page-dashboard'].static;
    assert.equal(dashboard['Give dashboard feedback'], '提供仪表板反馈', browser);
    assert.equal(dashboard['Very dissatisfied'], '非常不满意', browser);

    const copilot = zh.copilot.static;
    assert.equal(copilot['Optimized for:'], '优化方向：', browser);
    assert.equal(copilot['Balances speed and intelligence'], '兼顾速度和智能', browser);
    assert.equal(copilot['Upgrade to Copilot Pro'], '升级到 Copilot Pro', browser);
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

test('selected upstream homepage and dashboard terms are synchronized', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    const homepage = zh.homepage.static;
    for (const [source, expected] of Object.entries({
      'Software still starts': '软件，依然',
      'with you': '始于你',
      'Review changes': '审查更改',
      'Direct the fix': '指导修复',
      'Check the results': '检查结果',
      'Approve and merge': '批准并合并',
      'See it shipped': '见证发布',
      'GitHub Platform': 'GitHub 平台',
      'Repository hosting, code review, and collaboration': '仓库托管、代码审查与协作',
      'See plans and pricing': '查看计划与定价',
      'More ways to use GitHub': '更多使用 GitHub 的方式',
      'Join the world\'s largest developer community': '加入全球最大的开发者社区',
    })) {
      assert.equal(homepage[source], expected, `${browser}: ${source}`);
    }

    const dashboard = zh['page-dashboard'].static;
    assert.equal(dashboard['Make Home your homepage'], '将首页设为您的主页', browser);
    assert.equal(dashboard['Make Feed your homepage'], '将动态设为您的主页', browser);
    assert.equal(dashboard['Pin your homepage'], '固定您的主页', browser);
    assert.equal(dashboard['Got it'], '知道了', browser);
  }
});

test('selected new pull request and issue detail terms are present', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    const common = zh['repository/pull_issue_public'].static;
    for (const [source, expected] of Object.entries({
      'React': '添加表情回应',
      'Select an item': '选择一项',
      'Search saved replies': '搜索快捷回复',
      'Create new': '新建',
      'Comment can not be empty': '评论不能为空',
    })) assert.equal(common[source], expected, `${browser}: ${source}`);

    const issue = zh['repository/issues'].static;
    assert.equal(issue['Convert to sub-issue'], '转换为子议题', browser);
    assert.equal(issue['Add artifact'], '添加工件', browser);
    assert.equal(issue['Edit Assignees'], '编辑受理人', browser);

    const pull = zh['repository/pull'].static;
    assert.equal(pull['Merging is currently blocked. Click to view details in the merge panel.'], '当前无法合并。点击可在合并面板中查看详情。', browser);
    assert.equal(pull['No deployments yet'], '暂无部署', browser);
    assert.equal(zh.public.static['New Pull Requests Overview'], '新版拉取请求概览', browser);
  }
});

test('reported repository projects and split pull request empty-state text are translated', () => {
  for (const [browser, file] of locales) {
    const zh = loadLocale(file)['zh-CN'];
    assert.equal(
      zh.public.static['There are no projects linked to this repository.'],
      '尚无关联到此仓库的项目。',
      `${browser}: 仓库项目空状态`
    );
    assert.equal(
      zh.pulls.static['Learn more about searching and filtering'],
      '了解更多关于搜索和筛选',
      `${browser}: PR 页面拆分后的说明链接前缀`
    );
    assert.equal(
      zh.pulls.static['Learn more about searching and filtering pull requests.'],
      '了解更多关于搜索和过滤拉取请求的信息。',
      `${browser}: PR 页面整句词条应保留`
    );
  }
});

test('repository pull request sidebar filters use the repository pulls dictionary', () => {
  for (const [browser, file] of locales) {
    const pulls = loadLocale(file)['zh-CN']['repository/pulls'].static;
    for (const [source, expected] of Object.entries({
      'Authored by me': '由我创建',
      'Assigned to me': '分配给我',
      'Involves me': '涉及我',
      'Review requests': '审查请求',
      'Stacks': '堆叠',
    })) {
      assert.equal(pulls[source], expected, `${browser}: ${source}`);
    }
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

test('PR #840 repository pages include missing terms without replacing local wording', () => {
  const samples = {
    'repository/issues': {
      'Shared': '共享',
      'No private views yet': '暂无私有视图',
      'No shared views yet': '暂无共享视图',
      'Collapse Private': '折叠私有视图',
      'Expand Private': '展开私有视图',
      'Collapse Shared': '折叠共享视图',
      'Expand Shared': '展开共享视图',
      'Updated': '最后更新',
    },
    'repository/projects': {
      'Clear search query': '清除搜索内容',
      'No closed projects': '暂无已关闭的项目',
      'No projects matched your search': '没有与搜索条件匹配的项目',
      'Try a different search term or clear the search to see all': '请更换搜索词，或清除搜索条件以查看所有',
    },
    'repository/pull': { 'Merge is blocked': '合并被阻止' },
    'repository/security': {
      'Malware alerts are disabled.': '恶意软件警报已禁用。',
      'To receive Malware alerts, you must first enable Malware alerts in': '要接收恶意软件警报，请先启用此功能，入口位于',
      'No open alerts': '暂无未关闭的警报',
      'There are no open Dependabot alerts for this repository.': '此仓库没有未关闭的 Dependabot 警报。',
      'No closed alerts': '暂无已关闭的警报',
      'There are no closed Dependabot alerts for this repository.': '此仓库没有已关闭的 Dependabot 警报。',
    },
    'repository/community': {
      'Additional community file': '其他社区文件',
      "Describe your project's accessibility commitment, supported environments, known limitations, and how people can report barriers.": '说明项目在无障碍方面的承诺、支持的环境、已知限制，以及如何反馈遇到的无障碍问题。',
      'Writing an accessibility statement': '编写无障碍声明',
      'View an ACCESSIBILITY.md example': '查看 ACCESSIBILITY.md 示例',
    },
  };
  for (const [browser, file] of locales) {
    const i18n = loadLocale(file);
    const zh = i18n['zh-CN'];
    for (const [page, terms] of Object.entries(samples)) {
      for (const [source, expected] of Object.entries(terms)) {
        assert.equal(zh[page].static[source], expected, `${browser}: ${page} ${source}`);
      }
    }
    for (const page of ['repository/issues', 'repository/projects', 'repository/milestones', 'repository/labels']) {
      assert.equal(zh[page].static['Collapse sidebar'], '折叠侧边栏', `${browser}: ${page}`);
      assert.equal(zh[page].static['Expand sidebar'], '展开侧边栏', `${browser}: ${page}`);
      assert.equal(zh[page].static['Assigned to me'], '分配给我', `${browser}: 保留本地第一人称`);
      assert.equal(zh[page].static['Created by me'], '由我创建', browser);
      assert.ok(i18n.conf.characterDataPage.includes(page), `${browser}: ${page} 动态文字监听`);
    }
    assert.equal(translate(zh['repository/projects'].regexp, 'No projects matched “test”'), '未找到与“test”匹配的项目', browser);
    assert.equal(translate(zh.projects.regexp, 'No projects matched “test”'), 'No projects matched “test”', `${browser}: 不扩大项目正则作用域`);
    assert.equal(zh['repository/projects/new'].attributes, undefined, `${browser}: 不改变项目创建页属性`);
    assert.equal(zh.public.static['There are no projects linked to this repository.'], '尚无关联到此仓库的项目。', browser);
  }
});

function extractRuntimeFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Cannot extract ${name}`);
}

function makeElement(selectors = [], attributes = {}, children = []) {
  const element = {
    nodeType: 1, tagName: 'DIV', className: '', dataset: {}, attributes: { ...attributes }, children,
    parentElement: null, ignored: false, writes: 0,
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; this.writes++; },
    matches(selector) { return selectors.includes(selector) || (selector === this.ignoreSelector && this.ignored); },
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    },
    get title() { return this.attributes.title; },
    set title(value) { this.setAttribute('title', value); },
  };
  for (const child of children) child.parentElement = element;
  return element;
}

function loadAttributeRuntime(browser, page, pathname) {
  const i18n = loadLocale(locales.find(([name]) => name === browser)[1]);
  const source = readFileSync(contentScripts.find(([name]) => name === browser)[1], 'utf8');
  const observers = [];
  const context = {
    I18N: i18n,
    GhcnMaintenance: { lookup: () => undefined }, maintenanceData: { entries: [] }, recordUiMiss() {},
    CONFIG: { LANG: 'zh-CN', OBSERVER_CONFIG: { childList: true, subtree: true, characterData: true, attributeFilter: ['value', 'placeholder', 'aria-label', 'data-confirm'] } },
    FeatureSet: { enable_extension: true }, readmeRuntime: { isApplyingTranslation: false },
    window: { location: { pathname, href: `https://github.com${pathname}` } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    isReactGlobalNavPortalNode: () => false,
    updatePageConfig() {},
    document: {
      body: makeElement(),
      createTreeWalker(root, flags, filter) {
        const nodes = [];
        const visit = node => {
          if (filter(node) === 2) return;
          nodes.push(node);
          (node.children || []).forEach(visit);
        };
        (root.children || []).forEach(visit);
        return { nextNode: () => nodes.shift() || null };
      },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      disconnect() {}
      observe(body, config) { this.config = config; }
    },
  };
  createContext(context);
  const functions = ['buildPageConfig', 'getPageObserverConfig', 'watchUpdate', 'traverseNode',
    'transPageAttributes', 'applyCustomAttributes', 'transElement', 'transText', 'fetchTranslatedText'];
  runInContext(functions.map(name => extractRuntimeFunction(source, name)).join('\n'), context);
  context.pageConfig = context.buildPageConfig(page);
  return { context, observers, rules: context.pageConfig.attributeTranslations };
}

test('PR #841 attributes handle mutation roots and descendants without repeated writes', () => {
  for (const [browser] of locales) {
    const { context, rules } = loadAttributeRuntime(browser, 'repository/projects', '/owner/repo/projects');
    for (const [selector, attribute, translations] of rules) {
      for (const [source, expected] of Object.entries(translations)) {
        const node = makeElement([selector], { [attribute]: source });
        context.traverseNode(node);
        assert.equal(node.getAttribute(attribute), expected, `${browser}: root ${source}`);
        const writes = node.writes;
        context.traverseNode(node);
        assert.equal(node.writes, writes, `${browser}: 不重复写入中文属性`);
        const child = makeElement([selector], { [attribute]: source });
        context.traverseNode(makeElement([], {}, [child]));
        assert.equal(child.getAttribute(attribute), expected, `${browser}: descendant ${source}`);
      }
    }
    const wrongElement = makeElement([], { 'aria-label': 'Loading projects' });
    context.traverseNode(wrongElement);
    assert.equal(wrongElement.getAttribute('aria-label'), 'Loading projects', `${browser}: 选择器不匹配不改写`);
  }
});

test('issue view attribute rules use the live path and do not leak into ordinary issues', () => {
  for (const [browser] of locales) {
    const { context, rules } = loadAttributeRuntime(browser, 'repository/issues', '/owner/repo/issues/views');
    const [selector, attribute, translations] = rules.at(-1);
    for (const [source, expected] of Object.entries(translations)) {
      for (const pathname of ['/owner/repo/issues/views', '/owner/repo/issues/views/']) {
        context.window.location.pathname = pathname;
        const node = makeElement([selector], { [attribute]: source });
        context.traverseNode(node);
        assert.equal(node.getAttribute(attribute), expected, `${browser}: ${source}`);
      }
      for (const pathname of ['/owner/repo/issues', '/owner/repo/issues/123', '/owner/repo/issues/views/other', '/orgs/example/issues/views']) {
        context.window.location.pathname = pathname;
        const node = makeElement([selector], { [attribute]: source });
        context.traverseNode(node);
        assert.equal(node.getAttribute(attribute), source, `${browser}: 离开视图后不沿用排序规则`);
      }
    }
  }
});

test('scoped attributes inherit search, editable, code, and React hydration exclusions', () => {
  for (const [browser] of locales) {
    const { context, rules } = loadAttributeRuntime(browser, 'repository/projects', '/owner/repo/projects');
    const [selector, attribute] = rules[0];
    const ignore = context.pageConfig.ignoreSelectors;
    for (const protectedSelector of ['header.GlobalNav', 'qbsearch-input', '[contenteditable="true"]', '[translate="no"]', 'CODE', 'react-app:not(.loaded)', '#__primerPortalRoot__']) {
      assert.ok(ignore.includes(protectedSelector), `${browser}: ${protectedSelector} 保持保护`);
      const parent = makeElement();
      parent.ignored = true;
      parent.ignoreSelector = ignore;
      const node = makeElement([selector], { [attribute]: 'Issues sidebar navigation' });
      node.parentElement = parent;
      context.traverseNode(node);
      assert.equal(node.writes, 0, `${browser}: 忽略祖先内不改写`);
      const ignoredChild = makeElement([selector], { [attribute]: 'Issues sidebar navigation' });
      ignoredChild.ignored = true;
      ignoredChild.ignoreSelector = ignore;
      context.traverseNode(makeElement([], {}, [ignoredChild]));
      assert.equal(ignoredChild.writes, 0, `${browser}: 忽略后代不改写`);
    }
    const hydrating = makeElement([selector], { [attribute]: 'Issues sidebar navigation' });
    hydrating.ignoreSelector = ignore;
    hydrating.ignored = true;
    context.traverseNode(hydrating);
    hydrating.ignored = false;
    context.traverseNode(hydrating);
    assert.equal(hydrating.getAttribute(attribute), '议题侧边栏导航', `${browser}: hydration 完成后可翻译`);
  }
});

test('page observers restore dynamic sidebar attributes and text while keeping title monitoring scoped', () => {
  for (const [browser] of locales) {
    for (const page of ['repository/projects', 'repository/milestones', 'repository/labels']) {
      const { context, observers, rules } = loadAttributeRuntime(browser, page, '/owner/repo/' + page.split('/')[1]);
      assert.equal(context.getPageObserverConfig().attributeFilter.includes('title'), true, browser);
      context.watchUpdate();
      const observer = observers[0];
      const node = makeElement([rules[1][0]], { title: 'Assigned to me' });
      observer.callback([{ type: 'attributes', attributeName: 'title', target: node, addedNodes: [] }]);
      assert.equal(node.getAttribute('title'), '分配给我', `${browser}: 动态 title 根节点`);
      const text = { nodeType: 3, data: 'Expand sidebar', get length() { return this.data.length; }, parentElement: makeElement() };
      observer.callback([{ type: 'characterData', target: text, addedNodes: [] }]);
      assert.equal(text.data, '展开侧边栏', `${browser}: 动态字符数据`);
      context.pageConfig = context.buildPageConfig('repository');
      context.refreshPageObserver();
      assert.equal(observer.config.attributeFilter.includes('title'), false, `${browser}: 离开页面后不再增加 title 监听`);
      assert.deepEqual(Array.from(context.CONFIG.OBSERVER_CONFIG.attributeFilter), ['value', 'placeholder', 'aria-label', 'data-confirm'], `${browser}: 全局观察配置不变`);
    }
  }
});

test('detectPageType matches newly fixed routes and anchors prefixes cleanly across all browsers', () => {
  for (const [browser, localeFile] of locales) {
    const i18n = loadLocale(localeFile);
    const source = readFileSync(contentScripts.find(([name]) => name === browser)[1], 'utf8');
    const fnCode = [
      extractRuntimeFunction(source, 'isFallbackRepositoryPath'),
      extractRuntimeFunction(source, 'detectPageType'),
    ].join('\n');

    const checkRoute = (pathname, repoNwo = '') => {
      const ctx = {
        URL,
        URLSearchParams,
        I18N: i18n,
        CONFIG: {
          LANG: 'zh-CN',
          PAGE_MAP: {
            'github.com': 'github',
            'gist.github.com': 'gist',
            'www.githubstatus.com': 'status',
            'skills.github.com': 'skills',
            'education.github.com': 'education',
          },
          SPECIAL_SITES: ['gist', 'status', 'skills', 'education'],
        },
        window: { location: { href: `https://github.com${pathname}`, hostname: 'github.com', pathname } },
        document: {
          body: { classList: { contains: () => false } },
          head: {
            querySelector: (sel) => (repoNwo && sel.includes('octolytics-dimension-repository_nwo') ? { content: repoNwo } : null),
          },
        },
      };
      createContext(ctx);
      runInContext(fnCode, ctx);
      return ctx.detectPageType();
    };

    assert.equal(checkRoute('/settings/codespaces/allow_permissions'), 'settings/codespaces/allow_permissions', browser);
    assert.equal(checkRoute('/owner/repo/search', 'owner/repo'), 'repository/search', browser);
    assert.equal(checkRoute('/owner/repo/reported_content', 'owner/repo'), 'repository/reported_content', browser);
    assert.equal(checkRoute('/orgs/acme/discussions'), 'orgs/discussions', browser);
    assert.equal(checkRoute('/installations/new'), 'installations/new', browser);
    assert.equal(checkRoute('/owner/repo/tree', 'owner/repo'), 'repository/tree', browser);
    assert.equal(checkRoute('/owner/repo/tree-foo', 'owner/repo'), 'repository', `${browser}: tree-foo 不得误匹配 repository/tree`);
  }
});

test('locals.js audit regex fixes preserve English prose and translate exact metrics cleanly', () => {
  for (const [browser, localeFile] of locales) {
    const zh = loadLocale(localeFile)['zh-CN'];
    const timeRules = zh.public['time-regexp'];

    assert.equal(translate(timeRules, 'May contain sensitive data'), 'May contain sensitive data', `${browser}: 不得误改正文 May`);
    assert.equal(translate(timeRules, 'May 15, 2026'), '2026年5月15日', `${browser}: 完整英文日期应正常翻译`);
    assert.equal(translate(timeRules, '200ms'), '200ms', `${browser}: 不得误改毫秒单位`);
    assert.equal(translate(timeRules, '5mb'), '5mb', `${browser}: 不得误改文件大小单位`);
    assert.equal(translate(timeRules, '1990s'), '1990s', `${browser}: 不得误改年代`);
    assert.equal(translate(timeRules, '5m ago'), '5 分钟之前', `${browser}: 相对时间短格式应正常翻译`);

    assert.equal(
      translate(zh['settings/billing'].regexp, 'Top three repositories last year'),
      '去年排名前三的仓库',
      `${browser}: Top three repositories last year`,
    );
    assert.equal(
      translate(zh['repository'].regexp, 'MIT and 2 other licenses found'),
      'MIT和另外2个许可证',
      `${browser}: 许可证数量兜底不应输出 undefined`,
    );
    assert.equal(
      translate(zh['repository/settings'].regexp, 'Default branch changed to main'),
      '默认分支更改为 main',
      `${browser}: 默认分支名称应完整捕获`,
    );
    assert.equal(translate(zh['repository/settings'].regexp, 'Delete item'), 'Delete item', `${browser}: ^Delete$ 不得误匹配短语`);
    assert.equal(translate(zh['repository/deployments'].regexp, 'previous'), 'previous', `${browser}: ^via$ 不得误匹配 previous`);
    assert.equal(translate(zh['repository/projects'].regexp, 'hobby'), 'hobby', `${browser}: hobby 保持不变`);

    assert.equal(
      zh.public.title.regexp.some(([pattern]) => pattern === '_regexp_end'),
      false,
      `${browser}: public.title.regexp 不应残留死规则 _regexp_end`,
    );
    assert.equal(translate(zh['repository/pull'].regexp, '2 pending reviewers'), '2 名审查者未决', browser);
    assert.equal(translate(zh['repository/pull'].regexp, 'Commit message'), 'Commit message', `${browser}: Commit message 不得被 Commit 部分替换`);
    assert.equal(translate(zh['repository/pull'].regexp, 'Commits'), '提交', browser);
    assert.equal(
      translate(zh['repository/pull'].regexp, '1 skipped, 2 successful, 1 in progress, and 1 expected checks'),
      '1 个跳过, 2 个成功, 1 个正在进行, 1 个预先检查',
      browser,
    );
    assert.equal(
      translate([...zh['repository/pull'].regexp, ...zh.public.regexp], 'alice requested changes, you commented'),
      'alice 要求更改，您发表评论',
      browser,
    );
    assert.equal(translate(zh['repository/pull'].regexp, 'alice requested changes'), 'alice 要求更改', browser);

    assert.equal(translate(zh['repository/releases'].regexp, 'Alice and Bob'), 'Alice 和 Bob', browser);
    assert.equal(translate(zh['repository/releases'].regexp, 'Docs and tests updated'), 'Docs and tests updated', browser);
    assert.equal(translate([...zh['repository/releases'].regexp, ...zh.public.regexp], 'alice, bob, and 2 more'), 'alice, bob，以及其他 2 个组织', browser);

    assert.equal(translate(zh['repository/forks'].regexp, 'Created 2 days ago'), '创建于 2 days ago', browser);
    assert.equal(translate(zh['repository/forks'].regexp, 'Updated'), '更新于', browser);
    assert.equal(translate(zh['repository/forks'].regexp, 'Last Updated'), 'Last Updated', browser);
    assert.equal(translate(zh['repository/forks'].regexp, 'Newly Created'), 'Newly Created', browser);

    assert.equal(translate(zh.gist.regexp, '5 changes: 3 additions & 2 deletions'), ' 5 处更改：3 处增加 & 2 处删除', browser);

    assert.equal(
      translate(zh.marketplace.regexp, 'By clicking Set up with Acme, you agree to GitHub’s'),
      '单击 “使用 Acme 设置”，即表示您同意 GitHub 的以下条款',
      browser,
    );
    assert.equal(translate(zh.marketplace.regexp, 'Set up with Acme'), '使用 Acme 设置', browser);

    assert.equal(
      translate(zh.codespaces.regexp, 'Your codespace "dev" has been updated to use machine type: "4 cores, 16 GB RAM, 32 GB storage". Changes will take effect the next time your codespace restarts.'),
      '您的代码空间“dev”将更新机器类型为：“4 核，16 GB 内存，32 GB 存储”。更改将在下次启动代码空间时生效。',
      browser,
    );
  }
});
