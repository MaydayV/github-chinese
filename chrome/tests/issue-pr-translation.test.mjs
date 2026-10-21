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
const browserContent = ['chrome', 'edge', 'firefox'].map((browser) => ({
  browser,
  js: readFileSync(new URL(`../../${browser}/content.js`, import.meta.url), 'utf8'),
}));

test('discussion body translation setting is exposed in storage and options UI', () => {
  assert.match(optionsJs, /enable_issue_pr_translation:\s*false/);
  assert.match(optionsHtml, /id="enable_issue_pr_translation"/);
  assert.match(optionsHtml, /Issue \/ Pull Request \/ Release/);
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

test('README provider requests use official JSON payloads and optional Azure region', () => {
  browserContent.forEach(({ browser, js }) => {
    const deeplStart = js.indexOf('async function translateWithDeepL');
    const googleStart = js.indexOf('async function translateWithGoogle');
    const azureStart = js.indexOf('async function translateWithAzure');
    const deepl = js.slice(deeplStart, googleStart);
    const google = js.slice(googleStart, azureStart);
    const azure = js.slice(azureStart, js.indexOf('async function translateWithQwenMt', azureStart));

    assert.match(deepl, /'Content-Type': 'application\/json'/, `${browser}: DeepL 应使用 JSON 请求`);
    assert.match(deepl, /body: JSON\.stringify\(\{[\s\S]*text: texts[\s\S]*target_lang:/, `${browser}: DeepL JSON 字段缺失`);
    assert.doesNotMatch(deepl, /application\/x-www-form-urlencoded/, `${browser}: DeepL 不应回退到表单请求`);

    assert.match(google, /'Content-Type': 'application\/json; charset=UTF-8'/, `${browser}: Google 应使用 JSON 请求`);
    assert.match(google, /body: JSON\.stringify\(\{[\s\S]*q: texts[\s\S]*target:/, `${browser}: Google JSON 字段缺失`);
    assert.doesNotMatch(google, /application\/x-www-form-urlencoded/, `${browser}: Google 不应回退到表单请求`);

    assert.match(azure, /if \(providerConfig\.region\) \{[\s\S]*Ocp-Apim-Subscription-Region/, `${browser}: Azure Region 应按需发送`);
    assert.doesNotMatch(azure, /'Ocp-Apim-Subscription-Region': providerConfig\.region/, `${browser}: Azure 不应发送空 Region 请求头`);
  });

  browserOptions.forEach(({ browser, js }) => {
    const azureStart = js.indexOf("case 'azure':");
    const qwenStart = js.indexOf("case 'qwen_mt':", azureStart);
    const azure = js.slice(azureStart, qwenStart);
    assert.match(azure, /if \(!url \|\| !key\)/, `${browser}: Azure Global 资源不应强制填写 Region`);
  });
});

test('settings recommend DeepSeek and keep the three tabs copy consistent', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.match(js, /readme_provider:\s*'deepseek'/, `${browser}: 默认翻译服务应为 DeepSeek`);
    assert.match(js, /deepseek:\s*\{[^}]*model:\s*'deepseek-flash'/, `${browser}: DeepSeek 默认模型应使用官方模型 ID`);
    assert.match(html, /<option value="deepseek">DeepSeek（推荐）<\/option>/, `${browser}: 服务列表应标记 DeepSeek 推荐`);
    assert.equal((html.match(/<option value="deepseek">/g) || []).length, 1, `${browser}: 服务列表不应重复 DeepSeek`);
    assert.match(html, /推荐使用 DeepSeek：速度快、配置简单/, `${browser}: 接口页应说明推荐服务`);
    assert.match(html, /Issue \/ Pull Request \/ Release/, `${browser}: 功能页标题应使用完整名称`);
    assert.match(html, /刷新记录/, `${browser}: 记录页刷新按钮文案应明确`);
    assert.match(html, /清空仓库缓存/, `${browser}: 记录页缓存按钮文案应明确范围`);
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

test('README translation setting explains that repository About descriptions use the same switch', () => {
  browserOptions.forEach(({ browser, html }) => {
    assert.match(html, /README \/ About/, `${browser} 设置页应明确包含 About 翻译范围`);
    assert.match(html, /启用 README \/ About 翻译/, `${browser} 设置开关标题应明确包含 About 翻译`);
    assert.match(html, /侧栏 About 描述/, `${browser} 设置页应说明 About 描述会翻译`);
    assert.match(html, /README 与 About 描述共用此开关和翻译接口/, `${browser} 设置页应说明 About 与 README 共用开关`);
  });
});

test('README translation debug switch records concurrent batches and remaining nodes', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.match(js, /readme_enable_debug:\s*false/, `${browser} 应默认关闭翻译调试日志`);
    assert.match(html, /id="readme_enable_debug"/, `${browser} 设置页应提供翻译调试开关`);
    assert.match(html, /导出调试日志/, `${browser} 记录页应支持导出调试日志`);
    assert.match(js, /DEBUG_LOGS:\s*'ghcn_readme_translation_debug_logs'/, `${browser} 应保存调试日志`);
  });
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /batch_start/, `${browser} 应记录翻译批次开始事件`);
    assert.match(js, /remainingTasks:/, `${browser} 应记录最终未完成节点明细`);
    assert.match(js, /function collectReadmeUntranslatedTasks\(/, `${browser} 应按原始节点判断未翻译内容`);
    assert.match(js, /function isLikelyTechnicalReadmeText\(/, `${browser} 应排除技术标识误判`);
    assert.match(js, /batchPhase: debugPhase/, `${browser} 调试批次阶段不应覆盖事件类型`);
  });
});

test('README translation switch rolls back the UI when persistence fails', () => {
  browserOptions.forEach(({ browser, js }) => {
    const handlerStart = js.indexOf("mainSwitch?.addEventListener('change', async () =>");
    const handlerEnd = js.indexOf("const issuePrSwitch", handlerStart);
    const handler = handlerStart >= 0 && handlerEnd > handlerStart
      ? js.slice(handlerStart, handlerEnd)
      : '';
    assert.match(handler, /catch \(error\) \{[\s\S]*applyValues\(LAST_SAVED_VALUES\);[\s\S]*setStatus\('保存 README 翻译设置失败，请重试。', 'error'\)/, `${browser} 持久化失败时应恢复界面状态`);
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
  assert.match(optionsJs, /release:\s*\{\s*label:\s*'发行版'/);
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

test('Copilot textarea chrome is translated even inside ignored global navigation surfaces', () => {
  assert.match(content, /function translateReactGlobalNavSurface\([\s\S]*?tagName === 'TEXTAREA'[\s\S]*?translateReactGlobalNavAttributes\(surface\)/);
  assert.match(content, /tagName === 'TEXTAREA'[\s\S]*?translateReactGlobalNavAttributes\(node\)[\s\S]*?NodeFilter\.FILTER_REJECT/);
  assert.match(content, /const shouldTranslateTextareaChrome = \(node, type, attributeName\)/);
  assert.match(content, /shouldTranslateTextareaChrome\(node, type, attributeName\) \|\|/);
  assert.match(content, /rootNode\.tagName === 'TEXTAREA'[\s\S]*?handleElement\(rootNode\)/);
});

test('history navigation refreshes the current body and keeps the observer attached', () => {
  assert.match(content, /function refreshAfterHistoryNavigation\(/);
  assert.match(content, /function scheduleHistoryRefresh\(/);
  assert.match(content, /window\.addEventListener\('popstate', scheduleHistoryRefresh\)/);
  assert.match(content, /window\.addEventListener\('pageshow', event =>/);
  assert.match(content, /document\.addEventListener\('turbo:render', \(\) => refreshAfterHistoryNavigation/);
  assert.match(content, /refreshPageObserver\(\)/);
  assert.match(content, /updatePageConfig\(trigger, true\)/);
  assert.match(content, /refreshPageObserver = \(\) =>/);
});

test('Copilot textarea aria labels are translated without touching user-entered text', () => {
  assert.match(content, /case 'TEXTAREA':[\s\S]*transElement\(node, 'placeholder'\)[\s\S]*transElement\(node, 'ariaLabel'\)/);
  assert.match(locals, /"Ask anything or type @ to add context": "询问任何问题或键入@以添加上下文"/);
  assert.match(locals, /"Ask anything or type @ to add context with Copilot": "使用 Copilot 询问任何问题或输入 @ 来添加上下文"/);
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
