(function (window, document, undefined) {
    'use strict';

    const OPENAI_README_SYSTEM_PROMPT = `你是一个 GitHub README 翻译引擎。
请把输入数组中的英文文本翻译为目标中文语言，并严格遵守：
1. 保留 Markdown 语义，不要改动链接、URL、占位符、变量名、文件路径。
2. 代码片段、命令、配置键名和版本号保持不变。
3. 不要新增解释，不要总结，不要添加前后缀。
4. 返回 JSON 数组，长度与输入一致，顺序一致。`;

    /****************** 全局配置区（开发者可修改部分） ******************/
    const STORAGE_DEFAULTS = {
        enable_extension: true,
        enable_readme_translation: false,
        enable_issue_pr_translation: false,
        readme_enable_token_record: false,
        readme_enable_repo_cache: false,
        readme_enable_progressive: false,
        readme_provider: 'deepl',
        readme_deepl_api_url: 'https://api-free.deepl.com/v2/translate',
        readme_deepl_api_key: '',
        readme_google_api_url: 'https://translation.googleapis.com/language/translate/v2',
        readme_google_api_key: '',
        readme_azure_api_url: 'https://api.cognitive.microsofttranslator.com/translate',
        readme_azure_api_key: '',
        readme_azure_region: '',
        readme_openai_api_url: 'https://api.openai.com/v1/chat/completions',
        readme_openai_api_key: '',
        readme_openai_model: 'gpt-4.1-mini',
        readme_qwen_mt_api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        readme_qwen_mt_api_key: '',
        readme_qwen_mt_model: 'qwen-mt-turbo',
    };

    const FeatureSet = { ...STORAGE_DEFAULTS };

    const CONFIG = {
        LANG: 'zh-CN',
        // 站点域名 -> 类型映射
        PAGE_MAP: {
            'gist.github.com': 'gist',
            'www.githubstatus.com': 'status',
            'skills.github.com': 'skills',
            'education.github.com': 'education'
        },
        // 需要特殊处理的站点类型
        SPECIAL_SITES: ['gist', 'status', 'skills', 'education'],
        OBSERVER_CONFIG: {
            childList: true,
            subtree: true,
            characterData: true,
            attributeFilter: ['value', 'placeholder', 'aria-label', 'data-confirm']
        }
    };

    const README_CONFIG = {
        ROOT_SELECTORS: [
            '#readme article.markdown-body',
            '[data-testid="readme"] article.markdown-body',
            'article.markdown-body.entry-content.container-lg'
        ],
        SKIP_PARENT_SELECTOR: [
            'pre',
            'code',
            'kbd',
            'samp',
            'svg',
            'math',
            'script',
            'style',
            'textarea',
            '.notranslate',
            '[translate="no"]',
            '[aria-hidden="true"]'
        ].join(', '),
        BLOCK_SELECTOR: [
            'p',
            'li',
            'blockquote',
            'details',
            'summary',
            'td',
            'th',
            'figcaption',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6'
        ].join(', '),
        MAX_BATCH_ITEMS: 24,
        MAX_BATCH_CHARS: 6500,
        OPENAI_MAX_BATCH_ITEMS: 6,
        OPENAI_MAX_BATCH_CHARS: 2400,
        PROGRESSIVE_GROUP_SIZE: 12,
        OPENAI_PROGRESSIVE_GROUP_SIZE: 6,
        DEBOUNCE_MS: 700,
        RECORD_MAX_ENTRIES: 200,
        REPO_CACHE_MAX_ENTRIES: 24,
        MAX_CACHE_HTML_CHARS: 260000,
    };

    const README_LOCAL_STORAGE_KEYS = {
        TRANSLATION_RECORDS: 'ghcn_readme_translation_records',
        REPO_CACHE: 'ghcn_readme_repo_cache',
    };

    const ISSUE_PR_CONFIG = {
        COMMENT_BODY_SELECTORS: [
            '[data-testid="issue-body-viewer"] [data-testid="markdown-body"]',
            '[data-testid="comment-body"] [data-testid="markdown-body"]',
            '[class*="IssueCommentBody"] [data-testid="markdown-body"]',
            '[data-testid^="comment-viewer-outer-box"] [data-testid="markdown-body"]',
            '.react-issue-comment [data-testid="markdown-body"]',
            '.js-comment-body.markdown-body',
            '.js-comment-body .markdown-body',
            '.timeline-comment .comment-body',
            '[data-testid="issue-body"] .markdown-body',
            '[data-testid="comment-body"] .markdown-body',
        ].join(', '),
        RELEASE_BODY_SELECTORS: [
            'div.Box-body > div.markdown-body',
            '[data-test-selector="release-card"] div.markdown-body',
            '[data-testid="release-card"] div.markdown-body',
        ].join(', '),
        BLOCK_SELECTOR: README_CONFIG.BLOCK_SELECTOR,
        SKIP_PARENT_SELECTOR: [
            README_CONFIG.SKIP_PARENT_SELECTOR,
            '.ghcn-discussion-translate-toolbar',
            '[data-ghcn-discussion-translate]',
        ].join(', '),
        DEBOUNCE_MS: 400,
    };

    const readmeRuntime = {
        timerId: 0,
        inFlight: false,
        rerunRequested: false,
        stateByElement: new WeakMap(),
        isApplyingTranslation: false,
        translationCache: new Map(),
        repoCacheMap: new Map(),
        repoCacheLoaded: false,
        lastWarnKey: '',
    };

    const issuePrRuntime = {
        timerId: 0,
        inFlight: false,
        stateByElement: new WeakMap(),
        lastWarnKey: '',
    };

    const FIXED_TARGET_LANG = 'zh-CN';
    const AI_CHAT_PROVIDERS = ['openai', 'openai_compatible', 'deepseek', 'qwen', 'minimax', 'kimi', 'zhipu', 'volcengine'];

    let pageConfig = {};
    let scheduleReactGlobalNavRefresh = () => {};

    // 初始化
    init().catch(err => {
        console.error('初始化失败:', err);
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'refresh-page') {
            window.location.reload();
        }
    });

    async function loadFeatureSet() {
        const result = await chrome.storage.sync.get(STORAGE_DEFAULTS);
        Object.assign(FeatureSet, result);
    }

    function refreshCurrentPageTranslations() {
        if (!pageConfig.currentPageType || !document.body) return;
        traverseNode(document.body);
        transTitle();
        transBySelector();
        scheduleReactGlobalNavRefresh();
        scheduleReadmeTranslation('refreshCurrentPageTranslations');
        scheduleIssuePrTranslationControls('refreshCurrentPageTranslations');
    }

    function isReadmeSettingKey(key) {
        return key === 'enable_readme_translation' || key === 'enable_issue_pr_translation' || key.startsWith('readme_');
    }

    function handleFeatureToggle(key, newFeatureState) {
        switch (key) {
            case 'enable_extension':
                if (newFeatureState) {
                    document.documentElement.lang = CONFIG.LANG;
                    refreshCurrentPageTranslations();
                } else {
                    restoreReadmeTranslation();
                    restoreIssuePrTranslations();
                }
                break;
            default:
                if (isReadmeSettingKey(key)) {
                    readmeRuntime.translationCache.clear();
                    if (key === 'readme_enable_repo_cache' && !newFeatureState) {
                        readmeRuntime.repoCacheMap.clear();
                        readmeRuntime.repoCacheLoaded = false;
                    }
                    if (FeatureSet.enable_extension && FeatureSet.enable_readme_translation) {
                        scheduleReadmeTranslation(`setting:${key}`);
                    } else {
                        restoreReadmeTranslation();
                    }
                    if (FeatureSet.enable_extension && FeatureSet.enable_issue_pr_translation) {
                        scheduleIssuePrTranslationControls(`setting:${key}`);
                    } else if (key === 'enable_issue_pr_translation') {
                        restoreIssuePrTranslations();
                    }
                }
                break;
        }
    }

    function watchFeatureChanges() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync') return;

            Object.entries(changes).forEach(([key, change]) => {
                if (!(key in FeatureSet)) return;
                FeatureSet[key] = change.newValue;
                handleFeatureToggle(key, change.newValue);
            });
        });
    }

    // 更新页面设置
    function updatePageConfig(currentPageChangeTrigger) {
        const newType = detectPageType();
        if (newType && newType !== pageConfig.currentPageType) {
            pageConfig = buildPageConfig(newType);
            scheduleReadmeTranslation(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleIssuePrTranslationControls(`${currentPageChangeTrigger}:pageTypeChanged`);
        }
    }

    // 构建页面设置 pageConfig 对象
    function buildPageConfig(pageType = pageConfig.currentPageType) {
        return {
            // 当前页面类型
            currentPageType: pageType,
            textCache: new Map(),
            // 页面标题静态词库
            titleStaticDict: {
                ...I18N[CONFIG.LANG].public.title.static,
                ...(I18N[CONFIG.LANG][pageType]?.title?.static || {})
            },
            // 页面标题正则词库
            titleRegexpRules: [
                ...I18N[CONFIG.LANG].public.title.regexp,
                ...(I18N[CONFIG.LANG][pageType]?.title?.regexp || [])
            ],
            // 静态词库
            staticDict: {
                ...I18N[CONFIG.LANG].public.static,
                ...(I18N[CONFIG.LANG][pageType]?.static || {})
            },
            // 正则词库
            regexpRules: [
                ...(I18N[CONFIG.LANG][pageType]?.regexp || []),
                ...I18N[CONFIG.LANG].public.regexp
            ],
            // 忽略突变元素选择器（字符串）
            ignoreMutationSelectors: [
                ...I18N.conf.ignoreMutationSelectorPage['*'],
                ...(I18N.conf.ignoreMutationSelectorPage[pageType] || [])
            ].join(', '),
            // 忽略元素选择器规则（字符串）
            ignoreSelectors: [
                ...I18N.conf.ignoreSelectorPage['*'],
                ...(I18N.conf.ignoreSelectorPage[pageType] || [])
            ].join(', '),
            // 字符数据监视开启规则（布尔值）
            characterData: I18N.conf.characterDataPage.includes(pageType),
            // CSS 选择器规则
            tranSelectors: [
                ...(I18N[CONFIG.LANG].public.selector || []),
                ...(I18N[CONFIG.LANG][pageType]?.selector || [])
            ],
        };
    }

    function isReactGlobalNavPortalNode(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const portalRoot = element?.closest?.('#__primerPortalRoot__');
        if (!portalRoot) return false;

        const portal = element.closest?.('[data-component="Portal"]')
            || element.querySelector?.('[data-component="Portal"]')
            || portalRoot;
        if (portal.matches?.('#search-suggestions-dialog')
            || portal.querySelector?.('#search-suggestions-dialog')) return true;

        const referenceAttributes = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns'];
        const referenceElements = [
            portal,
            ...portal.querySelectorAll?.(
                referenceAttributes.map(attribute => `[${attribute}]`).join(', ')
            ) || [],
        ];

        for (const referenceElement of referenceElements) {
            for (const attribute of referenceAttributes) {
                const ids = referenceElement.getAttribute?.(attribute)?.split(/\s+/) || [];
                if (ids.some(id => document.getElementById(id)?.closest?.('header.GlobalNav'))) {
                    return true;
                }
            }
        }

        const portalIds = new Set([
            portal.id,
            ...Array.from(portal.querySelectorAll?.('[id]') || [], item => item.id),
        ].filter(Boolean));
        if (portalIds.size) {
            const headerReferences = document.querySelectorAll(
                'header.GlobalNav [aria-describedby], header.GlobalNav [aria-controls], header.GlobalNav [aria-owns]'
            );
            for (const headerReference of headerReferences) {
                for (const attribute of ['aria-describedby', 'aria-controls', 'aria-owns']) {
                    const ids = headerReference.getAttribute(attribute)?.split(/\s+/) || [];
                    if (ids.some(id => portalIds.has(id))) return true;
                }
            }
        }

        const hasControlledSurface = portal.matches?.('[role="menu"], [role="dialog"], [role="tooltip"]')
            || portal.querySelector?.('[role="menu"], [role="dialog"], [role="tooltip"]');
        return !!hasControlledSurface
            && !!document.activeElement?.closest?.('header.GlobalNav, qbsearch-input');
    }

    function setupReactGlobalNavTranslation() {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;

        const labels = I18N.conf.reactGlobalNavLabels || {};
        const dataContentLabelSelector = 'header.GlobalNav [data-component="text"][data-content]';
        const portalSurfaceSelector = '#__primerPortalRoot__ [role="menu"], #__primerPortalRoot__ [role="dialog"], #__primerPortalRoot__ [role="tooltip"]';
        const searchSurfaceSelector = 'qbsearch-input';
        const searchModuleSelector = 'header.GlobalNav [class*="Search-module__"]';
        const unsafeTextSelector = [
            'textarea',
            '[contenteditable="true"]',
            'code',
            'pre',
            'kbd',
            'svg',
            'img',
            'canvas',
            'video',
        ].join(', ');
        const searchSelector = `${searchModuleSelector}, ${searchSurfaceSelector}, #__primerPortalRoot__ [role="dialog"]`;
        const translatableAttributeNames = ['title', 'aria-label', 'data-visible-text', 'placeholder'];
        const reactGlobalNavIdleMs = 700;
        const reactGlobalNavRetryMs = 400;
        let timer = null;
        let headerObserver = null;
        let lastReactGlobalNavMutationAt = Date.now();
        let lastReactGlobalNavPortalMutationAt = Date.now();
        const observedSurfaces = new WeakSet();

        function isReactGlobalNavSearchActive() {
            const active = document.activeElement;
            return !!active?.closest?.(searchSelector)
                || !!document.querySelector('#__primerPortalRoot__ [role="dialog"]');
        }

        function isReactGlobalNavSurfaceIdle(surfaceType = 'header') {
            const lastMutationAt = surfaceType === 'portal'
                ? lastReactGlobalNavPortalMutationAt
                : lastReactGlobalNavMutationAt;
            return Date.now() - lastMutationAt >= reactGlobalNavIdleMs;
        }

        function canTranslateReactGlobalNavHeader() {
            return document.readyState === 'complete'
                && isReactGlobalNavSurfaceIdle('header')
                && !isReactGlobalNavSearchActive();
        }

        function findStaticGlobalNavLabel(source) {
            const locale = I18N[CONFIG.LANG];
            if (!locale) return null;

            for (const section of Object.values(locale)) {
                const label = section?.static?.[source];
                if (typeof label === 'string' && label && label !== source) {
                    return label;
                }
            }

            return null;
        }

        function findRegexpGlobalNavLabel(source) {
            const locale = I18N[CONFIG.LANG];
            if (!locale) return null;

            for (const section of Object.values(locale)) {
                for (const [pattern, replacement] of section?.regexp || []) {
                    const match = source.match(pattern);
                    if (!match || match.index !== 0 || match[0] !== source) continue;

                    const label = source.replace(pattern, replacement);
                    if (label !== source) return label;
                }
            }

            return null;
        }

        function resolveReactGlobalNavLabel(source) {
            return labels[source] || findStaticGlobalNavLabel(source) || findRegexpGlobalNavLabel(source);
        }

        function normalizeReactGlobalNavText(text) {
            return text?.replace(/\s+/g, ' ').trim();
        }

        function translateReactGlobalNavText(text) {
            const source = normalizeReactGlobalNavText(text);
            return source ? resolveReactGlobalNavLabel(source) : null;
        }

        function translateReactGlobalNavElement(element, source) {
            const label = translateReactGlobalNavText(source ?? element.textContent);
            if (label && element.textContent !== label) {
                element.textContent = label;
            }
        }

        function shouldSkipReactGlobalNavNode(node) {
            const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            if (!element) return true;
            if (element.closest?.(unsafeTextSelector)) return true;

            return false;
        }

        function translateReactGlobalNavAttributes(element) {
            translatableAttributeNames.forEach(attributeName => {
                const value = element.getAttribute?.(attributeName);
                const label = translateReactGlobalNavText(value);
                if (label && value !== label) {
                    element.setAttribute(attributeName, label);
                }
            });
        }

        function translateReactGlobalNavTextNode(node) {
            const label = translateReactGlobalNavText(node.data);
            if (label) {
                node.data = node.data.replace(node.data.trim(), label);
            }
        }

        function translateReactGlobalNavSurface(surface) {
            if (!FeatureSet.enable_extension || !surface || shouldSkipReactGlobalNavNode(surface)) return;

            if (surface.nodeType === Node.ELEMENT_NODE) {
                translateReactGlobalNavAttributes(surface);
            }

            const walker = document.createTreeWalker(
                surface,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        return shouldSkipReactGlobalNavNode(node)
                            ? NodeFilter.FILTER_REJECT
                            : NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let node;
            while ((node = walker.nextNode())) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    translateReactGlobalNavAttributes(node);
                } else if (node.nodeType === Node.TEXT_NODE) {
                    translateReactGlobalNavTextNode(node);
                }
            }
        }

        function translateReactGlobalNavHeader() {
            const header = document.querySelector('header.GlobalNav');
            if (!header) return true;
            if (!canTranslateReactGlobalNavHeader()) return false;

            document.querySelectorAll(dataContentLabelSelector).forEach(element => {
                if (!shouldSkipReactGlobalNavNode(element)) {
                    translateReactGlobalNavElement(element, element.getAttribute('data-content'));
                }
            });
            translateReactGlobalNavSurface(header);

            return true;
        }

        function isReactGlobalNavSearchPortal(surface) {
            return surface.matches?.('[role="dialog"]')
                || !!surface.querySelector?.('#search-suggestions-dialog, qbsearch-input, [role="dialog"]');
        }

        function translateReactGlobalNavPortals() {
            const surfaces = Array.from(document.querySelectorAll(portalSurfaceSelector))
                .filter(isReactGlobalNavPortalNode);
            if (!surfaces.length) return true;

            let searchPortalPending = false;
            surfaces.forEach(surface => {
                if (isReactGlobalNavSearchPortal(surface) && !isReactGlobalNavSurfaceIdle('portal')) {
                    searchPortalPending = true;
                    return;
                }
                translateReactGlobalNavSurface(surface);
            });

            return !searchPortalPending;
        }

        function translateReactGlobalNavLabels(options = { requireSettledHeader: true }) {
            if (!FeatureSet.enable_extension) return;
            observeReactGlobalNav();

            const headerTranslated = translateReactGlobalNavHeader();
            const portalsTranslated = translateReactGlobalNavPortals();

            if ((options.requireSettledHeader && !headerTranslated) || !portalsTranslated) {
                scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, options);
            }
        }

        function scheduleReactGlobalNavTranslation(delay = 800, options = {}) {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => translateReactGlobalNavLabels(options), delay);
        }

        function scheduleReactGlobalNavSeries() {
            [800, 1600, 3000].forEach(delay => {
                window.setTimeout(translateReactGlobalNavLabels, delay);
            });
        }

        scheduleReactGlobalNavRefresh = scheduleReactGlobalNavSeries;

        function recordReactGlobalNavMutation(surface) {
            if (surface?.id === '__primerPortalRoot__' || surface?.closest?.('#__primerPortalRoot__')) {
                lastReactGlobalNavPortalMutationAt = Date.now();
                return;
            }

            lastReactGlobalNavMutationAt = Date.now();
        }

        function observeReactGlobalNav() {
            if (!headerObserver) {
                headerObserver = new MutationObserver(mutations => {
                    mutations.forEach(mutation => recordReactGlobalNavMutation(mutation.target));
                    translateReactGlobalNavPortals();
                    scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true });
                });
            }

            [
                document.querySelector('header.GlobalNav'),
                document.querySelector('#__primerPortalRoot__'),
            ].forEach(surface => {
                if (!surface || observedSurfaces.has(surface)) return;

                observedSurfaces.add(surface);
                recordReactGlobalNavMutation(surface);
                headerObserver.observe(surface, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                });
            });
        }

        function startReactGlobalNavTranslation() {
            observeReactGlobalNav();
            scheduleReactGlobalNavSeries();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startReactGlobalNavTranslation, { once: true });
        } else {
            startReactGlobalNavTranslation();
        }

        window.addEventListener('turbo:load', scheduleReactGlobalNavSeries);
        window.addEventListener('urlchange', scheduleReactGlobalNavSeries);
        document.addEventListener('click', () => scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true }), true);
        document.addEventListener('focusin', () => scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true }), true);
        document.addEventListener('focusout', () => scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true }), true);
        document.addEventListener('pointerover', () => scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true }), true);
    }

    /**
     * watchUpdate 函数：监视页面变化，根据变化的节点进行翻译
     */
    function watchUpdate() {
        // 缓存当前页面的 URL
        let previousURL = window.location.href;

        const handleUrlChange = () => {
            const currentURL = window.location.href;
            // 如果页面的 URL 发生变化
            if (currentURL !== previousURL) {
                previousURL = currentURL;
                updatePageConfig('DOM变化');
            }
        }

        const processMutations = mutations => {
            // 平铺突变记录并过滤需要处理的节点（链式操作）
            // 使用 mutations.flatMap 进行筛选突变:
            //   1. 针对`节点增加`突变，后期迭代翻译的对象调整为`addedNodes`中记录的新增节点，而不是`target`，此举大幅减少重复迭代翻译
            //   2. 对于其它`属性`和特定页面`文本节点`突变，仍旧直接处理`target`
            //   3. 使用`.filter()`筛选丢弃特定页面`特定忽略元素`内突变的节点
            mutations.flatMap(({ target, addedNodes, type }) => {
                // 处理子节点添加的情况
                if (type === 'childList' && addedNodes.length > 0) {
                    return [...addedNodes]; // 将新增节点转换为数组
                }
                // 处理属性和文本内容变更的情况
                return (type === 'attributes' || (type === 'characterData' && pageConfig.characterData))
                    ? [target] // 否则，仅处理目标节点
                    : [];
            })
            // 过滤需要忽略的突变节点
            .filter(node => {
                const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                return element
                    && !element.closest?.(pageConfig.ignoreMutationSelectors)
                    && !isReactGlobalNavPortalNode(element);
            })
            // 处理每个变化
            .forEach(node =>
                // 递归遍历节点树进行处理
                traverseNode(node)
            );
        }

        // 监听 document.body 下 DOM 变化，用于处理节点变化
        new MutationObserver(mutations => {
            if (!FeatureSet.enable_extension) return;
            handleUrlChange();
            if (readmeRuntime.isApplyingTranslation) return;
            if (pageConfig.currentPageType) processMutations(mutations);
            if (FeatureSet.enable_readme_translation) {
                scheduleReadmeTranslation('mutation');
            }
            if (FeatureSet.enable_issue_pr_translation) {
                scheduleIssuePrTranslationControls('mutation');
            }
        }).observe(document.body, CONFIG.OBSERVER_CONFIG);
    }

    /**
     * GitHub 的 SSR React 组件在 hydration 完成后才添加 loaded 类。
     * 在此之前改写文本会造成 hydration 失败，并让组件交互失效。
     */
    function watchReactHydration() {
        const handleLoadedReactRoot = element => {
            if (
                !FeatureSet.enable_extension
                || !pageConfig.currentPageType
                || !element.matches?.('react-app.loaded, react-partial.loaded')
            ) {
                return;
            }

            traverseNode(element);
        };

        const observer = new MutationObserver(mutations => {
            mutations.forEach(({ target, type }) => {
                if (type === 'attributes') handleLoadedReactRoot(target);
            });
        });

        observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class'],
        });

        // 避免组件恰好在观察器启动前完成 hydration 而漏翻译
        document.querySelectorAll('react-app.loaded, react-partial.loaded').forEach(handleLoadedReactRoot);
    }

    /**
     * traverseNode 函数：遍历指定的节点，并对节点进行翻译。
     * @param {Node} node - 需要遍历的节点。
     */
    function traverseNode(rootNode) {
        if (!FeatureSet.enable_extension) return;

        const handleTextNode = node => {
            if (node.length > 500) return;
            transElement(node, 'data');
        }

        // 如果 rootNode 是文本节点，直接处理
        if (rootNode.nodeType === Node.TEXT_NODE) {
            handleTextNode(rootNode);
            return; // 文本节点没有子节点，直接返回
        }

        const treeWalker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            node =>
                // 跳过忽略的节点
                node.matches?.(pageConfig.ignoreSelectors)
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT,
        );

        const handleElement = node => {
            // 处理不同标签的元素属性翻译
            switch (node.tagName) {
                case 'RELATIVE-TIME': // 翻译时间元素
                    transTimeElement(node.shadowRoot);
                    return;

                case 'INPUT':
                case 'TEXTAREA': // 输入框 按钮 文本域
                    if (['button', 'submit', 'reset'].includes(node.type)) {
                        transElement(node.dataset, 'confirm'); // 翻译 浏览器 提示对话框
                        transElement(node, 'value');
                    } else {
                        transElement(node, 'placeholder');
                    }
                    break;

                case 'OPTGROUP':
                    transElement(node, 'label'); // 翻译 <optgroup> 的 label 属性
                    break;

                case 'BUTTON':
                    transElement(node, 'title'); // 翻译 浏览器 提示对话框
                    transElement(node.dataset, 'confirm'); // 翻译 浏览器 提示对话框 ok
                    transElement(node.dataset, 'confirmText'); // 翻译 浏览器 提示对话框 ok
                    transElement(node.dataset, 'confirmCancelText'); // 取消按钮 提醒
                    transElement(node, 'cancelConfirmText'); // 取消按钮 提醒
                    transElement(node.dataset, 'disableWith'); // 按钮等待提示

                case 'A':
                case 'SPAN':
                    transElement(node, 'title'); // title 属性
                    transElement(node.dataset, 'visibleText'); // 翻译 浏览器 提示对话框 ok

                default:
                    // 仅当 元素存在'tooltipped'样式 aria-label 才起效果
                    if (/tooltipped/.test(node.className)) transElement(node, 'ariaLabel'); // 带提示的元素，类似 tooltip 效果的
            }
        }

        // 预绑定处理函数提升性能
        const handlers = {
            [Node.ELEMENT_NODE]: handleElement,
            [Node.TEXT_NODE]: handleTextNode
        };

        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            handlers[currentNode.nodeType]?.(currentNode);
        }
    }

    /**
     * detectPageType 函数：检测当前页面类型，基于URL、元素类名和meta信息。
     * @returns {string|boolean} 页面的类型，如'repository'、'dashboard'等，如果无法确定类型，那么返回 false。
     */
    function detectPageType() {
        const url = new URL(window.location.href);
        const { PAGE_MAP, SPECIAL_SITES } = CONFIG;
        const { hostname, pathname } = url;

        // 基础配置 ===============================================
        const site = PAGE_MAP[hostname] || 'github'; // 通过站点映射获取基础类型
        const isLogin = document.body.classList.contains('logged-in');
        const metaLocation = document.head.querySelector('meta[name="analytics-location"]')?.content || '';

        // 页面特征检测 ============================================
        const isSession = document.body.classList.contains('session-authentication');
        const isHomepage = pathname === '/' && site === 'github';
        const isProfile = document.body.classList.contains('page-profile') || metaLocation === '/<user-name>';
        const isRepository = /\/<user-name>\/<repo-name>/.test(metaLocation);
        const isOrganization = /\/<org-login>/.test(metaLocation) || /^\/(?:orgs|organizations)/.test(pathname);

        // 正则配置 ================================================
        const { rePagePathRepo, rePagePathOrg, rePagePath } = I18N.conf;

        // 核心判断逻辑 ============================================
        let pageType;
        switch (true) { // 使用 switch(true) 模式处理多条件分支
            // 1. 登录相关页面
            case isSession:
                pageType = 'session-authentication';
                break;

            // 2. 特殊站点类型（gist/status/skills/education）
            case SPECIAL_SITES.includes(site):
                pageType = site;
                break;

            // 3. 个人资料页
            case isProfile:
                const tabParam = new URLSearchParams(url.search).get('tab');
                pageType = pathname.includes('/stars') ? 'page-profile/stars'
                         : tabParam ? `page-profile/${tabParam}`
                         : 'page-profile';
                break;

            // 4. 首页/仪表盘
            case isHomepage:
                pageType = isLogin ? 'dashboard' : 'homepage';
                break;

            // 5. 代码仓库页
            case isRepository:
                const repoMatch = pathname.match(rePagePathRepo);
                pageType = repoMatch ? `repository/${repoMatch[1]}` : 'repository';
                break;

            // 6. 组织页面
            case isOrganization:
                const orgMatch = pathname.match(rePagePathOrg);
                pageType = orgMatch ? `orgs/${orgMatch[1] || orgMatch.slice(-1)[0]}` : 'orgs';
                break;

            // 7. 默认处理逻辑
            default:
                const pathMatch = pathname.match(rePagePath);
                pageType = pathMatch ? (pathMatch[1] || pathMatch.slice(-1)[0]) : false;
        }

        // 词库校验 ================================================
        if (pageType === false || !I18N[CONFIG.LANG]?.[pageType]) {
            return false; // 明确返回 false 表示异常
        }

        return pageType;
    }

    /**
     * transTitle 函数：翻译页面标题
     */
    function transTitle() {
        if (!FeatureSet.enable_extension) return;
        const text = document.title; // 获取标题文本内容
        let translatedText = pageConfig.titleStaticDict[text] || '';
        if (!translatedText) {
            for (const [pattern, replacement] of pageConfig.titleRegexpRules) {
                translatedText = text.replace(pattern, replacement);
                if (translatedText !== text) break;
            }
        }
        if (translatedText) {
            document.title = translatedText;
        }
    }

    /**
     * transTimeElement 函数：翻译时间元素文本内容。
     * @param {Element} el - 需要翻译的元素。
     */
    function transTimeElement(el) {
        if (!FeatureSet.enable_extension || !el) return;
        const text = el.childNodes.length > 0 ? el.lastChild.textContent : el.textContent;
        const translatedText = text.replace(/^on/, '');
        if (translatedText !== text) {
            el.textContent = translatedText;
        }
    }

    /**
     * transElement 函数：翻译指定元素的文本内容或属性。
     * @param {Element|DOMStringMap} el - 需要翻译的元素或元素的数据集 (node.dataset)。
     * @param {string} field - 需要翻译的属性名称或文本内容字段。
     */
    function transElement(el, field) {
        if (!FeatureSet.enable_extension) return false;
        const text = el[field]; // 获取需要翻译的文本
        if (!text) return false; // 当 text 为空时，退出函数

        const translatedText = transText(text); // 翻译后的文本
        if (translatedText) {
            el[field] = translatedText; // 替换翻译后的内容
        }
    }

    /**
     * transText 函数：翻译文本内容。
     * @param {string} text - 需要翻译的文本内容。
     * @returns {string|boolean} 翻译后的文本内容，如果没有找到对应的翻译，那么返回 false。
     */
    function transText(text) {
        // 判断是否需要跳过翻译
        //  1. 检查内容是否为空或者仅包含空白字符或数字。
        //  2. 检查内容是否仅包含中文字符。
        //  3. 检查内容是否不包含英文字母和符号。
        const shouldSkip = text => /^[\s0-9]*$/.test(text) || /^[\u4e00-\u9fa5]+$/.test(text) || !/[a-zA-Z,.]/.test(text);
        if (shouldSkip(text)) return false;

        // 清理文本内容
        const trimmedText = text.trim(); // 去除首尾空格
        const cleanedText = trimmedText.replace(/\xa0|[\s]+/g, ' '); // 去除多余空白字符（包括 &nbsp; 空格 换行符）

        // 尝试获取翻译结果
        const translatedText = fetchTranslatedText(cleanedText);

        // 如果找到翻译并且不与清理后的文本相同，则返回替换后的结果
        if (translatedText && translatedText !== cleanedText) {
            return text.replace(trimmedText, translatedText); // 替换原字符，保留首尾空白部分
        }

        return false;
    }

    /**
     * fetchTranslatedText 函数：从特定页面的词库中获得翻译文本内容。
     * @param {string} text - 需要翻译的文本内容。
     * @returns {string|boolean} 翻译后的文本内容，如果没有找到对应的翻译，那么返回 false。
     */
    function fetchTranslatedText(text) {
        const cachedText = pageConfig.textCache.get(text);
        if (cachedText !== undefined) return cachedText;

        // 静态翻译
        let translatedText = pageConfig.staticDict[text]; // 默认翻译 公共部分

        if (typeof translatedText === 'string') {
            pageConfig.textCache.set(text, translatedText);
            return translatedText;
        }

        // 正则翻译
        for (const [pattern, replacement] of pageConfig.regexpRules) {
            translatedText = text.replace(pattern, replacement);
            if (translatedText !== text) {
                pageConfig.textCache.set(text, translatedText);
                return translatedText;
            }
        }

        pageConfig.textCache.set(text, false);
        return false; // 没有翻译条目
    }

    /**
     * transBySelector 函数：通过 CSS 选择器找到页面上的元素，并将其文本内容替换为预定义的翻译。
     */
    function transBySelector() {
        if (!FeatureSet.enable_extension) return;
        // 遍历每个翻译规则
        pageConfig.tranSelectors?.forEach(([selector, translatedText]) => {
            // 使用 CSS 选择器找到对应的元素
            const element = document.querySelector(selector);
            // 如果找到了元素，那么将其文本内容替换为翻译后的文本
            if (element) {
                element.textContent = translatedText;
            }
        })

        // /copilot/agents 页面结构是动态渲染，使用强制替换兜底，避免分段命中失败
        applyCopilotAgentsOverrides();
    }

    function applyCopilotAgentsOverrides() {
        if (window.location.hostname !== 'github.com' || window.location.pathname !== '/copilot/agents') {
            return;
        }

        const setText = (selector, text) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = text;
        };

        setText('h2.Blankslate-Heading', 'Copilot 云端智能体处理例行任务，让您专注于核心工作');
        setText('p.Blankslate-Description', '将测试、依赖项升级、迁移和维护等工作交给智能体处理，节省您的时间。您可以通过 Copilot Chat、命令行、IDE 创建拉取请求，或直接将议题分配给 Copilot 来开始使用。');
        setText('.BannerDescription', '仅在付费计划中可用。试用 Copilot Pro，可免费 30 天。');

        // 兼容不同结构：链接文案可能被拆分或已部分翻译
        document.querySelectorAll('a').forEach((el) => {
            const text = (el.textContent || '').trim();
            if (/capabilities/i.test(text)) {
                el.textContent = '查看 Copilot 云端智能体能力';
            }
        });

        // 试用按钮文案兜底
        document.querySelectorAll('button, a').forEach((el) => {
            const text = (el.textContent || '').trim();
            if (/^start\s+free\s+trial$/i.test(text)) {
                el.textContent = '开始免费试用';
            }
        });
    }

    function isRepositoryPage() {
        return typeof pageConfig.currentPageType === 'string' && pageConfig.currentPageType.startsWith('repository');
    }

    function isReadmeTranslationEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_readme_translation && isRepositoryPage();
    }

    function getReadmeRootElement() {
        for (const selector of README_CONFIG.ROOT_SELECTORS) {
            const element = document.querySelector(selector);
            if (!element) continue;

            return element;
        }

        return null;
    }

    function getReadmeElementState(readmeEl) {
        if (!readmeRuntime.stateByElement.has(readmeEl)) {
            readmeRuntime.stateByElement.set(readmeEl, {
                originalHtml: '',
                translatedHash: '',
                translatedSignature: '',
            });
        }

        return readmeRuntime.stateByElement.get(readmeEl);
    }

    function buildRepoIdentifierFromPath(pathname) {
        if (!pathname) return '';
        const match = String(pathname).match(/^\/([^/]+)\/([^/]+)/);
        if (!match) return '';

        const decodePathPart = (segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        };

        const owner = decodePathPart(match[1]).toLowerCase();
        const repo = decodePathPart(match[2]).toLowerCase();
        return owner && repo ? `${owner}/${repo}` : '';
    }

    function getCurrentRepoInfo() {
        const fullName = buildRepoIdentifierFromPath(window.location.pathname);
        if (!fullName) return null;

        const [owner, repo] = fullName.split('/');
        if (!owner || !repo) return null;
        return { owner, repo, fullName };
    }

    function buildRepoCacheKey(repoInfo, sourceHash, signature) {
        if (!repoInfo?.owner || !repoInfo?.repo || !sourceHash || !signature) return '';
        return `${String(repoInfo.owner).toLowerCase()}/${String(repoInfo.repo).toLowerCase()}|${sourceHash}|${signature}`;
    }

    function buildProgressiveGroups(items, groupSize) {
        const values = Array.isArray(items) ? items : [];
        if (!values.length) return [];

        const size = Math.max(1, Number(groupSize) || 1);
        const groups = [];

        for (let index = 0; index < values.length; index += size) {
            groups.push(values.slice(index, index + size));
        }

        return groups;
    }

    function getReadmeTaskBlock(readmeEl, task) {
        const parent = task?.node?.parentElement;
        if (!parent) return readmeEl;

        const block = parent.closest(README_CONFIG.BLOCK_SELECTOR);
        return block && readmeEl.contains(block) ? block : parent;
    }

    function getTranslationTaskBlock(rootEl, task, blockSelector) {
        const parent = task?.node?.parentElement;
        if (!parent) return rootEl;

        const block = parent.closest(blockSelector);
        return block && rootEl.contains(block) ? block : parent;
    }

    function buildProgressiveTaskGroups(readmeEl, tasks, groupSize) {
        const blockMap = new Map();
        tasks.forEach((task) => {
            const block = getTranslationTaskBlock(readmeEl, task, README_CONFIG.BLOCK_SELECTOR);
            if (!blockMap.has(block)) {
                blockMap.set(block, []);
            }
            blockMap.get(block).push(task);
        });

        return buildProgressiveGroups([...blockMap.values()], groupSize)
            .map(group => group.flat());
    }

    function buildProgressiveTaskGroupsByBlock(rootEl, tasks, groupSize, blockSelector) {
        const blockMap = new Map();
        tasks.forEach((task) => {
            const block = getTranslationTaskBlock(rootEl, task, blockSelector);
            if (!blockMap.has(block)) {
                blockMap.set(block, []);
            }
            blockMap.get(block).push(task);
        });

        return buildProgressiveGroups([...blockMap.values()], groupSize)
            .map(group => group.flat());
    }

    function trimTranslationRecords(records, maxEntries) {
        const list = Array.isArray(records) ? records : [];
        const limit = Math.max(1, Number(maxEntries) || 1);

        return [...list]
            .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
            .slice(0, limit);
    }

    function getReadmeUsageTokens(payload) {
        const usage = payload?.usage;
        if (!usage || typeof usage !== 'object') return 0;

        const totalTokens = Number(usage.total_tokens);
        if (Number.isFinite(totalTokens) && totalTokens >= 0) {
            return totalTokens;
        }

        const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
        const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
        const fallback = promptTokens + completionTokens;
        return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    }

    function generateRecordId() {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function isExtensionContextInvalidatedError(error) {
        const message = String(error?.message || error || '');
        return /extension context invalidated/i.test(message)
            || /context invalidated/i.test(message)
            || /extension context was invalidated/i.test(message);
    }

    function normalizeRuntimeErrorMessage(error) {
        if (isExtensionContextInvalidatedError(error)) {
            return '插件上下文已失效，请刷新当前 GitHub 页面后重试。';
        }

        return error instanceof Error ? error.message : String(error || '翻译失败');
    }

    function normalizeRepoCacheEntries(entries) {
        const list = Array.isArray(entries) ? entries : [];

        return list
            .filter((item) => item && typeof item.key === 'string' && typeof item.translatedHtml === 'string')
            .map((item) => ({
                key: item.key,
                repo: item.repo || '',
                sourceHash: item.sourceHash || '',
                translatedHtml: item.translatedHtml,
                updatedAt: Number(item.updatedAt || 0),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, README_CONFIG.REPO_CACHE_MAX_ENTRIES);
    }

    async function getLocalValue(key, fallbackValue) {
        try {
            const result = await chrome.storage.local.get({ [key]: fallbackValue });
            return result[key];
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                throw new Error(normalizeRuntimeErrorMessage(error));
            }
            throw error;
        }
    }

    async function setLocalValue(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (error) {
            if (isExtensionContextInvalidatedError(error)) {
                throw new Error(normalizeRuntimeErrorMessage(error));
            }
            throw error;
        }
    }

    async function ensureRepoCacheLoaded() {
        if (readmeRuntime.repoCacheLoaded) return;

        const storedEntries = await getLocalValue(README_LOCAL_STORAGE_KEYS.REPO_CACHE, []);
        const normalizedEntries = normalizeRepoCacheEntries(storedEntries);

        readmeRuntime.repoCacheMap.clear();
        normalizedEntries.forEach((entry) => {
            readmeRuntime.repoCacheMap.set(entry.key, entry);
        });
        readmeRuntime.repoCacheLoaded = true;
    }

    async function getRepoCachedTranslation(cacheKey) {
        if (!FeatureSet.readme_enable_repo_cache || !cacheKey) return null;
        await ensureRepoCacheLoaded();

        const entry = readmeRuntime.repoCacheMap.get(cacheKey);
        if (!entry || !entry.translatedHtml) return null;
        return entry;
    }

    async function upsertRepoCachedTranslation(cacheKey, value) {
        if (!FeatureSet.readme_enable_repo_cache || !cacheKey) return;
        if (!value?.translatedHtml || value.translatedHtml.length > README_CONFIG.MAX_CACHE_HTML_CHARS) return;

        await ensureRepoCacheLoaded();

        readmeRuntime.repoCacheMap.set(cacheKey, {
            key: cacheKey,
            repo: value.repo || '',
            sourceHash: value.sourceHash || '',
            translatedHtml: value.translatedHtml,
            updatedAt: Date.now(),
        });

        const entries = normalizeRepoCacheEntries([...readmeRuntime.repoCacheMap.values()]);
        readmeRuntime.repoCacheMap.clear();
        entries.forEach((entry) => {
            readmeRuntime.repoCacheMap.set(entry.key, entry);
        });

        await setLocalValue(README_LOCAL_STORAGE_KEYS.REPO_CACHE, entries);
    }

    async function appendReadmeTranslationRecord(record) {
        if (!FeatureSet.readme_enable_token_record) return;

        const repoInfo = getCurrentRepoInfo();
        const nextRecord = {
            id: generateRecordId(),
            repo: record?.repo || repoInfo?.fullName || 'unknown/unknown',
            sourceType: record?.sourceType || 'readme',
            status: record?.status || 'success',
            tokens: Math.max(0, Number(record?.tokens) || 0),
            provider: (FeatureSet.readme_provider || '').trim().toLowerCase(),
            createdAt: Date.now(),
            durationMs: Math.max(0, Number(record?.durationMs) || 0),
            sourceHash: record?.sourceHash || '',
            detail: record?.detail ? truncateText(String(record.detail), 160) : '',
        };

        const existing = await getLocalValue(README_LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS, []);
        const records = Array.isArray(existing) ? existing : [];
        records.push(nextRecord);

        const trimmed = trimTranslationRecords(records, README_CONFIG.RECORD_MAX_ENTRIES);
        await setLocalValue(README_LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS, trimmed);
    }

    function applyTextGroupTranslations(tasksByText, texts, translatedMap) {
        let translatedCount = 0;

        texts.forEach((text) => {
            const translated = translatedMap.get(text);
            if (!translated || translated === text) return;

            const tasks = tasksByText.get(text) || [];
            tasks.forEach((task) => {
                task.node.data = task.rawText.replace(task.trimmedText, translated);
                translatedCount += 1;
            });
        });

        return translatedCount;
    }

    function withReadmeDomMutationGuard(callback) {
        readmeRuntime.isApplyingTranslation = true;
        try {
            return callback();
        } finally {
            window.setTimeout(() => {
                readmeRuntime.isApplyingTranslation = false;
            }, 0);
        }
    }

    function applyReadmeHtml(readmeEl, html) {
        return withReadmeDomMutationGuard(() => {
            readmeEl.innerHTML = html;
        });
    }

    function applyReadmeTextGroupTranslations(tasksByText, texts, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTextGroupTranslations(tasksByText, texts, translatedMap));
    }

    function applyTaskTranslations(tasks, translatedMap) {
        let translatedCount = 0;

        tasks.forEach((task) => {
            const translated = translatedMap.get(task.normalizedText);
            if (!translated || translated === task.normalizedText) return;

            task.node.data = task.rawText.replace(task.trimmedText, translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function applyReadmeTaskTranslations(tasks, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTaskTranslations(tasks, translatedMap));
    }

    async function waitForNextPaint() {
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
    }

    function restoreReadmeTranslation() {
        const readmeEl = getReadmeRootElement();
        if (!readmeEl) return;

        const state = getReadmeElementState(readmeEl);
        if (state.originalHtml && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        state.translatedHash = '';
        state.translatedSignature = '';
    }

    function scheduleReadmeTranslation(reason) {
        if (!FeatureSet.enable_extension) return;

        if (readmeRuntime.timerId) {
            window.clearTimeout(readmeRuntime.timerId);
        }

        readmeRuntime.timerId = window.setTimeout(() => {
            readmeRuntime.timerId = 0;
            runReadmeTranslation(reason).catch(err => {
                console.error('[README翻译] 执行失败:', err);
            });
        }, README_CONFIG.DEBOUNCE_MS);
    }

    async function runReadmeTranslation(reason) {
        if (!isReadmeTranslationEnabled()) {
            restoreReadmeTranslation();
            return;
        }

        if (readmeRuntime.inFlight) {
            readmeRuntime.rerunRequested = true;
            return;
        }

        const readmeEl = getReadmeRootElement();
        if (!readmeEl) return;

        readmeRuntime.inFlight = true;
        const startAt = performance.now();

        try {
            await translateReadmeElement(readmeEl, reason);
        } catch (error) {
            const sourceHash = createHash(getReadmeElementState(readmeEl).originalHtml || readmeEl.innerHTML || '');
            await appendReadmeTranslationRecord({
                sourceType: 'readme',
                status: 'failed',
                tokens: 0,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: normalizeRuntimeErrorMessage(error),
            }).catch((recordError) => {
                console.warn('[README翻译] 记录失败日志时出错:', recordError);
            });
            throw error;
        } finally {
            readmeRuntime.inFlight = false;
            if (readmeRuntime.rerunRequested) {
                readmeRuntime.rerunRequested = false;
                scheduleReadmeTranslation('rerun');
            }
        }
    }

    async function translateReadmeElement(readmeEl, reason) {
        const startAt = performance.now();
        const state = getReadmeElementState(readmeEl);
        const currentHash = createHash(readmeEl.innerHTML);

        if (state.translatedHash && currentHash !== state.translatedHash) {
            // README 被重新渲染后，重置翻译状态，以最新英文内容作为基线。
            state.originalHtml = readmeEl.innerHTML;
            state.translatedHash = '';
            state.translatedSignature = '';
        } else if (!state.originalHtml) {
            state.originalHtml = readmeEl.innerHTML;
        }

        const providerConfig = getProviderConfig();
        if (!providerConfig.ok) {
            warnReadmeConfig(providerConfig.message);
            restoreReadmeTranslation();
            return;
        }

        const repoInfo = getCurrentRepoInfo();
        const sourceHash = createHash(state.originalHtml);
        const signature = createHash(`${providerConfig.signature}\n${state.originalHtml}`);
        if (state.translatedSignature === signature && currentHash === state.translatedHash) {
            return;
        }

        const sourceText = normalizeText(readmeEl.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            if (readmeEl.innerHTML !== state.originalHtml) {
                applyReadmeHtml(readmeEl, state.originalHtml);
            }

            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            return;
        }

        const repoCacheKey = buildRepoCacheKey(repoInfo, sourceHash, providerConfig.signature);
        const cacheHit = await getRepoCachedTranslation(repoCacheKey).catch((error) => {
            console.warn('[README翻译] 读取仓库缓存失败:', error);
            return null;
        });

        if (cacheHit?.translatedHtml) {
            applyReadmeHtml(readmeEl, cacheHit.translatedHtml);
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);

            await appendReadmeTranslationRecord({
                sourceType: 'readme',
                status: 'cache_hit',
                tokens: 0,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: `cache_reason=${reason || 'unknown'}`,
            }).catch((error) => {
                console.warn('[README翻译] 写入缓存命中记录失败:', error);
            });
            return;
        }

        if (readmeEl.innerHTML !== state.originalHtml) {
            readmeEl.innerHTML = state.originalHtml;
        }

        const tasks = collectReadmeTextTasks(readmeEl);
        if (!tasks.length) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            return;
        }

        const uniqueTexts = [...new Set(tasks.map(task => task.normalizedText))];
        const tasksByText = new Map();
        tasks.forEach((task) => {
            if (!tasksByText.has(task.normalizedText)) {
                tasksByText.set(task.normalizedText, []);
            }
            tasksByText.get(task.normalizedText).push(task);
        });

        let translatedCount = 0;
        let totalTokens = 0;

        if (FeatureSet.readme_enable_progressive) {
            const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
            const groupSize = usesAiBatchLimits
                ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
            const groups = buildProgressiveTaskGroups(readmeEl, tasks, groupSize);

            for (let index = 0; index < groups.length; index += 1) {
                const groupTexts = [...new Set(groups[index].map(task => task.normalizedText))];
                const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(groupTexts, providerConfig);
                totalTokens += groupTokens;
                translatedCount += applyReadmeTaskTranslations(groups[index], translatedMap);

                if (index < groups.length - 1) {
                    await waitForNextPaint();
                }
            }
        } else {
            const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig);
            totalTokens += tokens;
            translatedCount += applyReadmeTextGroupTranslations(tasksByText, uniqueTexts, translatedMap);
        }


        state.translatedSignature = signature;
        state.translatedHash = createHash(readmeEl.innerHTML);

        await upsertRepoCachedTranslation(repoCacheKey, {
            repo: repoInfo?.fullName || '',
            sourceHash,
            translatedHtml: readmeEl.innerHTML,
        }).catch((error) => {
            console.warn('[README翻译] 写入仓库缓存失败:', error);
        });

        await appendReadmeTranslationRecord({
            sourceType: 'readme',
            status: 'success',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `translated_nodes=${translatedCount}`,
        }).catch((error) => {
            console.warn('[README翻译] 写入翻译记录失败:', error);
        });
    }

    function warnReadmeConfig(message) {
        const warnKey = `${FeatureSet.readme_provider}:${message}`;
        if (readmeRuntime.lastWarnKey === warnKey) return;

        readmeRuntime.lastWarnKey = warnKey;
        console.warn(`[README翻译] ${message}`);
    }

    function collectReadmeTextTasks(readmeEl) {
        const tasks = [];
        const walker = document.createTreeWalker(readmeEl, NodeFilter.SHOW_TEXT);

        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest(README_CONFIG.SKIP_PARENT_SELECTOR)) continue;

            const rawText = node.data;
            const trimmedText = rawText.trim();
            const normalizedText = normalizeText(trimmedText);

            if (shouldSkipReadmeText(normalizedText)) continue;

            tasks.push({ node, rawText, trimmedText, normalizedText });
        }

        return tasks;
    }

    function shouldSkipReadmeText(text) {
        if (!text) return true;
        if (text.length > 2000) return true;
        if (isMostlyCjkText(text)) return true;
        if (/^[0-9\s.,:;()\[\]{}+\-/*#@_`~!$%^&|<>="'\\]+$/.test(text)) return true;
        if (!/[A-Za-z]/.test(text)) return true;
        if (/[\u3400-\u9FFF]/.test(text) && !/[A-Za-z]{2,}/.test(text)) return true;
        return false;
    }

    function isMostlyCjkText(text) {
        const input = String(text || '');
        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        if (!cjkCount) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        return cjkCount >= 8 && cjkCount >= latinCount * 1.25;
    }

    function shouldSkipReadmeByLanguage(text, targetLang) {
        if (!/^zh(?:-|$)/i.test(String(targetLang || ''))) return false;

        const input = String(text || '').trim();
        if (input.length < 40) return false;

        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        if (cjkCount < 12) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        return cjkCount >= latinCount * 1.5;
    }

    function isIssueOrPrDiscussionPage() {
        if (window.location.hostname !== 'github.com') return false;
        return /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/.test(window.location.pathname);
    }

    function isReleaseNotesPage() {
        if (window.location.hostname !== 'github.com') return false;

        const pathname = String(window.location.pathname || '');
        if (/^\/[^/]+\/[^/]+\/releases\/(?:new|edit)(?:\/|$)/.test(pathname)) return false;
        return /^\/[^/]+\/[^/]+\/releases(?:\/(?:tag\/[^/]+|latest))?(?:\/|$)/.test(pathname);
    }

    function isDiscussionTranslationTargetPage() {
        return isIssueOrPrDiscussionPage() || isReleaseNotesPage();
    }

    function isIssuePrTranslationEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_issue_pr_translation && isDiscussionTranslationTargetPage();
    }

    function getIssuePrRecordSourceType() {
        if (isReleaseNotesPage()) return 'release';

        const match = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull)\//);
        if (match?.[1] === 'issues') return 'issue';
        if (match?.[1] === 'pull') return 'pull';
        return 'issue';
    }

    function getDiscussionRecordSourceType(item) {
        return item?.sourceType || getIssuePrRecordSourceType();
    }

    function getIssuePrDiscussionState(item) {
        const keyEl = item?.markdownEl || item;
        if (!issuePrRuntime.stateByElement.has(keyEl)) {
            issuePrRuntime.stateByElement.set(keyEl, {
                originalHtml: '',
                translatedHash: '',
                translatedSignature: '',
                isBusy: false,
                translatedEl: null,
                toolbarEl: null,
                mode: 'original',
                errorMessage: '',
            });
        }

        return issuePrRuntime.stateByElement.get(keyEl);
    }

    function findDiscussionItems() {
        const seen = new Set();
        const isReleaseNotes = isReleaseNotesPage();
        const selectors = isReleaseNotes
            ? ISSUE_PR_CONFIG.RELEASE_BODY_SELECTORS
            : ISSUE_PR_CONFIG.COMMENT_BODY_SELECTORS;

        return [...document.querySelectorAll(selectors)]
            .map((markdownEl) => {
                if (!markdownEl || seen.has(markdownEl)) return null;
                seen.add(markdownEl);
                if (markdownEl.closest('.ghcn-discussion-translation-panel')) return null;

                if (!isReleaseNotes && markdownEl.parentElement?.closest('[data-testid="markdown-body"]')) {
                    return null;
                }

                const rootEl = isReleaseNotes
                    ? markdownEl.closest([
                        '[data-test-selector="release-card"]',
                        '[data-testid="release-card"]',
                        '.Box',
                        'section',
                        'article',
                    ].join(', '))
                    : markdownEl.closest([
                    '[data-testid="issue-body"]',
                    '[data-testid="comment-body"]',
                    '[data-testid^="comment-viewer-outer-box"]',
                    '.react-issue-comment',
                    '.timeline-comment-group',
                    '.timeline-comment',
                    '.js-comment',
                    '.js-timeline-item',
                    '.TimelineItem',
                    '.js-discussion',
                    '.js-quote-selection-container',
                ].join(', '));
                if (!rootEl) return null;

                const viewerEl = isReleaseNotes
                    ? (markdownEl.parentElement || markdownEl)
                    : markdownEl.closest([
                    '[data-testid="issue-body-viewer"]',
                    '[data-testid="comment-body-viewer"]',
                    '[class*="IssueCommentBody"]',
                    '.comment-body',
                    '.js-comment-body',
                ].join(', ')) || markdownEl.parentElement;
                if (!viewerEl) return null;

                const text = normalizeText(markdownEl.textContent || '');
                if (!text) return null;

                return {
                    rootEl,
                    viewerEl,
                    markdownEl,
                    text,
                    sourceType: isReleaseNotes ? 'release' : getIssuePrRecordSourceType(),
                };
            })
            .filter(Boolean);
    }

    function getIssuePrCommentBodies() {
        return findDiscussionItems()
            .map(item => item.markdownEl)
            .filter((bodyEl) => {
                return normalizeText(bodyEl.textContent || '').length > 0;
            });
    }

    function findDiscussionActionsSlot(item) {
        if (item?.sourceType === 'release') return null;

        const rootEl = item?.rootEl;
        if (!rootEl) return null;

        return rootEl.querySelector('[class*="ActionsButtonsContainer"]')
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"] [data-testid="comment-header-hamburger"]')?.parentElement
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"]')
            || rootEl.querySelector('.timeline-comment-actions')
            || rootEl.querySelector('.timeline-comment-header .timeline-comment-actions')
            || rootEl.querySelector('[class*="actionsSection"]')
            || rootEl.querySelector('[class*="actionsWrapper"]')
            || rootEl.querySelector('[aria-label="Issue body actions"]')?.parentElement
            || rootEl.querySelector('[aria-label="Comment actions"]')?.parentElement
            || rootEl.querySelector('[data-testid="issue-body-header-author"]')?.closest('[class*="activityHeader"]');
    }

    function buildDiscussionCacheKey(item, sourceHash, signature) {
        const repoInfo = getCurrentRepoInfo();
        if (!repoInfo?.fullName || !sourceHash || !signature) return '';

        const sourceType = getDiscussionRecordSourceType(item);
        const discussionMatch = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull)\/(\d+)/);
        const discussionType = discussionMatch?.[1] || sourceType;
        const discussionNumber = discussionMatch?.[2] || getReleaseIdentifier(item) || 'unknown';
        const commentId = item?.rootEl?.id
            || item?.rootEl?.querySelector('a[href*="#issue-"], a[href*="#issuecomment-"], a[href*="#discussion_r"]')?.hash?.slice(1)
            || item?.rootEl?.querySelector('a[href*="/releases/tag/"]')?.getAttribute('href')?.split('/releases/tag/')[1]
            || createHash(item?.markdownEl?.textContent || '');

        return `${repoInfo.fullName}|${discussionType}|${discussionNumber}|${commentId}|${sourceHash}|${signature}`;
    }

    function getReleaseIdentifier(item) {
        const pathname = String(window.location.pathname || '');
        const pathTag = pathname.match(/^\/[^/]+\/[^/]+\/releases\/tag\/(.+)$/)?.[1];
        if (pathTag) return `tag:${pathTag}`;

        const href = item?.rootEl?.querySelector('a[href*="/releases/tag/"]')?.getAttribute('href') || '';
        const hrefTag = href.match(/\/releases\/tag\/([^?#]+)/)?.[1];
        if (hrefTag) return `tag:${hrefTag}`;

        return pathname.replace(/^\/[^/]+\/[^/]+\/releases\/?/, '') || 'releases';
    }

    function injectIssuePrControlStyles() {
        if (document.getElementById('ghcn-discussion-translate-style')) return;

        const style = document.createElement('style');
        style.id = 'ghcn-discussion-translate-style';
        style.textContent = `
            .ghcn-discussion-translate-toolbar {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-right: 6px;
            }
            .ghcn-discussion-translate-toolbar--release {
                display: flex;
                margin: 0 0 8px;
            }
            .ghcn-discussion-translate-btn {
                border: 1px solid var(--borderColor-muted, #d0d7de);
                border-radius: 6px;
                background: var(--button-default-bgColor-rest, #f6f8fa);
                color: var(--fgColor-default, #24292f);
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                line-height: 20px;
                padding: 2px 8px;
            }
            .ghcn-discussion-translate-btn--primary {
                border-color: var(--button-primary-borderColor-rest, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-rest, #1f883d);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn.is-active {
                border-color: var(--button-primary-borderColor-rest, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-rest, #1f883d);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn:hover {
                background: var(--button-default-bgColor-hover, #f3f4f6);
            }
            .ghcn-discussion-translate-btn--primary:hover,
            .ghcn-discussion-translate-btn--primary:focus-visible,
            .ghcn-discussion-translate-btn.is-active:hover,
            .ghcn-discussion-translate-btn.is-active:focus-visible {
                border-color: var(--button-primary-borderColor-hover, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-hover, #1a7f37);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn:disabled {
                cursor: not-allowed;
                opacity: 0.6;
            }
            .ghcn-discussion-translate-error {
                color: var(--fgColor-danger, #cf222e);
                font-size: 12px;
                line-height: 18px;
            }
            .ghcn-discussion-translation-panel {
                border-left: 3px solid var(--borderColor-accent-emphasis, #0969da);
                margin: 14px 0 0;
                padding: 12px 16px;
                background: var(--bgColor-muted, #f6f8fa);
                border-radius: 6px;
            }
            .ghcn-discussion-translation-panel[hidden],
            [data-ghcn-discussion-hidden="true"] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    function scheduleIssuePrTranslationControls(reason) {
        if (!FeatureSet.enable_extension) return;

        if (issuePrRuntime.timerId) {
            window.clearTimeout(issuePrRuntime.timerId);
        }

        issuePrRuntime.timerId = window.setTimeout(() => {
            issuePrRuntime.timerId = 0;
            setupIssuePrTranslationControls(reason);
        }, ISSUE_PR_CONFIG.DEBOUNCE_MS);
    }

    function setupIssuePrTranslationControls() {
        if (!isIssuePrTranslationEnabled()) {
            restoreIssuePrTranslations();
            return;
        }

        injectIssuePrControlStyles();

        findDiscussionItems().forEach((item) => {
            mountDiscussionToolbar(item);
        });
    }

    function mountDiscussionToolbar(item) {
        const state = getIssuePrDiscussionState(item);
        if (state.toolbarEl?.isConnected) return;

        const slotEl = findDiscussionActionsSlot(item);
        if (!slotEl && item.sourceType !== 'release') return;

        const toolbar = document.createElement('div');
        toolbar.className = 'ghcn-discussion-translate-toolbar';
        if (item.sourceType === 'release') {
            toolbar.classList.add('ghcn-discussion-translate-toolbar--release');
        }
        toolbar.dataset.ghcnDiscussionTranslate = 'toolbar';

        state.toolbarEl = toolbar;
        renderDiscussionToolbar(item);
        if (slotEl) {
            slotEl.insertBefore(toolbar, slotEl.firstChild);
        } else if (item.sourceType === 'release') {
            item.viewerEl.insertBefore(toolbar, item.markdownEl);
        } else {
            return;
        }
        item.markdownEl.dataset.ghcnDiscussionTranslate = 'ready';
    }

    function renderDiscussionToolbar(item) {
        const state = getIssuePrDiscussionState(item);
        const toolbar = state.toolbarEl;
        if (!toolbar) return;

        toolbar.textContent = '';

        if (!state.translatedEl) {
            const button = createDiscussionToolbarButton(
                state.isBusy ? '翻译中...' : (state.errorMessage ? '重试' : '翻译'),
                '翻译当前讨论内容',
            );
            button.classList.add('ghcn-discussion-translate-btn--primary');
            button.disabled = state.isBusy;
            button.addEventListener('click', () => {
                handleIssuePrTranslateButton(item).catch((error) => {
                    console.error('[Issue/PR翻译] 执行失败:', error);
                    state.errorMessage = normalizeRuntimeErrorMessage(error);
                    state.isBusy = false;
                    renderDiscussionToolbar(item);
                });
            });
            toolbar.appendChild(button);
            if (state.errorMessage) {
                renderIssuePrError(toolbar, state.errorMessage);
            }
            return;
        }

        ['original', 'translated', 'bilingual'].forEach((mode) => {
            const labels = {
                original: '原文',
                translated: '译文',
                bilingual: '双语',
            };
            const button = createDiscussionToolbarButton(labels[mode], `切换到${labels[mode]}视图`);
            button.classList.toggle('is-active', state.mode === mode);
            button.addEventListener('click', () => {
                setDiscussionViewMode(item, mode);
            });
            toolbar.appendChild(button);
        });

        if (state.errorMessage) {
            renderIssuePrError(toolbar, state.errorMessage);
        }
    }

    function createDiscussionToolbarButton(label, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghcn-discussion-translate-btn';
        button.dataset.ghcnDiscussionTranslate = 'button';
        button.textContent = label;
        button.title = title;
        button.setAttribute('aria-label', title);
        return button;
    }

    async function handleIssuePrTranslateButton(item) {
        const state = getIssuePrDiscussionState(item);
        if (state.isBusy) return;

        clearIssuePrError(state.toolbarEl);
        state.errorMessage = '';

        state.isBusy = true;
        renderDiscussionToolbar(item);

        try {
            await translateIssuePrBody(item);
            setDiscussionViewMode(item, 'translated');
        } catch (error) {
            state.errorMessage = normalizeRuntimeErrorMessage(error);
            throw error;
        } finally {
            state.isBusy = false;
            renderDiscussionToolbar(item);
        }
    }

    function renderIssuePrError(toolbar, message) {
        clearIssuePrError(toolbar);

        const errorEl = document.createElement('span');
        errorEl.className = 'ghcn-discussion-translate-error';
        errorEl.dataset.ghcnDiscussionTranslate = 'error';
        errorEl.textContent = truncateText(message || '翻译失败', 90);
        toolbar.appendChild(errorEl);
    }

    function clearIssuePrError(toolbar) {
        toolbar?.querySelectorAll('[data-ghcn-discussion-translate="error"]').forEach((el) => el.remove());
    }

    function restoreIssuePrBody(itemOrBodyEl) {
        const item = itemOrBodyEl?.markdownEl ? itemOrBodyEl : { markdownEl: itemOrBodyEl };
        const state = getIssuePrDiscussionState(item);
        state.translatedEl?.remove();
        state.translatedEl = null;
        state.mode = 'original';
        state.translatedHash = '';
        item.markdownEl?.removeAttribute('data-ghcn-discussion-hidden');
        item.markdownEl?.removeAttribute('data-ghcn-discussion-view-mode');
        renderDiscussionToolbar(item);
    }

    function restoreIssuePrTranslations() {
        document.querySelectorAll('[data-ghcn-discussion-translate="toolbar"]').forEach((toolbar) => toolbar.remove());
        findDiscussionItems().forEach((item) => {
            restoreIssuePrBody(item);
            delete item.markdownEl.dataset.ghcnDiscussionTranslate;
        });
    }

    async function translateIssuePrBody(item) {
        const startAt = performance.now();
        const state = getIssuePrDiscussionState(item);
        const markdownEl = item.markdownEl;

        if (!state.originalHtml || (state.translatedHash && createHash(markdownEl.innerHTML) !== state.translatedHash)) {
            state.originalHtml = markdownEl.innerHTML;
            state.translatedHash = '';
            state.translatedSignature = '';
            state.translatedEl?.remove();
            state.translatedEl = null;
            state.mode = 'original';
        }

        const providerConfig = getProviderConfig();
        if (!providerConfig.ok) {
            warnIssuePrConfig(providerConfig.message);
            throw new Error(providerConfig.message);
        }

        const sourceHash = createHash(state.originalHtml);
        const signature = createHash(`${providerConfig.signature}\n${state.originalHtml}`);
        if (state.translatedSignature === signature && state.translatedEl?.isConnected) {
            return;
        }

        const sourceText = normalizeText(markdownEl.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            return;
        }

        const cacheKey = buildDiscussionCacheKey(item, sourceHash, providerConfig.signature);
        const cacheHit = await getRepoCachedTranslation(cacheKey).catch((error) => {
            console.warn('[Issue/PR翻译] 读取讨论缓存失败:', error);
            return null;
        });

        if (cacheHit?.translatedHtml) {
            const translatedEl = createTranslatedClone(markdownEl);
            translatedEl.innerHTML = cacheHit.translatedHtml;
            state.translatedEl?.remove();
            state.translatedEl = translatedEl;
            markdownEl.insertAdjacentElement('afterend', translatedEl);
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            state.sourceHash = sourceHash;
            state.errorMessage = '';

            await appendReadmeTranslationRecord({
                sourceType: getDiscussionRecordSourceType(item),
                status: 'cache_hit',
                tokens: 0,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: `${getDiscussionRecordSourceType(item)}_cache_hit`,
            }).catch((error) => {
                console.warn('[Issue/PR翻译] 写入缓存命中记录失败:', error);
            });
            return;
        }

        const translatedEl = createTranslatedClone(markdownEl);
        const tasks = collectIssuePrTextTasks(translatedEl);
        if (!tasks.length) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            throw new Error('当前讨论内容没有可翻译的文本。');
        }

        const uniqueTexts = [...new Set(tasks.map(task => task.normalizedText))];
        const tasksByText = new Map();
        tasks.forEach((task) => {
            if (!tasksByText.has(task.normalizedText)) {
                tasksByText.set(task.normalizedText, []);
            }
            tasksByText.get(task.normalizedText).push(task);
        });

        let translatedCount = 0;
        let totalTokens = 0;

        state.translatedEl?.remove();
        state.translatedEl = translatedEl;
        markdownEl.insertAdjacentElement('afterend', translatedEl);
        setDiscussionViewMode(item, 'translated');

        if (FeatureSet.readme_enable_progressive) {
            const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
            const groupSize = usesAiBatchLimits
                ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
            const groups = buildProgressiveTaskGroupsByBlock(translatedEl, tasks, groupSize, ISSUE_PR_CONFIG.BLOCK_SELECTOR);

            for (let index = 0; index < groups.length; index += 1) {
                const groupTexts = [...new Set(groups[index].map(task => task.normalizedText))];
                const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(groupTexts, providerConfig);
                totalTokens += groupTokens;
                translatedCount += applyTaskTranslations(groups[index], translatedMap);

                if (index < groups.length - 1) {
                    await waitForNextPaint();
                }
            }
        } else {
            const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig);
            totalTokens += tokens;
            translatedCount += applyTextGroupTranslations(tasksByText, uniqueTexts, translatedMap);
        }

        state.translatedSignature = signature;
        state.translatedHash = createHash(markdownEl.innerHTML);
        state.sourceHash = sourceHash;
        state.errorMessage = '';

        await upsertRepoCachedTranslation(cacheKey, {
            repo: getCurrentRepoInfo()?.fullName || '',
            sourceHash,
            translatedHtml: translatedEl.innerHTML,
        }).catch((error) => {
            console.warn('[Issue/PR翻译] 写入讨论缓存失败:', error);
        });

        await appendReadmeTranslationRecord({
            sourceType: getDiscussionRecordSourceType(item),
            status: 'success',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `${getDiscussionRecordSourceType(item)}_translated_nodes=${translatedCount}`,
        }).catch((error) => {
            console.warn('[Issue/PR翻译] 写入翻译记录失败:', error);
        });
    }

    function createTranslatedClone(markdownEl) {
        const translatedEl = markdownEl.cloneNode(true);
        translatedEl.classList.add('ghcn-discussion-translation-panel');
        translatedEl.removeAttribute('data-ghcn-discussion-translate');
        translatedEl.setAttribute('data-ghcn-discussion-view-mode', 'translated');
        translatedEl.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        translatedEl.querySelectorAll('[data-ghcn-discussion-translate]').forEach((el) => el.remove());
        translatedEl.hidden = true;
        return translatedEl;
    }

    function setDiscussionViewMode(item, mode) {
        const state = getIssuePrDiscussionState(item);
        const nextMode = ['original', 'translated', 'bilingual'].includes(mode) ? mode : 'original';
        state.mode = nextMode;

        if (!state.translatedEl) {
            item.markdownEl.removeAttribute('data-ghcn-discussion-hidden');
            item.markdownEl.setAttribute('data-ghcn-discussion-view-mode', 'original');
            renderDiscussionToolbar(item);
            return;
        }

        item.markdownEl.setAttribute('data-ghcn-discussion-view-mode', nextMode);
        state.translatedEl.setAttribute('data-ghcn-discussion-view-mode', nextMode);

        const hideOriginal = nextMode === 'translated';
        const hideTranslated = nextMode === 'original';
        item.markdownEl.dataset.ghcnDiscussionHidden = hideOriginal ? 'true' : 'false';
        state.translatedEl.hidden = hideTranslated;

        renderDiscussionToolbar(item);
    }

    function collectIssuePrTextTasks(bodyEl) {
        const tasks = [];
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);

        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest(ISSUE_PR_CONFIG.SKIP_PARENT_SELECTOR)) continue;

            const rawText = node.data;
            const trimmedText = rawText.trim();
            const normalizedText = normalizeText(trimmedText);

            if (shouldSkipReadmeText(normalizedText)) continue;

            tasks.push({ node, rawText, trimmedText, normalizedText });
        }

        return tasks;
    }

    function warnIssuePrConfig(message) {
        const warnKey = `${FeatureSet.readme_provider}:${message}`;
        if (issuePrRuntime.lastWarnKey === warnKey) return;

        issuePrRuntime.lastWarnKey = warnKey;
        console.warn(`[Issue/PR翻译] ${message}`);
    }

    function normalizeText(text) {
        return text.replace(/\xa0|[\s]+/g, ' ').trim();
    }

    function getProviderConfig() {
        const provider = (FeatureSet.readme_provider || '').trim().toLowerCase();
        const targetLang = FIXED_TARGET_LANG;

        if (!provider) {
            return { ok: false, message: '请先选择 README 翻译服务。' };
        }

        switch (provider) {
            case 'deepl': {
                const url = normalizeUrl(FeatureSet.readme_deepl_api_url);
                const key = (FeatureSet.readme_deepl_api_key || '').trim();
                if (!url || !key) {
                    return { ok: false, message: 'DeepL 需要 API 地址与 API Key。' };
                }

                return {
                    ok: true,
                    provider,
                    targetLang,
                    url,
                    key,
                    signature: `${provider}|${targetLang}|${url}|${createHash(key)}`,
                };
            }

            case 'google': {
                const url = normalizeUrl(FeatureSet.readme_google_api_url);
                const key = (FeatureSet.readme_google_api_key || '').trim();
                if (!url || !key) {
                    return { ok: false, message: 'Google Cloud Translation 需要 API 地址与 API Key。' };
                }

                return {
                    ok: true,
                    provider,
                    targetLang,
                    url,
                    key,
                    signature: `${provider}|${targetLang}|${url}|${createHash(key)}`,
                };
            }

            case 'azure': {
                const url = normalizeUrl(FeatureSet.readme_azure_api_url);
                const key = (FeatureSet.readme_azure_api_key || '').trim();
                const region = (FeatureSet.readme_azure_region || '').trim();
                if (!url || !key || !region) {
                    return { ok: false, message: 'Azure Translator 需要 API 地址、API Key 与 Region。' };
                }

                return {
                    ok: true,
                    provider,
                    targetLang,
                    url,
                    key,
                    region,
                    signature: `${provider}|${targetLang}|${url}|${region}|${createHash(key)}`,
                };
            }

            case 'qwen_mt': {
                const rawUrl = normalizeUrl(FeatureSet.readme_qwen_mt_api_url);
                const url = normalizeOpenAiEndpoint(rawUrl);
                const key = (FeatureSet.readme_qwen_mt_api_key || '').trim();
                const model = (FeatureSet.readme_qwen_mt_model || '').trim();
                if (!url || !key || !model) {
                    return { ok: false, message: 'Qwen-MT 需要 API 地址、API Key 与模型名。' };
                }

                return {
                    ok: true,
                    provider,
                    targetLang,
                    url,
                    key,
                    model,
                    signature: `${provider}|${targetLang}|${url}|${model}|${createHash(key)}`,
                };
            }

            case 'openai':
            case 'openai_compatible':
            case 'deepseek':
            case 'qwen':
            case 'minimax':
            case 'kimi':
            case 'zhipu':
            case 'volcengine': {
                const rawUrl = normalizeUrl(FeatureSet.readme_openai_api_url);
                const url = normalizeOpenAiEndpoint(rawUrl);
                const key = (FeatureSet.readme_openai_api_key || '').trim();
                const model = (FeatureSet.readme_openai_model || '').trim();
                if (!url || !key || !model) {
                    return { ok: false, message: 'AI 对话接口需要 API 地址、API Key 与模型名。' };
                }

                return {
                    ok: true,
                    provider,
                    targetLang,
                    url,
                    key,
                    model,
                    signature: `${provider}|${targetLang}|${url}|${model}|${createHash(key)}`,
                };
            }

            default:
                return { ok: false, message: `不支持的翻译服务类型: ${provider}` };
        }
    }

    async function translateTextsWithProvider(texts, providerConfig) {
        const translatedMap = new Map();
        const uncached = [];
        let totalTokens = 0;

        texts.forEach(text => {
            const cacheKey = `${providerConfig.signature}|${text}`;
            const cached = readmeRuntime.translationCache.get(cacheKey);

            if (cached) {
                translatedMap.set(text, cached);
            } else {
                uncached.push(text);
            }
        });

        const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
        const maxBatchItems = usesAiBatchLimits
            ? README_CONFIG.OPENAI_MAX_BATCH_ITEMS
            : README_CONFIG.MAX_BATCH_ITEMS;
        const maxBatchChars = usesAiBatchLimits
            ? README_CONFIG.OPENAI_MAX_BATCH_CHARS
            : README_CONFIG.MAX_BATCH_CHARS;
        const batches = buildBatches(uncached, maxBatchItems, maxBatchChars);
        for (const batch of batches) {
            const batchResult = await translateBatchWithFallback(batch, providerConfig);
            const batchResults = batchResult.translations;
            totalTokens += batchResult.tokens;

            batch.forEach((text, index) => {
                const translated = (batchResults[index] || '').trim();
                const fallback = translated || text;
                const cacheKey = `${providerConfig.signature}|${text}`;
                readmeRuntime.translationCache.set(cacheKey, fallback);
                translatedMap.set(text, fallback);
            });
        }

        return {
            translatedMap,
            totalTokens,
        };
    }

    async function translateBatchWithFallback(batch, providerConfig) {
        try {
            const result = await translateBatch(batch, providerConfig);
            const translations = result?.translations;
            const tokens = Math.max(0, Number(result?.tokens) || 0);

            if (!Array.isArray(translations) || translations.length !== batch.length) {
                throw new Error('翻译结果数量与请求数量不一致，请检查接口配置。');
            }
            return {
                translations,
                tokens,
            };
        } catch (error) {
            // OpenAI 兼容接口在部分平台上会因 JSON 输出不稳定导致整批失败，此时退化为更小批次重试。
            if ((!AI_CHAT_PROVIDERS.includes(providerConfig.provider) && providerConfig.provider !== 'qwen_mt') || batch.length <= 1) {
                throw error;
            }

            const midpoint = Math.ceil(batch.length / 2);
            const left = await translateBatchWithFallback(batch.slice(0, midpoint), providerConfig);
            const right = await translateBatchWithFallback(batch.slice(midpoint), providerConfig);
            return {
                translations: [...left.translations, ...right.translations],
                tokens: left.tokens + right.tokens,
            };
        }
    }

    function buildBatches(texts, maxItems, maxChars) {
        if (!texts.length) return [];

        const batches = [];
        let currentBatch = [];
        let currentLength = 0;

        texts.forEach(text => {
            const length = text.length;
            const exceedsItems = currentBatch.length >= maxItems;
            const exceedsChars = currentLength + length > maxChars;

            if (currentBatch.length > 0 && (exceedsItems || exceedsChars)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentLength = 0;
            }

            currentBatch.push(text);
            currentLength += length;
        });

        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    async function translateBatch(texts, providerConfig) {
        switch (providerConfig.provider) {
            case 'deepl':
                return translateWithDeepL(texts, providerConfig);
            case 'google':
                return translateWithGoogle(texts, providerConfig);
            case 'azure':
                return translateWithAzure(texts, providerConfig);
            case 'qwen_mt':
                return translateWithQwenMt(texts, providerConfig);
            case 'openai':
            case 'openai_compatible':
            case 'deepseek':
            case 'qwen':
            case 'minimax':
            case 'kimi':
            case 'zhipu':
            case 'volcengine':
                return translateWithOpenAiCompatible(texts, providerConfig);
            default:
                throw new Error(`未知翻译服务: ${providerConfig.provider}`);
        }
    }

    async function translateWithDeepL(texts, providerConfig) {
        const body = new URLSearchParams();
        body.append('target_lang', mapTargetLangForDeepL());
        texts.forEach(text => body.append('text', text));

        const data = await proxyFetchJson({
            url: providerConfig.url,
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${providerConfig.key}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });

        return {
            translations: (data?.translations || []).map(item => (item?.text || '').trim()),
            tokens: 0,
        };
    }

    async function translateWithGoogle(texts, providerConfig) {
        const url = new URL(providerConfig.url);
        url.searchParams.set('key', providerConfig.key);

        const body = new URLSearchParams();
        body.append('target', providerConfig.targetLang);
        body.append('format', 'text');
        texts.forEach(text => body.append('q', text));

        const data = await proxyFetchJson({
            url: url.toString(),
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        });

        return {
            translations: (data?.data?.translations || []).map(item => decodeHtmlEntities(item?.translatedText || '')),
            tokens: 0,
        };
    }

    async function translateWithAzure(texts, providerConfig) {
        const url = new URL(providerConfig.url);
        url.searchParams.set('api-version', '3.0');
        url.searchParams.set('to', mapTargetLangForAzure());

        const data = await proxyFetchJson({
            url: url.toString(),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Ocp-Apim-Subscription-Key': providerConfig.key,
                'Ocp-Apim-Subscription-Region': providerConfig.region,
                'X-ClientTraceId': crypto?.randomUUID?.() || String(Date.now()),
            },
            body: JSON.stringify(texts.map(text => ({ text }))),
        });

        return {
            translations: (data || []).map(item => (item?.translations?.[0]?.text || '').trim()),
            tokens: 0,
        };
    }

    async function translateWithQwenMt(texts, providerConfig) {
        const translations = [];
        let tokens = 0;

        for (const text of texts) {
            const data = await proxyFetchJson({
                url: providerConfig.url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${providerConfig.key}`,
                },
                body: JSON.stringify({
                    model: providerConfig.model,
                    messages: [{ role: 'user', content: text }],
                    translation_options: {
                        source_lang: 'auto',
                        target_lang: 'Chinese',
                    },
                }),
            });

            const firstChoice = data?.choices?.[0] || {};
            const content = firstChoice?.message?.content ?? firstChoice?.text;
            const translated = Array.isArray(content)
                ? content.map(part => part?.text || '').join('')
                : String(content || '').trim();

            translations.push(translated);
            tokens += getReadmeUsageTokens(data);
        }

        return { translations, tokens };
    }

    async function translateWithOpenAiCompatible(texts, providerConfig) {
        const targetLanguage = '简体中文';

        const payload = {
            model: providerConfig.model,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: OPENAI_README_SYSTEM_PROMPT,
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        target_language: targetLanguage,
                        texts,
                    }),
                },
            ],
        };
        applyOpenAiCompatibleRequestOptions(payload, providerConfig);

        const data = await proxyFetchJson({
            url: providerConfig.url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${providerConfig.key}`,
            },
            body: JSON.stringify(payload),
        });

        const firstChoice = data?.choices?.[0] || {};
        const content = firstChoice?.message?.content ?? firstChoice?.text;
        const raw = Array.isArray(content)
            ? content.map(part => part?.text || '').join('')
            : String(content || '').trim();

        return {
            translations: parseOpenAiArray(raw, texts.length),
            tokens: getReadmeUsageTokens(data),
        };
    }

    function parseOpenAiArray(rawText, expectedLength) {
        let text = (rawText || '').trim();
        text = stripOpenAiReasoningBlocks(text);
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
            text = text.slice(start, end + 1);
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('OpenAI 兼容接口返回内容不是合法 JSON 数组。');
        }

        if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.translations)) parsed = parsed.translations;
            else if (Array.isArray(parsed.data)) parsed = parsed.data;
            else if (Array.isArray(parsed.results)) parsed = parsed.results;
        }

        if (!Array.isArray(parsed)) {
            throw new Error('OpenAI 兼容接口返回内容不是数组（或未包含 translations/data/results 数组字段）。');
        }

        if (parsed.length !== expectedLength) {
            throw new Error(`OpenAI 兼容接口返回数量不匹配，期望 ${expectedLength}，实际 ${parsed.length}`);
        }

        return parsed.map(item => String(item ?? '').trim());
    }

    function stripOpenAiReasoningBlocks(text) {
        return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    async function proxyFetchJson(request) {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'ghcn-proxy-fetch',
                payload: request,
            }, (message) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(normalizeRuntimeErrorMessage(chrome.runtime.lastError)));
                    return;
                }

                resolve(message);
            });
        });

        if (!response) {
            throw new Error('翻译请求失败：后台未返回响应。');
        }

        const { ok, status, statusText, body, error } = response;
        if (!ok) {
            const details = body ? truncateText(body, 200) : (error || 'unknown error');
            throw new Error(`翻译请求失败 (${status} ${statusText}): ${details}`);
        }

        if (!body) return null;

        try {
            return JSON.parse(body);
        } catch {
            throw new Error(`接口返回非 JSON 数据: ${truncateText(body, 180)}`);
        }
    }

    function mapTargetLangForDeepL() {
        return 'ZH';
    }

    function mapTargetLangForAzure() {
        return 'zh-Hans';
    }

    function normalizeOpenAiEndpoint(url) {
        if (!url) return '';

        const parsedUrl = parseApiUrl(url);
        if (!parsedUrl) return url;

        const hostname = parsedUrl.hostname.toLowerCase();
        const path = parsedUrl.pathname.replace(/\/+$/, '');
        if (/\/chat\/completions$/i.test(path)) {
            return `${parsedUrl.origin}${path}`;
        }

        if (!path) {
            return `${parsedUrl.origin}${getProviderDefaultBasePath(hostname)}/chat/completions`;
        }

        return `${parsedUrl.origin}${path}/chat/completions`;
    }

    function parseApiUrl(url) {
        try {
            return new URL(url);
        } catch {
            return null;
        }
    }

    function getProviderDefaultBasePath(hostname) {
        if (hostname === 'api.deepseek.com') return '';
        if (/^dashscope(?:-(?:us|intl|finance))?\.aliyuncs\.com$/i.test(hostname)) return '/compatible-mode/v1';
        if (hostname === 'open.bigmodel.cn') return '/api/paas/v4';
        if (/^ark\.[^.]+\.volces\.com$/i.test(hostname)) return '/api/v3';
        if (
            hostname === 'api.openai.com'
            || hostname === 'api.minimaxi.com'
            || hostname === 'api.minimax.io'
            || hostname === 'api.moonshot.ai'
        ) {
            return '/v1';
        }

        return '/v1';
    }

    function getProviderHost(url) {
        return parseApiUrl(url)?.hostname.toLowerCase() || '';
    }

    function isDeepSeekEndpoint(url) {
        return getProviderHost(url) === 'api.deepseek.com';
    }

    function isQwenEndpoint(url) {
        return /^dashscope(?:-(?:us|intl|finance))?\.aliyuncs\.com$/i.test(getProviderHost(url));
    }

    function isMiniMaxEndpoint(url) {
        const host = getProviderHost(url);
        return host === 'api.minimaxi.com' || host === 'api.minimax.io';
    }

    function isKimiEndpoint(url) {
        return getProviderHost(url) === 'api.moonshot.ai';
    }

    function isZhipuEndpoint(url) {
        return getProviderHost(url) === 'open.bigmodel.cn';
    }

    function applyOpenAiCompatibleRequestOptions(payload, providerConfig) {
        if (!payload) return payload;

        if (isDeepSeekEndpoint(providerConfig?.url) || isKimiEndpoint(providerConfig?.url)) {
            payload.stream = false;
            payload.thinking = { type: 'disabled' };
        } else if (isQwenEndpoint(providerConfig?.url)) {
            payload.stream = false;
            payload.enable_thinking = false;
        } else if (isMiniMaxEndpoint(providerConfig?.url)) {
            payload.stream = false;
            payload.reasoning_split = true;
        } else if (isZhipuEndpoint(providerConfig?.url)) {
            payload.stream = false;
            payload.thinking = { type: 'disabled' };
            payload.do_sample = false;
        }
        return payload;
    }

    function normalizeUrl(url) {
        return (url || '').trim().replace(/\s+/g, '');
    }

    function decodeHtmlEntities(text) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    function truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text || '';
        return `${text.slice(0, maxLength)}...`;
    }

    function createHash(input) {
        let hash = 0;
        for (let i = 0; i < input.length; i += 1) {
            hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
        }
        return (hash >>> 0).toString(16);
    }

    /**
     * init 函数：初始化翻译功能。
     */
    async function init() {
        if (typeof I18N === 'undefined') {
            throw new Error('词库文件 locals.js 未加载，脚本无法运行');
        }

        await loadFeatureSet();
        watchFeatureChanges();
        setupReactGlobalNavTranslation();

        // 设置中文环境
        if (FeatureSet.enable_extension) {
            document.documentElement.lang = CONFIG.LANG;
        }

        // 监测 HTML Lang 值, 设置中文环境
        new MutationObserver(() => {
            if (FeatureSet.enable_extension && document.documentElement.lang === 'en') {
                document.documentElement.lang = CONFIG.LANG;
            }
        }).observe(document.documentElement, { attributeFilter: ['lang'] });

        // 监听 Turbo 完成事件（延迟翻译）
        document.addEventListener('turbo:load', () => {
            updatePageConfig('turbo:load');
            scheduleIssuePrTranslationControls('turbo:load');
            if (!FeatureSet.enable_extension || !pageConfig.currentPageType) return;

            transTitle(); // 翻译页面标题
            transBySelector();
            scheduleReadmeTranslation('turbo:load');
        });

        // 首次页面翻译
        window.addEventListener('DOMContentLoaded', () => {
            // 获取当前页面的翻译规则
            updatePageConfig('首次载入');
            if (FeatureSet.enable_extension && pageConfig.currentPageType) {
                traverseNode(document.body);
            }

            // 监视页面变化
            watchUpdate();
            watchReactHydration();
            scheduleReadmeTranslation('DOMContentLoaded');
            scheduleIssuePrTranslationControls('DOMContentLoaded');
        });
    }

})(window, document);
