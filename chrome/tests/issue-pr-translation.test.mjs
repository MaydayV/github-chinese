import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const locals = readFileSync(new URL('../locals.js', import.meta.url), 'utf8');
const optionsHtml = readFileSync(new URL('../options/options.html', import.meta.url), 'utf8');
const optionsJs = readFileSync(new URL('../options/options.js', import.meta.url), 'utf8');
const browserOptions = ['chrome', 'edge', 'firefox'].map((browser) => ({
  browser,
  html: readFileSync(new URL(`../../${browser}/options/options.html`, import.meta.url), 'utf8'),
  js: readFileSync(new URL(`../../${browser}/options/options.js`, import.meta.url), 'utf8'),
}));

test('discussion body translation setting is exposed in storage and options UI', () => {
  assert.match(optionsJs, /enable_issue_pr_translation:\s*false/);
  assert.match(optionsHtml, /id="enable_issue_pr_translation"/);
  assert.match(optionsHtml, /Issue \/ PR \/ Release/);
  assert.match(optionsHtml, /启用正文翻译/);
});

test('content script can identify and decorate Issue and PR discussions', () => {
  assert.match(content, /function isIssueOrPrDiscussionPage\(/);
  assert.match(content, /function findDiscussionItems\(/);
  assert.match(content, /function mountDiscussionToolbar\(/);
  assert.match(content, /function createTranslatedClone\(/);
  assert.match(content, /function setDiscussionViewMode\(/);
  assert.match(content, /\[data-testid="issue-body-viewer"\] \[data-testid="markdown-body"\]/);
  assert.match(content, /data-ghcn-discussion-translate/);
  assert.doesNotMatch(content, /insertAdjacentElement\('beforebegin',\s*toolbar\)/);
});

test('content script reuses discussion translation for Release notes', () => {
  assert.match(content, /function isReleaseNotesPage\(/);
  assert.match(content, /function isDiscussionTranslationTargetPage\(/);
  assert.match(content, /RELEASE_BODY_SELECTORS/);
  assert.match(content, /div\.Box-body > div\.markdown-body/);
  assert.match(content, /sourceType:\s*isReleaseNotes \? 'release'/);
  assert.match(content, /ghcn-discussion-translate-toolbar--release/);
  assert.match(content, /if \(!slotEl && item\.sourceType !== 'release'\) return/);
  assert.match(content, /item\.viewerEl\.insertBefore\(toolbar,\s*item\.markdownEl\)/);
  assert.match(content, /getDiscussionRecordSourceType\(item\)/);
});

test('Issue and PR translation keeps original DOM and exposes view modes', () => {
  assert.match(content, /data-ghcn-discussion-view-mode/);
  assert.match(content, /ghcn-discussion-translation-panel/);
  assert.match(content, /original/);
  assert.match(content, /translated/);
  assert.match(content, /bilingual/);
});

test('Issue and PR translation uses GitHub green primary action and persistent errors', () => {
  assert.match(content, /ghcn-discussion-translate-btn--primary/);
  assert.match(content, /button-primary-bgColor-rest/);
  assert.match(content, /\.ghcn-discussion-translate-btn--primary:hover[\s\S]*button-primary-bgColor-hover/);
  assert.match(content, /\.ghcn-discussion-translate-btn\.is-active:hover[\s\S]*button-primary-bgColor-hover/);
  assert.match(content, /function normalizeRuntimeErrorMessage\(/);
  assert.match(content, /插件上下文已失效，请刷新当前 GitHub 页面后重试。/);
  assert.match(content, /normalizeRuntimeErrorMessage\(error\)/);
  assert.match(content, /errorMessage/);
  assert.match(content, /renderIssuePrError\(toolbar,\s*state\.errorMessage\)/);
  assert.match(content, /重试/);
});

test('translated clone does not inherit extension marker that skips text collection', () => {
  assert.match(content, /translatedEl\.removeAttribute\('data-ghcn-discussion-translate'\)/);
  assert.match(content, /translatedEl\.querySelectorAll\('\[data-ghcn-discussion-translate\]'\)/);
});

test('Issue and PR translation switch persists when toggled', () => {
  assert.match(optionsJs, /function savePartialValues\(/);
  assert.match(optionsJs, /savePartialValues\(\{\s*enable_issue_pr_translation:/);
});

test('translation connection test is visible for every provider', () => {
  browserOptions.forEach(({ browser, html }) => {
    assert.match(html, /<section class="card connection-test">[\s\S]*id="testConnection"/, `${browser} 应显示连通性测试区域`);
    const providerSections = html.match(/<section class="card provider"[\s\S]*?<\/section>/g) || [];
    assert.equal(
      providerSections.some((section) => section.includes('id="testConnection"')),
      false,
      `${browser} 的连通性测试按钮不应嵌套在单个服务面板中`,
    );
  });
});

test('saving a valid provider config requests host access before features are enabled', () => {
  browserOptions.forEach(({ browser, js }) => {
    assert.match(
      js,
      /const providerConfig = getProviderConfig\(ruled\.values\);\s*if \(providerConfig\.ok\) \{\s*const permission = await ensureProviderHostPermission\(ruled\.values, \{ request: true \}\)/,
      `${browser} 保存有效接口配置时应主动申请主机权限`,
    );

    const permissionStart = js.indexOf('async function ensureProviderHostPermission');
    const permissionEnd = js.indexOf('function enforceFeatureSwitchRules', permissionStart);
    const permissionFlow = permissionStart >= 0 && permissionEnd > permissionStart
      ? js.slice(permissionStart, permissionEnd)
      : '';
    assert.ok(permissionFlow, `${browser} 应包含主机权限处理函数`);
    assert.ok(
      permissionFlow.indexOf('if (request)') < permissionFlow.indexOf('const alreadyGranted = await permissionsContains(origins)'),
      `${browser} 应在用户手势中直接申请权限，再处理只读权限检查`,
    );
  });
});

test('README translation switch persists both enabled and disabled states', () => {
  browserOptions.forEach(({ browser, js }) => {
    assert.match(
      js,
      /savePartialValues\(\{\s*enable_readme_translation: true,/,
      `${browser} 应持久化 README 翻译开启状态`,
    );
    assert.match(
      js,
      /savePartialValues\(\{\s*enable_readme_translation: false,/,
      `${browser} 应持久化 README 翻译关闭状态`,
    );
  });
});

test('Issue and PR translation follows README progressive cache and record settings', () => {
  assert.match(content, /function buildDiscussionCacheKey\(/);
  assert.match(content, /function getIssuePrRecordSourceType\(/);
  assert.match(content, /function getDiscussionRecordSourceType\(/);
  assert.match(content, /getRepoCachedTranslation\(cacheKey\)/);
  assert.match(content, /upsertRepoCachedTranslation\(cacheKey/);
  assert.match(content, /FeatureSet\.readme_enable_progressive/);
  assert.match(content, /appendReadmeTranslationRecord\(/);
  assert.match(content, /sourceType:\s*getDiscussionRecordSourceType\(item\)/);
  assert.match(content, /sourceType:\s*record\?\.sourceType \|\| 'readme'/);
  assert.match(optionsJs, /sourceType:\s*normalizeRecordSourceType\(item\.sourceType\)/);
  assert.match(optionsJs, /getRecordSourceMeta\(item\.sourceType\)/);
  assert.match(optionsJs, /release:\s*\{\s*label:\s*'Release'/);
  assert.match(content, /detail: `\$\{getDiscussionRecordSourceType\(item\)\}_translated_nodes=\$\{translatedCount\}`/);
});

test('Issue and PR translation covers React comments and legacy PR timeline comments', () => {
  assert.match(content, /IssueCommentBody/);
  assert.match(content, /comment-viewer-outer-box/);
  assert.match(content, /\.react-issue-comment/);
  assert.match(content, /\.timeline-comment-group/);
  assert.match(content, /ActionsButtonsContainer/);
  assert.match(content, /comment-header-right-side-items/);
  assert.match(content, /\.timeline-comment-actions/);
});

test('global navigation translation handles React portals without breaking hydration guards', () => {
  assert.match(content, /function setupReactGlobalNavTranslation\(/);
  assert.match(content, /function isReactGlobalNavPortalNode\(/);
  assert.match(content, /setupReactGlobalNavTranslation\(\)/);
  assert.match(content, /#__primerPortalRoot__ \[role="dialog"\]/);
  assert.match(content, /#search-suggestions-dialog/);
  assert.match(content, /\[aria-label="Quick search"\]/);
  assert.match(content, /\[aria-label="Search suggestions"\]/);
  assert.match(content, /isReactGlobalNavPortalNode\(element\)/);
  assert.match(content, /scheduleReactGlobalNavRefresh/);
  assert.match(content, /function translateReactGlobalNavPortalsSoon\(/);
  assert.match(content, /requestAnimationFrame\(translatePortals\)/);
  assert.match(locals, /'react-app:not\(\.loaded\)'/);
  assert.match(locals, /'react-partial:not\(\.loaded\)'/);
  assert.match(locals, /'header\.GlobalNav'/);
  assert.match(locals, /'#__primerPortalRoot__'/);
  assert.match(locals, /'qbsearch-input'/);
  assert.doesNotMatch(content, /closest\?\.\(searchModuleSelector\)/);
  assert.doesNotMatch(content, /closest\?\.\(searchSurfaceSelector\)/);
});

test('latest upstream navigation labels and flagged organization terms are present', () => {
  assert.match(locals, /reactGlobalNavLabels/);
  assert.match(locals, /"To see all available qualifiers, see our documentation\.": "要查看全部可用限定符，请参阅文档。"/);
  assert.match(locals, /"Nonprofits": "非营利组织"/);
  assert.match(locals, /"Healthcare": "医疗健康"/);
  assert.match(locals, /"Pricing": "定价"/);
  assert.match(locals, /"View all resources": "查看全部资源"/);
  assert.match(locals, /"Because of that, your organization is hidden from the public/);
  assert.match(locals, /The \(\.\+\) organization has been flagged/);
});

test('new quick search dialog labels are translated', () => {
  assert.match(locals, /"Open quick search dialog, type \/ to search": "打开快速搜索对话框，键入 \/ 搜索"/);
  assert.match(locals, /"Quick search": "快速搜索"/);
  assert.match(locals, /"Search suggestions": "搜索建议"/);
  assert.match(locals, /"Breadcrumbs": "面包屑导航"/);
  assert.match(locals, /"Chat with Copilot": "与 Copilot 聊天"/);
  assert.match(locals, /"Open Copilot chat": "打开 Copilot 聊天"/);
  assert.match(locals, /Jump to \(\.\+\), repository/);
});
