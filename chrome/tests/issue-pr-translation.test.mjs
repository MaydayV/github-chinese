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
  assert.match(content, /const complete = translatedCount >= tasks\.length/);
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
  assert.match(content, /state\.toolbarEl\.parentElement !== slotEl/);
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
    assert.match(js, /tldrContent:\s*item\.tldrContent/, `${browser} content.js 应在缓存规范化中保留 tldrContent`);
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
