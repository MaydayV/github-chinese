import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
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

test('discussion toolbar reuses an existing action-row control and removes duplicates', () => {
  assert.match(content, /slotEl\.querySelectorAll\('\[data-ghcn-discussion-translate="toolbar"\]'\)/);
  assert.match(content, /existingToolbars\.forEach\([\s\S]*existingToolbar\.remove\(\)/);
  assert.match(content, /state\.toolbarEl = toolbar;[\s\S]*if \(needsRender\) renderDiscussionToolbar\(item\)/);
});

test('content script reuses discussion translation for Release notes', () => {
  assert.match(content, /function isReleaseNotesPage\(/);
  assert.match(content, /function isDiscussionTranslationTargetPage\(/);
  assert.match(content, /RELEASE_BODY_SELECTORS/);
  assert.match(content, /div\.Box-body > div\.markdown-body/);
  assert.match(content, /sourceType:\s*isReleaseNotes \? 'release'/);
  assert.match(content, /ghcn-discussion-translate-toolbar--release/);
  assert.match(content, /if \(!slotEl && item\.sourceType !== 'release'\) return/);
  assert.match(content, /item\.viewerEl\.insertBefore\(newToolbar,\s*item\.markdownEl\)/);
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

test('settings default to index_translate and keep the tabs copy consistent', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.match(js, /readme_provider:\s*'index_translate'/, `${browser}: 默认翻译服务应为 index_translate`);
    assert.match(js, /deepseek:\s*\{[^}]*model:\s*'deepseek-flash'/, `${browser}: DeepSeek 默认模型应使用官方模型 ID`);
    assert.match(html, /<option value="index_translate">哔哩哔哩翻译（免费免 Key · 推荐）<\/option>/, `${browser}: 服务列表应默认推荐哔哩哔哩翻译`);
    assert.equal((html.match(/<option value="index_translate">/g) || []).length, 1, `${browser}: 服务列表不应重复 index_translate`);
    assert.equal((html.match(/<option value="deepseek">/g) || []).length, 1, `${browser}: 服务列表不应重复 DeepSeek`);
    assert.ok(
      html.indexOf('<option value="index_translate">') < html.indexOf('<option value="deepseek">'),
      `${browser}: 哔哩哔哩翻译应排在下拉列表首位`,
    );
    assert.match(html, /默认选用哔哩哔哩翻译/, `${browser}: 接口页应说明默认服务`);
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
    assert.match(js, /return isRepositoryPage\(\) && Boolean\(getReadmeRootElement\(\)\)/, `${browser} README 应在仓库页面类型异常时使用 DOM 兜底`);
    assert.match(js, /batch_start/, `${browser} 应记录翻译批次开始事件`);
    assert.match(js, /remainingTasks:/, `${browser} 应记录最终未完成节点明细`);
    assert.match(js, /function collectReadmeUntranslatedTasks\(/, `${browser} 应按原始节点判断未翻译内容`);
    assert.match(js, /function isLikelyTechnicalReadmeText\(/, `${browser} 应排除技术标识误判`);
    assert.match(js, /npm\|pnpm\|yarn\|bun\|node/, `${browser} 应识别普通文本中的命令前缀`);
    assert.match(js, /a-z0-9_-.*1,24/, `${browser} 应识别列表/表格中的技术键名格式`);
    assert.match(js, /closest\('li, dt, table'\)/, `${browser} 应按列表/表格上下文排除技术键名`);
    assert.match(js, /'button'/, `${browser} README 任务收集应排除 GitHub 代码复制按钮`);
    assert.doesNotMatch(js, /'\.js-snippet-clipboard-copy-unpositioned'/, `${browser} 不应把 README 外层容器误当成跳过区域`);
    assert.match(js, /function isLikelyOpaqueReadmeLabel\(/, `${browser} 应按文本形态识别需要保持原文的产品名和服务名`);
    assert.match(js, /isHeading[\s\S]*document\.title\.includes\(input\)/, `${browser} 应保留与页面标题一致的 README 产品名`);
    assert.match(js, /isTableLink[\s\S]*titleCaseWords\.length === words\.length/, `${browser} 应保留表格链接中的工具/产品名`);
    assert.match(js, /A-Z0-9\]\{2,\}/, `${browser} 应识别带官方缩写的产品名`);
    assert.doesNotMatch(js, /amazon simple queue service|amazon cloudwatch|mechanicalturk/i, `${browser} 不应硬编码某个仓库的产品名列表`);
    assert.match(js, /getStableReadmeTextHash\(state\.originalHtml\)/, `${browser} README 缓存应使用稳定文本指纹`);
    assert.match(js, /translatedTextHash/, `${browser} 应区分 HTML 外壳变化和正文变化`);
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
  assert.match(optionsJs, /about:\s*\{\s*label:\s*'仓库简介'/);
  assert.match(optionsJs, /about_cache_hit/);
  assert.match(optionsJs, /about_translated_nodes/);
  assert.match(content, /sourceType:\s*'about'/);
  assert.match(content, /about_translated_nodes=/);
  assert.match(content, /detail: `\$\{getDiscussionRecordSourceType\(item\)\}_translated_nodes=\$\{translatedCount\}`/);
  assert.match(content, /const complete = !remainingTasks\.length;/);
  assert.match(content, /if \(complete \|\| translatedCount > 0 \|\| partialCacheApplied\)\s*\{[\s\S]*upsertRepoCachedTranslation\(cacheKey/);
  assert.match(content, /translatedHtml: translatedEl\.innerHTML,[\s\S]*complete,/);
});

test('Issue and PR translation covers React comments and legacy PR timeline comments', () => {
  assert.match(content, /IssueCommentBody/);
  assert.match(content, /comment-viewer-outer-box/);
  assert.match(content, /\.react-issue-comment/);
  assert.match(content, /\.timeline-comment-group/);
  assert.match(content, /ActionsButtonsContainer/);
  assert.match(content, /comment-header-right-side-items/);
  assert.match(content, /\.timeline-comment-actions/);
  assert.match(content, /const findMenuButton = \(scope\) =>/);
  assert.match(content, /从正文向上查找/);
  assert.match(content, /menuButton \|\|= findMenuButton\(rootEl\)/);
  assert.match(content, /comment-actions-container'\)\?\.parentElement/);
  assert.match(content, /menuButton\?\.closest\('comment-actions-container'\)\?\.parentElement/);
  assert.match(content, /menuButton\?\.closest\('\.timeline-comment-actions'\)/);
  assert.match(content, /menuButton\?\.closest\('\[class\*="ActionsButtonsContainer"\]'\)/);
  assert.doesNotMatch(content, /menuButton\?\.closest\([^)]*\.d-flex\.flex-row[^)]*\)/);
  assert.match(content, /toolbar\.parentElement !== slotEl/);
  assert.match(content, /\.timeline-comment-actions > \.d-flex/);
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

test('initial lifecycle starts README translation even when storage loading misses DOMContentLoaded', () => {
  assert.match(content, /let pageLifecycleStarted = false/);
  assert.match(content, /function startPageLifecycle\(reason\)/);
  assert.match(content, /if \(pageLifecycleStarted \|\| !document\.body\) return/);
  assert.match(content, /if \(document\.readyState !== 'loading'\) \{[\s\S]*startPageLifecycle\('init:ready'\)/);
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

test('collaboration helper setting is exposed across options and content script', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.match(js, /enable_collaboration_helper:\s*false/, `${browser} options.js 应包含 enable_collaboration_helper 默认设置`);
    assert.match(html, /id="enable_collaboration_helper"/, `${browser} options.html 应包含 enable_collaboration_helper 元素`);
    assert.match(html, /启用协作润色助手/, `${browser} options.html 应包含协作润色助手文案`);
    assert.match(js, /savePartialValues\(\{\s*enable_collaboration_helper:/, `${browser} options.js 应在开关切换时持久化保存`);
  });
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /enable_collaboration_helper:\s*false/, `${browser} content.js 应包含 enable_collaboration_helper 默认设置`);
    assert.match(js, /function isCollaborationHelperEnabled\(/, `${browser} content.js 应包含 isCollaborationHelperEnabled`);
    assert.match(js, /function scheduleCollaborationHelperControls\(/, `${browser} content.js 应包含 scheduleCollaborationHelperControls`);
    assert.match(js, /function findCollaborationToolbarMountPoint\(/, `${browser} content.js 应包含 findCollaborationToolbarMountPoint`);
    assert.match(js, /button\[data-md-button="heading"\]/, `${browser} content.js 应定位 heading 标题按钮`);
    assert.match(js, /headingBtn\.closest\('md-header'\)/, `${browser} content.js 应解析 PR 中的 md-header 容器`);
    assert.match(js, /mountPoint\.container\.insertBefore\(btn,\s*mountPoint\.beforeEl\)/, `${browser} content.js 应将润色按钮挂载在工具栏左起`);
    assert.match(js, /markdown-toolbar \.ghcn-collab-btn/, `${browser} content.js 应针对 PR markdown-toolbar 提供样式对齐`);
    assert.match(js, /top:\s*-3\.5px;/, `${browser} content.js 应微调 PR 按钮上下居中对齐`);
    assert.match(js, /COLLAB_ICONS\.sparkle/, `${browser} content.js 润色按钮应使用 SVG 图标而非 emoji`);
    assert.doesNotMatch(js, /class="ghcn-collab-btn-icon"[^>]*>🪄/, `${browser} content.js 润色按钮不应使用 🪄 emoji`);
    assert.match(js, /\.ghcn-collab-btn[\s\S]*?var\(--button-default-bgColor-rest/, `${browser} content.js 润色按钮背景色应规范化为 GitHub 原生设计变量`);
    assert.doesNotMatch(js, /\[data-dark-theme="dark"\]\s*\.ghcn-collab-btn/, `${browser} content.js 不应使用会误伤浅色模式的 data-dark-theme 选择器`);
    assert.match(js, /\.ghcn-collab-btn:hover[\s\S]*?color:\s*var\(--button-default-fgColor-rest/, `${browser} content.js 悬浮时文本颜色应保持为原生文本变量，防止变成白色`);
    assert.match(js, /function mountCollaborationToolbar\(/, `${browser} content.js 应包含 mountCollaborationToolbar`);
    assert.match(js, /function openCollaborationModal\(/, `${browser} content.js 应包含 openCollaborationModal`);
    assert.match(js, /function applyPolishedTextToTextarea\(/, `${browser} content.js 应包含 applyPolishedTextToTextarea`);
    assert.match(js, /document\.execCommand\('insertText', false, text\)/, `${browser} content.js 应使用 execCommand 保留撤回历史`);
  });
});

test('collaboration helper prompts define 4 specialized open source modes', () => {
  assert.match(content, /const COLLAB_MODES = \[/);
  assert.match(content, /id:\s*'bug'/);
  assert.match(content, /id:\s*'feature'/);
  assert.match(content, /id:\s*'reply'/);
  assert.match(content, /id:\s*'general'/);
  assert.match(content, /### Steps to Reproduce/);
  assert.match(content, /### Problem Statement \/ Motivation/);
  assert.match(content, /sourceType:\s*'collab'/);
  assert.match(content, /detail:\s*`collab_mode=\$\{mode\}`/);
});

test('collaboration helper supports new issue forms and pull request creation workflows', () => {
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /textarea\[name\^="issue\["\]/, `${browser} content.js 应匹配 Issue Form 模板的 issue[...] 输入框`);
    assert.match(js, /textarea\[name\^="pull_request\["\]/, `${browser} content.js 应匹配 PR 模板的 pull_request[...] 输入框`);
    assert.match(js, /form\.new_issue textarea/, `${browser} content.js 应匹配新建 Issue 表单内的 textarea`);
    assert.match(js, /form\.new_pull_request textarea/, `${browser} content.js 应匹配新建 PR 表单内的 textarea`);
    assert.match(js, /markdown-toolbar\[for\]/, `${browser} content.js 应支持通过 markdown-toolbar[for] 反查关联输入框`);
    assert.match(js, /function ensureCollaborationGlobalListeners\(/, `${browser} content.js 应包含全局事件监听确保动态展开时挂载`);
    assert.match(js, /turbo:frame-load/, `${browser} content.js 应监听 turbo:frame-load 事件`);
    assert.match(js, /textarea:focusin/, `${browser} content.js 应在输入框获得焦点时唤醒润色挂载`);
  });
});

test('tldr capsule setting is exposed across options and content script', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.match(js, /enable_repo_tldr:\s*false/, `${browser} options.js 应包含 enable_repo_tldr 默认设置`);
    assert.match(html, /id="enable_repo_tldr"/, `${browser} options.html 应包含 enable_repo_tldr 元素`);
    assert.match(html, /启用仓库首页 AI 速读胶囊/, `${browser} options.html 应包含速读胶囊开关文案`);
    assert.match(js, /savePartialValues\(\{\s*enable_repo_tldr:/, `${browser} options.js 应在开关切换时持久化保存`);
  });
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /enable_repo_tldr:\s*false/, `${browser} content.js 应包含 enable_repo_tldr 默认设置`);
    assert.match(js, /function isTldrCapsuleEnabled\(/, `${browser} content.js 应包含 isTldrCapsuleEnabled`);
    assert.match(js, /function scheduleTldrCapsuleControls\(/, `${browser} content.js 应包含 scheduleTldrCapsuleControls`);
    assert.match(js, /function mountTldrCapsule\(/, `${browser} content.js 应包含 mountTldrCapsule`);
    assert.match(js, /function executeTldrGeneration\(/, `${browser} content.js 应包含 executeTldrGeneration`);
    assert.match(js, /TLDR_SYSTEM_PROMPT/, `${browser} content.js 应包含速读胶囊 Prompt`);
    assert.match(js, /🎯 核心定位/, `${browser} content.js Prompt 应包含核心定位要素`);
    assert.doesNotMatch(js, /⚡ 3秒极简启动/, `${browser} content.js Prompt 应去除 3 秒极简启动要素以精炼内容`);
    assert.match(js, /💡 选型考量/, `${browser} content.js Prompt 应包含选型考量要素`);
    assert.match(js, /sourceType:\s*'tldr'/, `${browser} content.js 应上报 tldr 记录来源`);
  });
});

test('builtin_ai provider is completely removed to keep options clean and maintain performance', () => {
  browserOptions.forEach(({ browser, html, js }) => {
    assert.doesNotMatch(html, /<option value="builtin_ai">/, `${browser} options.html 不应包含 builtin_ai 选项`);
    assert.doesNotMatch(html, /data-provider="builtin_ai"/, `${browser} options.html 不应包含 builtin_ai 配置面板`);
    assert.doesNotMatch(html, /id="builtin_ai_status_badge"/, `${browser} options.html 不应包含端侧状态标签`);
    assert.doesNotMatch(html, /id="btn_probe_builtin_ai"/, `${browser} options.html 不应包含探测端侧状态按钮`);
    assert.doesNotMatch(js, /case 'builtin_ai':/, `${browser} options.js 不应包含 builtin_ai case`);
    assert.doesNotMatch(js, /async function probeBuiltinAiStatus\(/, `${browser} options.js 不应包含 probeBuiltinAiStatus`);
    assert.doesNotMatch(js, /async function updateBuiltinAiStatusUi\(/, `${browser} options.js 不应包含 updateBuiltinAiStatusUi`);
  });
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /function normalizeTranslationText\(/, `${browser} content.js 应在顶层工具函数定义 normalizeTranslationText`);
    assert.match(js, /const userPrompt = `项目：\$\{repoInfo\.fullName\}/, `${browser} content.js executeTldrGeneration 应定义 userPrompt 变量`);
    assert.doesNotMatch(js, /case 'builtin_ai':/, `${browser} content.js 不应包含 builtin_ai case`);
    assert.doesNotMatch(js, /async function probeBuiltinAiStatus\(/, `${browser} content.js 不应包含 probeBuiltinAiStatus`);
    assert.doesNotMatch(js, /async function translateWithBuiltinAi\(/, `${browser} content.js 不应包含 translateWithBuiltinAi`);
  });
});

test('tldr capsule matches github native styling and handles command snippets and colon line wrapping', () => {
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /card\.className\s*=\s*'ghcn-tldr-card'/, `${browser} content.js 应使用 ghcn-tldr-card 类`);
    assert.match(js, /margin:\s*0 !important;/, `${browser} content.js 样式应贴紧上边和左右`);
    assert.match(js, /border-radius:\s*0 !important;/, `${browser} content.js 样式应无圆角以贴紧容器`);
    assert.match(js, /octicon-sparkle/, `${browser} content.js 应使用原生 Octicon Sparkle 图标`);
    assert.match(js, /\.ghcn-tldr-body[\s\S]*?background-color:\s*#f6faf7/, `${browser} content.js 速读卡片内容区应使用淡雅背景色以增强可读性`);
    assert.match(js, /ghcn-tldr-cmd-box/, `${browser} content.js 应包含终端命令展示框`);
    assert.match(js, /function extractCommandInfo\(/, `${browser} content.js 应包含命令行智能提取`);
    assert.doesNotMatch(js, /border-left:\s*4px solid/, `${browser} content.js 不应包含非原生的 4px 粗边框`);
  });
});

test('copilot repository prompts and tldr caching persistence are implemented', () => {
  assert.match(locals, /"Give me a high-level overview":\s*"为我提供全局概览"/);
  assert.match(locals, /"How can I contribute\?":\s*"我该如何参与贡献？"/);
  assert.match(locals, /"Summarize latest changes":\s*"总结最新变更"/);

  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /tldrContent:\s*sanitizeCachedPayloadText\(item\.tldrContent\)/, `${browser} content.js 应在缓存规范化中净化并保留 tldrContent`);
    assert.match(js, /hasTldr\s*=\s*typeof value\?\.tldrContent === 'string'/, `${browser} content.js upsert 应支持 tldrContent`);
    assert.match(js, /function getTldrSourceHash\(/, `${browser} content.js 应包含 getTldrSourceHash`);
    assert.match(js, /return\s*\{\s*parent:\s*readmeRoot\.parentElement,\s*before:\s*readmeRoot\s*\};/, `${browser} content.js 应在 README 容器内部顶部挂载胶囊`);
  });
});

test('feature switch sections are ordered with basic translation first', () => {
  browserOptions.forEach(({ browser, html }) => {
    const basicIdx = html.indexOf('<h2>页面基础汉化</h2>');
    const aiIdx = html.indexOf('<h2>AI 智能增强</h2>');
    const perfIdx = html.indexOf('<h2>性能与高级设置</h2>');
    assert.ok(basicIdx !== -1, `${browser} options.html 应包含 页面基础汉化`);
    assert.ok(aiIdx !== -1, `${browser} options.html 应包含 AI 智能增强`);
    assert.ok(perfIdx !== -1, `${browser} options.html 应包含 性能与高级设置`);
    assert.ok(basicIdx < aiIdx, `${browser} options.html 基础汉化应排在 AI 智能增强前面`);
    assert.ok(aiIdx < perfIdx, `${browser} options.html AI 智能增强应排在 性能与高级设置前面`);
  });
});

test('tldr trigger button is mounted to the left of the Copilot icon in README header', () => {
  browserContent.forEach(({ browser, js }) => {
    assert.match(js, /function findReadmeHeaderActions\(/, `${browser} content.js 应包含 findReadmeHeaderActions 函数`);
    assert.match(js, /svg\.octicon-copilot/, `${browser} content.js 应定位 Copilot 图标按钮`);
    assert.match(js, /function mountTldrHeaderButton\(/, `${browser} content.js 应包含 mountTldrHeaderButton 函数`);
    assert.match(js, /data-ghcn-tldr="header-btn"/, `${browser} content.js 应生成 header-btn 标记`);
    assert.match(js, /Button--primary Button--small/, `${browser} content.js 速读按钮应使用 GitHub 主按钮语义`);
    assert.match(js, /headerActions\.container\.insertBefore\(btn,\s*headerActions\.beforeEl\)/, `${browser} content.js 应将按钮插入在 Copilot 图标左侧`);
    assert.match(js, /ghcn-tldr-header-btn/, `${browser} content.js 应包含头部按钮样式类`);
    assert.match(js, /ghcn-tldr-header-text.*AI 速读/, `${browser} content.js 头部速读按钮应包含醒目的 AI 速读文字`);
    assert.match(js, /\.ghcn-tldr-header-btn[\s\S]*?var\(--button-primary-bgColor-rest/, `${browser} content.js 头部速读按钮应使用 GitHub 原生绿色背景色`);
    assert.match(js, /\.ghcn-tldr-header-icon svg[\s\S]*?fill:\s*currentColor/, `${browser} content.js 头部速读图标应跟随按钮前景色`);
    assert.match(js, /existingCard\.style\.display\s*=\s*'none'/, `${browser} content.js 默认不展示速读卡片，点击才展开`);
    assert.match(js, /AI 项目速读 \(TL;DR\)/, `${browser} content.js 应包含速读 Tooltip`);
  });
});

test('selected optimizations: discussions support, tldr threshold, traverseNode break, turbo guards, and batched storage', () => {
  browserContent.forEach(({ browser, js }) => {
    // 1. Discussions 讨论区支持
    assert.match(js, /\(issues\|pull\|discussions\)/, `${browser} content.js 应在讨论判定中支持 discussions`);
    assert.match(js, /if\s*\(match\?\.\[1\]\s*===\s*'discussions'\)\s*return\s*'discussion'/, `${browser} content.js 应在源类型中支持 discussion`);

    // 2. 极短/空白 README 速读防浪费
    assert.match(js, /introText\.trim\(\)\.length\s*<\s*80/, `${browser} content.js 应在不足 80 字符时拦截速读胶囊`);

    // 3. traverseNode case 'BUTTON' 穿透修复
    assert.match(js, /case 'BUTTON':[\s\S]*?transElement\(node\.dataset,\s*'disableWith'\);[\s\S]*?break;\s*case 'A':/, `${browser} content.js case BUTTON 应有 break 防止重复检查`);

    // 4. README 软导航防重入
    assert.match(js, /expectedHref\s*=\s*window\.location\.href;/, `${browser} content.js 应记录 expectedHref 防范软导航`);
    assert.match(js, /!readmeEl\.isConnected\s*\|\|\s*window\.location\.href\s*!==\s*expectedHref/, `${browser} content.js 应在批次写回前校验 DOM 连接与 URL`);

    // 5. 设置变更防抖防闪烁
    assert.match(js, /applyBatchedFeatureToggles/, `${browser} content.js 应包含 applyBatchedFeatureToggles 批处理防抖`);
    assert.match(js, /pendingChangedKeys/, `${browser} content.js 应收集待处理的设置变更`);
    assert.match(js, /getRepoCachedTranslation\(repoCacheKey\)/, `${browser} README 应允许读取部分翻译缓存`);
    assert.match(js, /partialCacheApplied/, `${browser} README 命中部分缓存后应保留已翻译节点`);
    assert.match(js, /if \(!partialCacheApplied && readmeEl\.innerHTML !== state\.originalHtml\)/, `${browser} README 命中部分缓存后不应恢复原文覆盖译文`);
    assert.match(js, /complete:\s*!stillMissed/, `${browser} README 应按剩余节点保存完整/部分缓存状态`);
    assert.match(js, /partial_cache_hit/, `${browser} README 应记录部分缓存命中`);
    assert.match(js, /if \(isLikelyTechnicalReadmeText\(task\.normalizedText, task\.node\)\) return false;/, `${browser} 剩余节点判断应先排除命令和技术内容`);
    assert.match(js, /entry\.tldrContent && entry\.complete === true/, `${browser} TL;DR 兜底缓存必须要求完整结果`);
  });
});

test('tldr capsule action buttons are unified with icon-only refresh and close buttons', () => {
  browserContent.forEach(({ browser, js }) => {
    assert.doesNotMatch(js, /data-ghcn-tldr-action="toggle"/, `${browser} content.js 已移除多余的展开收起按钮`);
    assert.match(js, /data-ghcn-tldr-action="refresh"[\s\S]*?TLDR_ICONS\.sync/, `${browser} content.js 刷新按钮应使用原生同步图标`);
    assert.doesNotMatch(js, /data-ghcn-tldr-action="refresh"[\s\S]*?ghcn-tldr-tool-text/, `${browser} content.js 刷新按钮应为纯图标按钮`);
    assert.match(js, /data-ghcn-tldr-action="close"[\s\S]*?TLDR_ICONS\.close/, `${browser} content.js 关闭按钮应使用原生关闭图标`);
    assert.match(js, /\.ghcn-tldr-tool-btn[\s\S]*?width:\s*28px !important;[\s\S]*?height:\s*28px !important;/, `${browser} content.js 操作按钮应采用 28x28 方形标准图标按钮样式`);
  });
});

function readSrc(rel) {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
}

function makeMiniEl(tagName = 'div', attrs = {}) {
  const el = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes: new Map(Object.entries(attrs)),
    dataset: {},
    classList: (() => {
      const set = new Set();
      return {
        add: (...c) => c.forEach((x) => set.add(x)),
        remove: (...c) => c.forEach((x) => set.delete(x)),
        toggle: (x, f) => (f === undefined ? (set.has(x) ? set.delete(x) : set.add(x)) : (f ? set.add(x) : set.delete(x))),
        contains: (x) => set.has(x),
      };
    })(),
    style: {},
    children: [],
    childNodes: [],
    listeners: {},
    isConnected: true,
    innerHTML: '',
    textContent: '',
    disabled: Boolean(attrs.disabled),
    readOnly: Boolean(attrs.readOnly),
    parentElement: null,
    get firstChild() { return this.children[0] || null; },
    get firstElementChild() { return this.children[0] || null; },
    get nextElementSibling() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) + 1] || null;
    },
    get previousElementSibling() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) - 1] || null;
    },
    getAttribute(n) { return this.attributes.get(n) ?? null; },
    setAttribute(n, v) { this.attributes.set(n, String(v)); },
    hasAttribute(n) { return this.attributes.has(n); },
    removeAttribute(n) { this.attributes.delete(n); },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    dispatch(t, ev = {}) { (this.listeners[t] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, ...ev })); },
    append(...nodes) { this.appendChild(...nodes); },
    appendChild(...nodes) {
      for (const n of nodes) {
        if (!n) continue;
        if (typeof n === 'object') n.parentElement = this;
        this.children.push(n);
        this.childNodes.push(n);
      }
      return nodes[0];
    },
    insertBefore(node, ref) {
      if (!node) return node;
      node.parentElement = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, node);
      else this.children.push(node);
      return node;
    },
    prepend(node) { return this.insertBefore(node, this.children[0] || null); },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
        this.parentElement.childNodes = this.parentElement.childNodes.filter((c) => c !== this);
      }
      this.isConnected = false;
    },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return el;
}

test('TL;DR escapes errors, mounts above native Chinese controls, refreshes reused button handlers, and guards genSeq races', async () => {
  const readmeRoot = makeMiniEl('article');
  readmeRoot.textContent = 'This project provides a complete toolkit with over eighty characters of clear English introduction.';
  readmeRoot.cloneNode = () => ({ textContent: readmeRoot.textContent, querySelectorAll: () => [] });
  const controls = makeMiniEl('div');
  const readmeWrapper = makeMiniEl('div');
  readmeWrapper.appendChild(controls);
  readmeWrapper.appendChild(readmeRoot);

  const headerBtnContainer = makeMiniEl('div');
  const copilotBtn = makeMiniEl('button');
  headerBtnContainer.appendChild(copilotBtn);
  const existingHeaderBtn = makeMiniEl('button');
  existingHeaderBtn.dataset.ghcnTldr = 'header-btn';
  headerBtnContainer.insertBefore(existingHeaderBtn, copilotBtn);

  const card = makeMiniEl('section');
  const ctx = {
    console, URL, Math, Date,
    performance: { now: () => 10 },
    isPageExcluded: () => false,
    getStableReadmeTextHash: (s) => `h:${String(s || '').length}`,
    normalizeText: (s) => String(s || '').replace(/\s+/g, ' ').trim(),
    normalizeRuntimeErrorMessage: (err) => String(err?.message || err || ''),
    window: { location: { href: 'https://github.com/o/r', pathname: '/o/r' }, setTimeout, clearTimeout },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    chineseReadme: { state: { root: readmeRoot, controls } },
    getProviderConfig: () => ({ ok: true, provider: 'deepseek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions', key: 'k' }),
    applyOpenAiCompatibleRequestOptions: () => {},
    proxyFetchJson: async () => {
      runInContext('tldrRuntime.genSeq++;', ctx);
      return { choices: [{ message: { content: '- **🎯 核心定位**：不应写入陈旧 DOM' } }] };
    },
    getRepoCachedTranslation: async () => null,
    upsertRepoCachedTranslation: async () => { throw new Error('stale run must not write cache'); },
    appendReadmeTranslationRecord: async () => { throw new Error('stale run must not record'); },
    isReadmePage: () => true,
    findReadmeHeaderActions: () => ({ container: headerBtnContainer, beforeEl: copilotBtn }),
    document: {
      querySelector: (sel) => (sel === '[data-ghcn-tldr="header-btn"]' ? existingHeaderBtn : null),
      querySelectorAll: () => [],
      createElement: (tag) => makeMiniEl(tag),
      getElementById: () => null,
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('core/utils.js')}\n${readSrc('providers/provider-config.js')}\n${readSrc('providers/cloud-translators.js')}\n${readSrc('features/tldr-capsule.js')}`, ctx);
  runInContext('FeatureSet.enable_extension = true; FeatureSet.enable_repo_tldr = true; FeatureSet.readme_enable_repo_cache = false;', ctx);
  ctx.getProviderConfig = () => ({ ok: true, provider: 'deepseek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions', key: 'k' });
  ctx.chineseReadme = { state: { root: readmeRoot, controls } };
  let fetchCalled = false;
  ctx.proxyFetchJson = async () => {
    fetchCalled = true;
    runInContext('tldrRuntime.genSeq++;', ctx);
    return { choices: [{ message: { content: '- **🎯 核心定位**：陈旧响应' } }] };
  };
  ctx.findReadmeHeaderActions = () => ({ container: headerBtnContainer, beforeEl: copilotBtn });
  ctx.upsertRepoCachedTranslation = async () => { throw new Error('stale run must not write cache'); };

  const errCard = makeMiniEl('section');
  ctx.renderTldrError(errCard, '<img src=x onerror=alert(1)> & bad', { fullName: 'o/r' }, readmeRoot, 'h1');
  assert.doesNotMatch(errCard.innerHTML, /<img\s+src=x/i, 'renderTldrError 必须转义错误消息中的 HTML 标签');
  assert.match(errCard.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const mp = ctx.findTldrMountPoint(readmeRoot);
  assert.strictEqual(mp.before, controls, '挂载中文 README 时 TL;DR 应位于提示控制条之上');

  const firstCalls = [];
  const secondCalls = [];
  const reusedBtn = ctx.mountTldrHeaderButton(readmeRoot, { fullName: 'o/r' }, () => firstCalls.push(1));
  assert.strictEqual(reusedBtn, existingHeaderBtn);
  existingHeaderBtn.addEventListener('click', (e) => { existingHeaderBtn.__ghcnTldrOnToggle?.(existingHeaderBtn, e); });
  ctx.mountTldrHeaderButton(readmeRoot, { fullName: 'o/r' }, () => secondCalls.push(2));
  existingHeaderBtn.dispatch('click');
  assert.deepStrictEqual(firstCalls, []);
  assert.deepStrictEqual(secondCalls, [2], '复用头部按钮后点击应调用最新页面的闭包回调');

  let contentRendered = false;
  let errorRendered = false;
  ctx.renderTldrContent = () => { contentRendered = true; };
  ctx.renderTldrError = () => { errorRendered = true; };
  await ctx.executeTldrGeneration(card, { fullName: 'o/r' }, readmeRoot, 'a'.repeat(100));
  assert.strictEqual(fetchCalled, true, 'executeTldrGeneration 应发起请求后检测 genSeq 失效');
  assert.strictEqual(contentRendered, false, 'genSeq 过期后不得渲染陈旧响应');
  assert.strictEqual(errorRendered, false, 'genSeq 过期后不得写入陈旧错误');
});

test('Discussion translation skips preview forms, cleans orphans on restore, and rolls back on fatal error', async () => {
  const previewBody = makeMiniEl('div');
  previewBody.closest = (sel) => (sel.includes('.js-preview-body') ? previewBody : null);
  const validMd = makeMiniEl('div');
  validMd.textContent = 'Please check the failing integration test.';
  validMd.cloneNode = () => {
    const clone = makeMiniEl('div');
    clone.textContent = validMd.textContent;
    clone.querySelectorAll = () => [];
    return clone;
  };
  validMd.insertAdjacentElement = (pos, node) => {
    if (pos === 'afterend' && validMd.parentElement) validMd.parentElement.appendChild(node);
  };
  const commentRoot = makeMiniEl('div');
  const toolbar = makeMiniEl('div');
  toolbar.dataset.ghcnDiscussionTranslate = 'toolbar';
  commentRoot.appendChild(toolbar);
  commentRoot.appendChild(validMd);
  validMd.closest = (sel) => (sel.includes('.ghcn-discussion-translation-panel') || sel.includes('.js-preview-body') ? null : commentRoot);

  const orphanPanel = makeMiniEl('div');
  const hiddenBody = makeMiniEl('div', { 'data-ghcn-discussion-hidden': 'true' });
  const ctx = {
    console, URL, performance: { now: () => 5 },
    isPageExcluded: () => false,
    window: { location: { href: 'https://github.com/o/r/issues/1', pathname: '/o/r/issues/1' }, setTimeout, clearTimeout },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    NodeFilter: { SHOW_TEXT: 4 },
    document: {
      querySelectorAll: (sel) => {
        if (sel.includes('[data-testid="markdown-body"]')) return [previewBody, validMd];
        if (sel === '[data-ghcn-discussion-translate="toolbar"]') return [toolbar];
        if (sel === '.ghcn-discussion-translation-panel') return [orphanPanel];
        if (sel === '[data-ghcn-discussion-hidden]') return [hiddenBody];
        return [];
      },
      createTreeWalker: (el) => {
        const nodes = [{ data: el.textContent || '', parentElement: el }];
        return { nextNode: () => nodes.shift() || null };
      },
      createElement: (tag) => makeMiniEl(tag),
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('core/utils.js')}\n${readSrc('core/storage-cache.js')}\n${readSrc('core/text-filter.js')}\n${readSrc('features/markdown-translation.js')}\n${readSrc('features/discussion-translation.js')}`, ctx);
  runInContext('FeatureSet.enable_extension = true; FeatureSet.enable_issue_pr_translation = true; FeatureSet.readme_enable_progressive = false;', ctx);
  ctx.getProviderConfig = () => ({ ok: true, provider: 'deepseek', targetLang: 'zh-CN', signature: 'sig' });
  ctx.getCurrentRepoInfo = () => ({ fullName: 'o/r' });
  ctx.getRepoCachedTranslation = async () => null;
  ctx.translateTextsWithProvider = async () => { throw new Error('network boom'); };

  const items = ctx.findDiscussionItems();
  assert.strictEqual(items.length, 1, 'findDiscussionItems 应忽略预览框中的 markdown');
  assert.strictEqual(items[0].markdownEl, validMd);

  await assert.rejects(() => ctx.translateIssuePrBody(items[0]), /network boom/);
  assert.strictEqual(validMd.hasAttribute('data-ghcn-discussion-hidden'), false, '翻译异常回滚后必须恢复显示原文并保留重试入口');

  ctx.restoreIssuePrTranslations();
  assert.strictEqual(orphanPanel.isConnected, false, 'restoreIssuePrTranslations 应清理残留译文面板');
  assert.strictEqual(hiddenBody.hasAttribute('data-ghcn-discussion-hidden'), false, 'restoreIssuePrTranslations 应解除残留隐藏属性');
});

test('Collaboration helper skips disabled/readOnly textareas, updates reused target bindings, and runs modalCleanup', () => {
  const disabledArea = makeMiniEl('textarea', { disabled: true });
  const readonlyArea = makeMiniEl('textarea', { readOnly: true });
  const editableArea = makeMiniEl('textarea');
  const fallbackBar = makeMiniEl('div');
  fallbackBar.className = 'ghcn-collab-fallback-bar';

  const ctx = {
    console, URL,
    isPageExcluded: () => false,
    window: { location: { href: 'https://github.com/o/r/issues/new', pathname: '/o/r/issues/new', hostname: 'github.com' }, setTimeout, clearTimeout },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    document: {
      querySelectorAll: (sel) => (sel === '.ghcn-collab-fallback-bar' ? [fallbackBar] : []),
      addEventListener() {},
      createElement: (tag) => makeMiniEl(tag),
      getElementById: () => null,
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('features/collaboration-helper.js')}`, ctx);
  assert.strictEqual(ctx.isValidCollaborationTextarea(disabledArea), false, '应跳过 disabled 文本框');
  assert.strictEqual(ctx.isValidCollaborationTextarea(readonlyArea), false, '应跳过 readOnly 文本框');
  assert.strictEqual(ctx.isValidCollaborationTextarea(editableArea), true);
  assert.strictEqual(ctx.applyPolishedTextToTextarea(readonlyArea, 'hi'), false);

  const btn = ctx.createCollaborationButton(editableArea);
  assert.strictEqual(btn.__ghcnTargetTextarea, editableArea);

  runInContext('collabRuntime.modalCleanup = () => { globalThis.__cleaned = true; };', ctx);
  ctx.restoreCollaborationHelperControls();
  assert.strictEqual(fallbackBar.isConnected, false, '关闭润色助手时应移除 fallback bar');
  assert.strictEqual(ctx.__cleaned, true, 'restoreCollaborationHelperControls 应触发 modalCleanup 清理监听器');
});

test('GlobalNav skips identity labels, notranslate subtrees, and avoids re-entrant loops', () => {
  const ctx = {
    console,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    CONFIG: { LANG: 'zh-CN' },
    I18N: { conf: { reactGlobalNavLabels: { Issues: 'Issues', Repositories: '仓库' }, reactGlobalNavRegexpRules: [] }, 'zh-CN': { public: { regexp: [] } } },
    GhcnMaintenance: { lookup: () => undefined },
    maintenanceData: { entries: [] },
    document: {
      createTreeWalker: () => ({ nextNode: () => null }),
      querySelectorAll: () => [],
      body: null,
    },
    window: { location: { hostname: 'github.com', pathname: '/' } },
  };
  createContext(ctx);
  const uiSrc = readSrc('features/ui-localization.js');
  const extractNav = (name) => {
    const start = uiSrc.indexOf(`function ${name}(`);
    let depth = 0;
    for (let i = uiSrc.indexOf('{', start); i < uiSrc.length; i++) {
      if (uiSrc[i] === '{') depth++;
      else if (uiSrc[i] === '}' && --depth === 0) return uiSrc.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const preamble = `
    const labels = I18N.conf.reactGlobalNavLabels || {};
    const unsafeTextSelector = 'textarea, [contenteditable=""], .notranslate';
    const navLabelCache = new Map();
    let cachedNavPageType = '';
    let globalNavStaticIndex = null;
    ${extractNav('getGlobalNavStaticIndex')}
    ${extractNav('findStaticGlobalNavLabel')}
    ${extractNav('findRegexpGlobalNavLabel')}
    ${extractNav('isCustomGlobalNavEntry')}
    ${extractNav('hasCustomGlobalNavWrite')}
    ${extractNav('rememberCustomGlobalNavWrite')}
    ${extractNav('resolveReactGlobalNavLabel')}
    ${extractNav('normalizeReactGlobalNavText')}
    ${extractNav('shouldSkipReactGlobalNavNode')}
    ${extractNav('translateReactGlobalNavTextNode')}
  `;
  runInContext(preamble, ctx);
  assert.strictEqual(ctx.resolveReactGlobalNavLabel('Issues'), null, '译文与原文相同时应返回 null 防止自我触发');
  assert.strictEqual(ctx.resolveReactGlobalNavLabel('Repositories'), '仓库');

  const identityNode = { data: 'Issues' };
  let writes = 0;
  const wrapped = {
    get data() { return identityNode.data; },
    set data(v) { writes++; identityNode.data = v; },
  };
  ctx.translateReactGlobalNavTextNode(wrapped);
  assert.strictEqual(writes, 0, '译文与原文相同时不得重复写入 DOM text node');

  const notranslateEl = { closest: (sel) => sel.includes('.notranslate') };
  const editableEl = { closest: (sel) => sel.includes('[contenteditable=""]') };
  assert.strictEqual(ctx.shouldSkipReactGlobalNavNode({ nodeType: 3, parentElement: notranslateEl }), true, '应跳过 .notranslate 节点');
  assert.strictEqual(ctx.shouldSkipReactGlobalNavNode({ nodeType: 3, parentElement: editableEl }), true, '应跳过 [contenteditable=""] 节点');
});

test('TL;DR navigation resets busy state, removes stale cards, and isolates monorepo subdirectories', async () => {
  const readmeRoot = makeMiniEl('article');
  readmeRoot.textContent = 'Monorepo subpackage README with enough English words to exceed eighty characters threshold easily.';
  readmeRoot.cloneNode = () => ({ textContent: readmeRoot.textContent, querySelectorAll: () => [] });
  const staleCard = makeMiniEl('section');
  staleCard.dataset.ghcnTldr = 'capsule';
  staleCard.dataset.sourceHash = 'old-hash';
  staleCard.dataset.pathname = '/o/r';
  staleCard.style.display = 'none';

  const headerContainer = makeMiniEl('div');
  const copilotBtn = makeMiniEl('button');
  headerContainer.appendChild(copilotBtn);
  const domElements = [staleCard];

  let genCalled = 0;
  let loc = { href: 'https://github.com/o/r', pathname: '/o/r' };
  const ctx = {
    console, URL, Math, Date,
    performance: { now: () => 10 },
    isPageExcluded: () => false,
    getStableReadmeTextHash: () => 'sub-hash',
    normalizeText: (s) => String(s || '').replace(/\s+/g, ' ').trim(),
    normalizeRuntimeErrorMessage: (err) => String(err?.message || err || ''),
    window: { location: loc, setTimeout, clearTimeout },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    isReadmePage: () => true,
    findReadmeHeaderActions: () => ({ container: headerContainer, beforeEl: copilotBtn }),
    getProviderConfig: () => ({ ok: true, provider: 'deepseek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions', key: 'k' }),
    applyOpenAiCompatibleRequestOptions: () => {},
    document: {
      querySelector: (sel) => {
        if (sel === '[data-ghcn-tldr="capsule"]') return domElements.find((e) => e.dataset?.ghcnTldr === 'capsule' && e.isConnected) || null;
        if (sel === '[data-ghcn-tldr="header-btn"]') return domElements.find((e) => e.dataset?.ghcnTldr === 'header-btn' && e.isConnected) || null;
        return null;
      },
      querySelectorAll: (sel) => (sel === '[data-ghcn-tldr="capsule"]' ? domElements.filter((e) => e.dataset?.ghcnTldr === 'capsule' && e.isConnected) : []),
      createElement: (tag) => makeMiniEl(tag),
      getElementById: () => null,
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('core/utils.js')}\n${readSrc('providers/provider-config.js')}\n${readSrc('providers/cloud-translators.js')}\n${readSrc('features/tldr-capsule.js')}`, ctx);
  runInContext(`
    FeatureSet.enable_extension = true;
    FeatureSet.enable_repo_tldr = true;
    FeatureSet.readme_enable_repo_cache = true;
    readmeRuntime.repoCacheLoaded = true;
    readmeRuntime.repoCacheMap.set('o/r|tldr|old-root-hash', {
      key: 'o/r|tldr|old-root-hash',
      repo: 'o/r',
      pathname: '',
      tldrContent: '- 🎯 核心定位：根仓库旧缓存，不应污染子包',
      complete: true,
    });
    tldrRuntime.activeDocUrl = 'https://github.com/o/r';
    tldrRuntime.isBusy = true;
    tldrRuntime.busyDocUrl = 'https://github.com/o/r';
  `, ctx);
  // mountTldrCapsule 内部捕获 isReadmePage 等引用；覆盖 window.location 进入子包路径
  loc.href = 'https://github.com/o/r/tree/main/packages/a';
  loc.pathname = '/o/r/tree/main/packages/a';
  ctx.ensureRepoCacheLoaded = async () => {};
  ctx.getRepoCachedTranslation = async () => null;
  ctx.upsertRepoCachedTranslation = async () => {};
  ctx.appendReadmeTranslationRecord = async () => {};
  ctx.findReadmeHeaderActions = () => ({ container: headerContainer, beforeEl: copilotBtn });
  ctx.findTldrMountPoint = () => ({ parent: makeMiniEl('div'), before: readmeRoot });
  ctx.executeTldrGeneration = async () => { genCalled += 1; };

  await ctx.mountTldrCapsule(readmeRoot, { fullName: 'o/r' });
  assert.strictEqual(staleCard.isConnected, false, '跨页面挂载时应移除旧页面残留的 TL;DR 卡片');
  assert.strictEqual(runInContext('tldrRuntime.isBusy', ctx), false, '软导航切换页面应重置遗留的 isBusy 锁');

  const headerBtn = headerContainer.children.find((el) => el.dataset?.ghcnTldr === 'header-btn');
  assert.ok(headerBtn, '应挂载头部 AI 速读按钮');
  assert.strictEqual(headerBtn.hasAttribute('data-has-cache'), false, 'Monorepo 子包不得误命中根仓库历史 TL;DR 缓存');
  await headerBtn.__ghcnTldrOnToggle(headerBtn);
  assert.strictEqual(genCalled, 1, '子包无缓存点击后应触发全新 TL;DR 生成（未被旧根缓存误开）');
});

test('Discussion translation isolates toggled epochs, invalidates inline edits, and strips clone root id', async () => {
  const commentEl = makeMiniEl('div', { id: 'comment-body-1' });
  commentEl.textContent = 'Please investigate this flaky test.';
  commentEl.innerHTML = '<p>Please investigate this flaky test.</p>';
  commentEl.cloneNode = () => {
    const clone = makeMiniEl('div', { id: 'comment-body-1' });
    clone.textContent = commentEl.textContent;
    clone.innerHTML = commentEl.innerHTML;
    clone.querySelectorAll = () => [];
    return clone;
  };
  commentEl.insertAdjacentElement = (pos, node) => {
    if (pos === 'afterend' && commentEl.parentElement) commentEl.parentElement.appendChild(node);
  };
  const wrapper = makeMiniEl('div');
  const slot = makeMiniEl('div');
  wrapper.appendChild(slot);
  wrapper.appendChild(commentEl);
  commentEl.closest = (sel) => (
    sel.includes('.ghcn-discussion-translation-panel') || sel.includes('.js-preview-body')
      ? null
      : wrapper
  );

  let resolveTx;
  const ctx = {
    console, URL, performance: { now: () => 5 },
    isPageExcluded: () => false,
    window: { location: { href: 'https://github.com/o/r/issues/1', pathname: '/o/r/issues/1' }, setTimeout, clearTimeout },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    NodeFilter: { SHOW_TEXT: 4 },
    document: {
      querySelectorAll: (sel) => {
        if (sel.includes('[data-ghcn-discussion-translate="toolbar"]')) return slot.children.filter((c) => c.dataset?.ghcnDiscussionTranslate === 'toolbar');
        if (sel === '.ghcn-discussion-translation-panel') return wrapper.children.filter((c) => c.classList?.contains('ghcn-discussion-translation-panel'));
        if (sel === '[data-ghcn-discussion-hidden]') return commentEl.hasAttribute('data-ghcn-discussion-hidden') ? [commentEl] : [];
        if (sel.includes('[data-testid="markdown-body"]')) return [commentEl];
        return [];
      },
      createTreeWalker: (el) => {
        const nodes = [{ nodeType: 3, data: el.textContent || '', parentElement: el, isConnected: true }];
        return { nextNode: () => nodes.shift() || null };
      },
      createElement: (tag) => makeMiniEl(tag),
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('core/utils.js')}\n${readSrc('core/storage-cache.js')}\n${readSrc('core/text-filter.js')}\n${readSrc('features/markdown-translation.js')}\n${readSrc('features/discussion-translation.js')}`, ctx);
  runInContext('FeatureSet.enable_extension = true; FeatureSet.enable_issue_pr_translation = true; FeatureSet.readme_enable_progressive = false;', ctx);
  ctx.getProviderConfig = () => ({ ok: true, provider: 'deepseek', targetLang: 'zh-CN', signature: 'sig' });
  ctx.getCurrentRepoInfo = () => ({ fullName: 'o/r' });
  ctx.getRepoCachedTranslation = async () => null;
  ctx.upsertRepoCachedTranslation = async () => {};
  ctx.appendReadmeTranslationRecord = async () => {};
  ctx.findDiscussionToolbarSlot = () => slot;
  ctx.translateTextsWithProvider = () => new Promise((resolve) => { resolveTx = resolve; });

  const cloneTest = ctx.createTranslatedClone(commentEl);
  assert.strictEqual(cloneTest.hasAttribute('id'), false, 'createTranslatedClone 应移除根节点 id 避免重复 DOM id');

  const item = { markdownEl: commentEl, sourceType: 'issue', viewerEl: wrapper };
  ctx.mountDiscussionToolbar(item);
  const pendingClick = ctx.handleIssuePrTranslateButton(item);
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(ctx.getIssuePrDiscussionState(item).isBusy, true);
  // 请求未完成时关闭再重开功能
  ctx.restoreIssuePrTranslations();
  assert.strictEqual(ctx.getIssuePrDiscussionState(item).isBusy, false, 'restoreIssuePrTranslations 应复位 isBusy');
  resolveTx({ translatedMap: new Map([['Please investigate this flaky test.', '请排查此测试。']]), totalTokens: 10 });
  await pendingClick;
  assert.strictEqual(ctx.getIssuePrDiscussionState(item).translatedEl, null, '旧 epoch 完成后不得写入已被关闭销毁的状态');

  // 译文已挂载时行内编辑评论内容，再次扫描必须失效旧译文面板并恢复“翻译”按钮
  const st = ctx.getIssuePrDiscussionState(item);
  const panel = makeMiniEl('div');
  panel.classList.add('ghcn-discussion-translation-panel');
  wrapper.appendChild(panel);
  st.translatedEl = panel;
  st.translatedHash = ctx.createHash(commentEl.innerHTML);
  const reusedToolbar = makeMiniEl('div');
  reusedToolbar.dataset.ghcnDiscussionTranslate = 'toolbar';
  slot.appendChild(reusedToolbar);
  st.toolbarEl = reusedToolbar;

  commentEl.innerHTML = '<p>Updated comment content after inline edit.</p>';
  ctx.mountDiscussionToolbar(item);
  assert.strictEqual(st.translatedEl, null, '行内编辑正文后再次扫描应使旧译文失效');
  assert.strictEqual(panel.isConnected, false, '旧译文面板应从 DOM 移除');
});

test('Collaboration helper tightens mount guards, keeps modal open on detached textarea, and debounces copy button', async () => {
  const tooltip = makeMiniEl('tool-tip', { 'data-for': 'field-1' });
  const area1 = makeMiniEl('textarea');
  area1.id = 'field-1';
  const area2 = makeMiniEl('textarea');
  area2.id = 'field-2';
  const form = makeMiniEl('form');
  const tabList = makeMiniEl('div', { role: 'tablist' });
  const sibling = makeMiniEl('div');
  form.appendChild(tabList);
  form.appendChild(sibling);
  form.appendChild(area1);
  form.appendChild(area2);
  const queryMap = { 'tool-tip': tooltip };

  const formQueryAll = (sel) => (sel === 'textarea' ? [area1, area2] : []);
  form.querySelector = (sel) => (sel.includes('tablist') ? tabList : null);
  form.querySelectorAll = formQueryAll;
  area1.closest = (sel) => (sel.includes('form') ? form : null);

  let copyTimeoutFn;
  let clipboardCalls = 0;
  let clearedTimers = [];
  const docBody = makeMiniEl('body');
  const ctx = {
    console, URL, CSS: { escape: (s) => s },
    navigator: { clipboard: { writeText: async () => { clipboardCalls += 1; } } },
    isPageExcluded: () => false,
    window: {
      location: { href: 'https://github.com/o/r/issues/new', pathname: '/o/r/issues/new', hostname: 'github.com' },
      addEventListener() {},
      removeEventListener() {},
      setTimeout: (fn) => { copyTimeoutFn = fn; return clipboardCalls; },
      clearTimeout: (id) => { clearedTimers.push(id); },
    },
    document: {
      body: docBody,
      querySelector: (sel) => (sel === '[data-for="field-1"]' ? queryMap['tool-tip'] : null),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: (tag) => Object.assign(makeMiniEl(tag), { focus() {}, select() {} }),
      getElementById: () => null,
    },
  };
  createContext(ctx);
  runInContext(`${readSrc('core/constants.js')}\n${readSrc('features/collaboration-helper.js')}`, ctx);

  // Step 1 不应匹配 <tool-tip data-for="...">，且 Step 4 在多文本框表单中应拒绝共享兜底容器
  assert.strictEqual(ctx.findCollaborationToolbarMountPoint(area1), null, '不应错挂到 tool-tip 或多输入框共享的 tab sibling');

  // 失联 textarea 点击应用后必须保留弹窗并给出错误提示，且连击复制按钮应复位为“复制英文”
  const liveArea = Object.assign(makeMiniEl('textarea'), { focus() {}, select() {} });
  liveArea.isConnected = false;
  ctx.openCollaborationModal(liveArea);
  const overlay = docBody.children.at(-1);
  const collectByTag = (root, tag) => {
    const out = [];
    const walk = (n) => {
      if (n.tagName === tag) out.push(n);
      (n.children || []).forEach(walk);
    };
    walk(root);
    return out;
  };
  const areas = collectByTag(overlay, 'TEXTAREA');
  const previewArea = areas[1];
  const buttons = collectByTag(overlay, 'BUTTON');
  const copyBtn = buttons.find((b) => b.textContent === '复制英文');
  const applyBtn = buttons.find((b) => b.textContent === '填入输入框');
  const statusEl = overlay.children[0].children[3].children[0];

  previewArea.value = 'Polished English body';
  copyBtn.dispatch('click');
  await new Promise((r) => setTimeout(r, 0));
  copyBtn.dispatch('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(clearedTimers.includes(1), true, '连击复制按钮时应取消前一个定时器');
  copyTimeoutFn();
  assert.strictEqual(copyBtn.textContent, '复制英文', '定时器触发后复制按钮文案必须恢复为“复制英文”');

  applyBtn.dispatch('click');
  assert.strictEqual(overlay.isConnected, true, '目标输入框已卸载时不得关闭弹窗丢弃润色内容');
  assert.match(statusEl.textContent, /已失效或不可编辑/);
});

test('TL;DR mount cleanly absorbs invalidated extension context without unhandled rejections or noisy errors', async () => {
  const readmeRoot = makeMiniEl('article', 'markdown-body');
  readmeRoot.cloneNode = () => makeMiniEl('article', 'markdown-body');
  readmeRoot.textContent = 'Long enough README summary content for TL;DR extraction to avoid short text skip threshold check cleanly.';
  const warnCalls = [];
  const errorCalls = [];
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const ctx = {
    console: {
      debug() {},
      info() {},
      log() {},
      warn: (...args) => warnCalls.push(args.join(' ')),
      error: (...args) => errorCalls.push(args.join(' ')),
    },
    URL, Math, Date, TextEncoder,
    performance: { now: () => 10 },
    isPageExcluded: () => false,
    isReadmePage: () => true,
    getReadmeRootElement: () => readmeRoot,
    getReadmeElementState: () => null,
    normalizeText: (s) => String(s || '').replace(/\s+/g, ' ').trim(),
    getStableReadmeTextHash: (s) => `h:${String(s || '').length}`,
    window: { location: { href: 'https://github.com/o/r', pathname: '/o/r' }, setTimeout, clearTimeout },
    chrome: {
      storage: {
        local: {
          get: async () => { throw new Error('Extension context invalidated.'); },
          set: async () => {},
        },
      },
    },
    document: {
      head: makeMiniEl('head'),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeMiniEl(tag),
      getElementById: () => null,
    },
  };
  createContext(ctx);
  try {
    runInContext(`${readSrc('core/constants.js')}\n${readSrc('core/utils.js')}\n${readSrc('core/storage-cache.js')}\n${readSrc('features/tldr-capsule.js')}`, ctx);
    runInContext('FeatureSet.enable_extension = true; FeatureSet.enable_repo_tldr = true; FeatureSet.readme_enable_repo_cache = true;', ctx);
    ctx.setupTldrCapsuleControls();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(unhandled, [], '扩展重载触发上下文失效时不得产生 Uncaught (in promise)');
    assert.deepStrictEqual(warnCalls, [], '扩展重载触发上下文失效时不得输出噪音警告');
    assert.deepStrictEqual(errorCalls, [], '扩展重载触发上下文失效时不得输出错误日志');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
