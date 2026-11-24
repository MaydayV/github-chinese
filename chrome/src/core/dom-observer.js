/**
 * @file chrome/src/core/dom-observer.js
 * DOM 监听与 SPA 路由跳转守卫：MutationObserver、Turbo 监听与 DOM 遍历
 */

    function getDocUrlNoHashFallback() {
        if (typeof getDocumentUrlWithoutHash === 'function') {
            return getDocumentUrlWithoutHash();
        }
        const href = String(window?.location?.href || '');
        if (!href) return '';
        if (typeof URL === 'function') {
            try {
                const parsed = new URL(href);
                parsed.hash = '';
                return parsed.href;
            } catch { /* 忽略非法 URL */ }
        }
        return href.split('#')[0];
    }

    let lastHistoryDocUrl = typeof window !== 'undefined' ? getDocUrlNoHashFallback() : '';

    // 初始化
    init().catch(err => {
        if (typeof isExtensionContextInvalidatedError === 'function' && isExtensionContextInvalidatedError(err)) return;
        console.error('初始化失败:', err);
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'ghcn-current-page') {
            const scope = window.location.hostname + window.location.pathname;
            sendResponse({ scope, excluded: isPageExcluded(), inheritedExclusion: maintenanceData.excluded.some(rule => rule !== scope && GhcnMaintenance.matches(rule, window.location)) });
            return false;
        }
        if (message?.type === 'refresh-page') {
            window.location.reload();
        }
    });

    async function loadFeatureSet() {
        await loadMaintenanceSettings();
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
        scheduleCollaborationHelperControls('refreshCurrentPageTranslations');
        scheduleTldrCapsuleControls('refreshCurrentPageTranslations');
    }

    function restoreAllExtensionFeatures() {
        if (typeof readmeRuntime === 'object') {
            readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
        }
        if (typeof issuePrRuntime === 'object') {
            issuePrRuntime.runEpoch = (issuePrRuntime.runEpoch || 0) + 1;
        }
        if (typeof restoreChineseReadme === 'function') restoreChineseReadme();
        if (typeof restoreReadmeTranslation === 'function') restoreReadmeTranslation();
        if (typeof restoreIssuePrTranslations === 'function') restoreIssuePrTranslations();
        if (typeof restoreCollaborationHelperControls === 'function') restoreCollaborationHelperControls();
        if (typeof restoreTldrCapsuleControls === 'function') restoreTldrCapsuleControls();
    }

    /**
     * Turbo 软导航后整页/片段可能被替换为未翻译英文，且返回时 react-partial
     * 往往已是 .loaded，hydration watcher 不会再触发。MutationObserver 也可能
     * 输给随后的 React reconcile。因此在 turbo:load 后做短延迟全量扫描。
     */
    let turboPageTimers = [];
    function translateTurboSettledDom() {
        if (!FeatureSet.enable_extension || !pageConfig.currentPageType || !document.body) return;
        traverseNode(document.body);
        transTitle();
        transBySelector();
    }

    function scheduleTurboPageTranslation() {
        turboPageTimers.forEach(id => window.clearTimeout(id));
        turboPageTimers = [];
        translateTurboSettledDom();
        scheduleReactGlobalNavRefresh();
        [80, 250, 800, 1800].forEach(delay => {
            turboPageTimers.push(window.setTimeout(translateTurboSettledDom, delay));
        });
    }

    function isReadmeSettingKey(key) {
        return key === 'enable_readme_translation'
            || key === 'enable_issue_pr_translation'
            || key === 'enable_collaboration_helper'
            || key === 'enable_repo_tldr'
            || key.startsWith('readme_');
    }

    let featureChangeTimer = 0;
    const pendingChangedKeys = new Set();

    function applyBatchedFeatureToggles(changedKeys) {
        if (!changedKeys.length) return;
        if (changedKeys.includes('prefer_chinese_readme')) {
            if (!FeatureSet.prefer_chinese_readme) restoreChineseReadme();
            scheduleReadmeTranslation('setting:prefer_chinese_readme');
        }

        // 1. 全局开关状态变化处理
        if (changedKeys.includes('enable_extension')) {
            const isEnabled = Boolean(FeatureSet.enable_extension);
            if (isEnabled) {
                document.documentElement.lang = CONFIG.LANG;
                refreshCurrentPageTranslations();
            } else {
                restoreAllExtensionFeatures();
            }
        }

        // 2. 批量处理 README / AI 设置变更，单批次仅执行一次重置与调度
        const hasReadmeSettingsChange = changedKeys.some(isReadmeSettingKey);
        if (hasReadmeSettingsChange) {
            readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
            if (typeof issuePrRuntime === 'object') {
                issuePrRuntime.runEpoch = (issuePrRuntime.runEpoch || 0) + 1;
            }
            readmeRuntime.translationCache.clear();
            readmeRuntime.preservedCache.clear();
            if (changedKeys.includes('readme_enable_repo_cache') && !FeatureSet.readme_enable_repo_cache) {
                readmeRuntime.repoCacheMap.clear();
                readmeRuntime.repoCacheLoaded = false;
            }

            const hasProviderSettingChange = changedKeys.some(key => key.startsWith('readme_')
                && !['readme_enable_token_record', 'readme_enable_repo_cache', 'readme_enable_progressive', 'readme_enable_debug'].includes(key));
            if (hasProviderSettingChange && typeof restoreReadmeTranslation === 'function') {
                restoreReadmeTranslation();
            }

            const triggerKey = changedKeys.find(isReadmeSettingKey) || 'batch';

            if (FeatureSet.enable_extension && FeatureSet.enable_readme_translation) {
                scheduleReadmeTranslation(`setting:${triggerKey}`);
            } else {
                restoreReadmeTranslation();
            }

            if (FeatureSet.enable_extension && FeatureSet.enable_issue_pr_translation) {
                scheduleIssuePrTranslationControls(`setting:${triggerKey}`);
            } else if (changedKeys.includes('enable_issue_pr_translation')) {
                restoreIssuePrTranslations();
            }

            if (FeatureSet.enable_extension && FeatureSet.enable_collaboration_helper) {
                scheduleCollaborationHelperControls(`setting:${triggerKey}`);
            } else if (changedKeys.includes('enable_collaboration_helper')) {
                restoreCollaborationHelperControls();
            }

            if (FeatureSet.enable_extension && FeatureSet.enable_repo_tldr) {
                scheduleTldrCapsuleControls(`setting:${triggerKey}`);
            } else if (changedKeys.includes('enable_repo_tldr')) {
                restoreTldrCapsuleControls();
            }
        }
    }

    function handleFeatureToggle(key, newFeatureState) {
        FeatureSet[key] = newFeatureState;
        applyBatchedFeatureToggles([key]);
    }

    function watchFeatureChanges() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes[README_LOCAL_STORAGE_KEYS.REPO_CACHE]) {
                readmeRuntime.repoCacheMap.clear();
                readmeRuntime.repoCacheLoaded = false;
                if (FeatureSet.readme_enable_repo_cache && typeof normalizeRepoCacheEntries === 'function') {
                    const normalizedEntries = normalizeRepoCacheEntries(changes[README_LOCAL_STORAGE_KEYS.REPO_CACHE].newValue);
                    normalizedEntries.forEach((entry) => {
                        readmeRuntime.repoCacheMap.set(entry.key, entry);
                    });
                    readmeRuntime.repoCacheLoaded = true;
                }
                return;
            }
            if (areaName === 'local' && changes[GhcnMaintenance.DATA_KEY]) {
                try { maintenanceData = GhcnMaintenance.validateData(changes[GhcnMaintenance.DATA_KEY].newValue || {}); }
                catch { return; }
                pageConfig.textCache?.clear();
                customWrites = new WeakMap();
                if (!FeatureSet.enable_extension) {
                    restoreAllExtensionFeatures();
                } else {
                    refreshCurrentPageTranslations();
                }
                return;
            }
            if (areaName !== 'sync') return;

            let hasValidChange = false;
            Object.entries(changes).forEach(([key, change]) => {
                if (!(key in FeatureSet)) return;
                const nextValue = Object.hasOwn(change, 'newValue') && change.newValue !== undefined
                    ? change.newValue
                    : STORAGE_DEFAULTS[key];
                FeatureSet[key] = nextValue;
                pendingChangedKeys.add(key);
                hasValidChange = true;
            });

            if (!hasValidChange) return;

            // 60ms 微防抖，合并 options 页保存时多项配置同时写入的多次 onChanged 触发，防止多 Tab 页面同时频繁重绘闪烁
            if (featureChangeTimer) {
                window.clearTimeout(featureChangeTimer);
            }

            featureChangeTimer = window.setTimeout(() => {
                featureChangeTimer = 0;
                const keys = [...pendingChangedKeys];
                pendingChangedKeys.clear();
                applyBatchedFeatureToggles(keys);
            }, 60);
        });
    }

    // 更新页面设置
    function updatePageConfig(currentPageChangeTrigger, force = false) {
        const newType = detectPageType();
        if (!newType) {
            pageConfig = {};
            return;
        }
        if (force || newType !== pageConfig.currentPageType) {
            pageConfig = buildPageConfig(newType);
            scheduleReadmeTranslation(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleIssuePrTranslationControls(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleCollaborationHelperControls(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleTldrCapsuleControls(`${currentPageChangeTrigger}:pageTypeChanged`);
        }
    }

    function refreshAfterHistoryNavigation(trigger = '历史导航') {
        const currentDocUrl = getDocUrlNoHashFallback();
        const docUrlChanged = Boolean(lastHistoryDocUrl && currentDocUrl && currentDocUrl !== lastHistoryDocUrl);
        if (currentDocUrl) lastHistoryDocUrl = currentDocUrl;
        if (docUrlChanged) {
            if (typeof closeCollaborationModal === 'function') {
                closeCollaborationModal();
            }
            if (typeof resetTldrRuntimeForNavigation === 'function') {
                resetTldrRuntimeForNavigation();
            }
        }
        if (!FeatureSet.enable_extension || !document.body) {
            restoreAllExtensionFeatures();
            return;
        }

        readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
        if (typeof issuePrRuntime === 'object') {
            issuePrRuntime.runEpoch = (issuePrRuntime.runEpoch || 0) + 1;
        }
        updatePageConfig(trigger, true);
        refreshPageObserver();
        scheduleTurboPageTranslation();
        scheduleReadmeTranslation(trigger);
        scheduleIssuePrTranslationControls(trigger);
        scheduleCollaborationHelperControls(trigger);
        scheduleTldrCapsuleControls(trigger);
    }

    function scheduleHistoryRefresh(event) {
        const currentDocUrl = getDocUrlNoHashFallback();
        if (event?.type === 'popstate' && lastHistoryDocUrl && currentDocUrl === lastHistoryDocUrl) {
            return;
        }
        if (historyRefreshTimer !== null) window.clearTimeout(historyRefreshTimer);
        historyRefreshTimer = window.setTimeout(() => {
            historyRefreshTimer = null;
            refreshAfterHistoryNavigation(event?.type || '历史导航');
        }, 0);
    }

    // 构建页面设置 pageConfig 对象
    function buildPageConfig(pageType = pageConfig.currentPageType) {
        return {
            // 当前页面类型
            currentPageType: pageType,
            textCache: new Map(),
            attributeTranslations: I18N[CONFIG.LANG][pageType]?.attributes || [],
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
            maxTextNodeLength: I18N.conf.maxTextNodeLengthPage?.[pageType] ?? 500,
            // CSS 选择器规则
            tranSelectors: [
                ...(I18N[CONFIG.LANG].public.selector || []),
                ...(I18N[CONFIG.LANG][pageType]?.selector || [])
            ],
        };
    }


    function getPageObserverConfig() {
        return {
            ...CONFIG.OBSERVER_CONFIG,
            attributeFilter: [...new Set([
                ...CONFIG.OBSERVER_CONFIG.attributeFilter,
                ...(pageConfig.attributeTranslations || []).map(([, name]) => name),
            ])],
        };
    }

    function watchUpdate() {
        const readDocUrlWithoutHash = () => {
            if (typeof getDocumentUrlWithoutHash === 'function') {
                return getDocumentUrlWithoutHash();
            }
            const href = String(window?.location?.href || '');
            if (!href) return '';
            if (typeof URL === 'function') {
                try {
                    const parsed = new URL(href);
                    parsed.hash = '';
                    return parsed.href;
                } catch { /* 忽略非法 URL */ }
            }
            return href.split('#')[0];
        };
        // 缓存当前页面的 URL（忽略 #hash 锚点变化）
        let previousURL = readDocUrlWithoutHash();
        let observer = null;
        let observedBody = null;
        let observedAttributes = '';

        const handleUrlChange = () => {
            const currentURL = readDocUrlWithoutHash();
            // 如果页面的文档 URL（不含 #hash）发生变化
            if (currentURL !== previousURL) {
                previousURL = currentURL;
                if (typeof lastHistoryDocUrl !== 'undefined') {
                    lastHistoryDocUrl = currentURL;
                }
                if (typeof closeCollaborationModal === 'function') {
                    closeCollaborationModal();
                }
                if (typeof resetTldrRuntimeForNavigation === 'function') {
                    resetTldrRuntimeForNavigation();
                }
                if (typeof readmeRuntime === 'object') {
                    readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
                }
                if (typeof issuePrRuntime === 'object') {
                    issuePrRuntime.runEpoch = (issuePrRuntime.runEpoch || 0) + 1;
                }
                if (!FeatureSet.enable_extension) {
                    if (typeof restoreAllExtensionFeatures === 'function') {
                        restoreAllExtensionFeatures();
                    }
                    return;
                }
                updatePageConfig('DOM变化', true);
                refreshPageObserver();
            }
        }

        // textarea 可能位于 header.GlobalNav 等忽略祖先下，但其 placeholder 和 aria-label
        // 仍是控件文案；value、子文本和 contenteditable 内容继续保持不翻译。
        const LIVE_SURFACE_SELECTOR = [
            '[role="menu"]',
            '[role="listbox"]',
            '[role="dialog"]',
            '[role="tooltip"]',
            'details-menu',
            '.Popover',
            '.dropdown-menu',
        ].join(', ');
        const SEARCH_QUERY_SELECTOR = [
            '#search-suggestions-dialog',
            '[aria-label="Quick search"]',
            '[aria-label="Search suggestions"]',
            'header.GlobalNav [class*="Search-module__"]',
            'qbsearch-input',
            '.QueryBuilder-StyledInputContainer',
            '#qb-input-query',
            '.styled-input-content',
            '[data-testid="quick-search-input-overlay"]',
        ].join(', ');

        const isLiveSurfaceCharacterData = node => {
            if (node?.nodeType !== Node.TEXT_NODE || !node.parentElement) return false;
            const parent = node.parentElement;
            if (parent.closest?.(`textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], ${SEARCH_QUERY_SELECTOR}`)) {
                return false;
            }
            return Boolean(parent.closest?.(LIVE_SURFACE_SELECTOR));
        };

        const shouldTranslateTextareaChrome = (node, type, attributeName) => {
            if (node?.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'TEXTAREA') return false;
            if (type === 'childList') return true;
            return type === 'attributes'
                && (attributeName === 'placeholder' || attributeName === 'aria-label');
        };

        const processMutations = mutations => {
            // 平铺突变记录并过滤需要处理的节点（链式操作）
            // 使用 mutations.flatMap 进行筛选突变:
            //   1. 针对`节点增加`突变，后期迭代翻译的对象调整为`addedNodes`中记录的新增节点，而不是`target`，此举大幅减少重复迭代翻译
            //   2. 对于其它`属性`和特定页面`文本节点`突变，仍旧直接处理`target`
            //   3. 使用`.filter()`筛选丢弃特定页面`特定忽略元素`内突变的节点
            mutations.flatMap(({ target, addedNodes, type, attributeName }) => {
                // 处理子节点添加的情况
                if (type === 'childList' && addedNodes.length > 0) {
                    return [...addedNodes].map(node => ({ node, type, attributeName })); // 将新增节点转换为数组
                }
                // 处理属性和文本内容变更的情况
                return (type === 'attributes'
                    || (type === 'characterData' && (pageConfig.characterData || isLiveSurfaceCharacterData(target))))
                    ? [{ node: target, type, attributeName }] // 否则，仅处理目标节点
                    : [];
            })
            // 过滤需要忽略的突变节点
            .filter(({ node, type, attributeName }) => {
                const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                return shouldTranslateTextareaChrome(node, type, attributeName) || (element
                    && !element.closest?.(pageConfig.ignoreMutationSelectors)
                    && (!isReactGlobalNavPortalNode(element)
                        || (type === 'characterData' && isLiveSurfaceCharacterData(node))));
            })
            // 处理每个变化
            .forEach(({ node, type }) =>
                // 递归遍历节点树进行处理；属性变化仅更新目标元素自身属性，避免误扫整棵子树
                traverseNode(node, type === 'attributes')
            );
        }

        // 监听 document.body 下 DOM 变化，用于处理节点变化
        const processMutationBatch = mutations => {
            if (!FeatureSet.enable_extension) return;
            handleUrlChange();
            if (!FeatureSet.enable_extension) return;
            if (readmeRuntime.isApplyingTranslation) return;
            if (pageConfig.currentPageType) processMutations(mutations);
            if (FeatureSet.enable_readme_translation) {
                scheduleReadmeTranslation('mutation');
            } else if (FeatureSet.prefer_chinese_readme && typeof isReadmePage === 'function' && isReadmePage()) {
                const currentReadmeRoot = typeof getReadmeRootElement === 'function' ? getReadmeRootElement() : null;
                const currentUrl = readDocUrlWithoutHash();
                const mountedForPage = typeof chineseReadme !== 'undefined'
                    && chineseReadme.state?.root === currentReadmeRoot
                    && (!chineseReadme.state?.pageUrl || !currentUrl || chineseReadme.state.pageUrl === currentUrl);
                const hasMapBypass = typeof chineseReadme !== 'undefined' && typeof chineseReadme.bypass?.get === 'function';
                const bypassEntry = (hasMapBypass && currentReadmeRoot) ? chineseReadme.bypass.get(currentReadmeRoot) : undefined;
                const bypassed = typeof chineseReadme !== 'undefined' && Boolean(
                    hasMapBypass
                        ? (bypassEntry && (!currentUrl || bypassEntry === currentUrl))
                        : (currentReadmeRoot && chineseReadme.bypass?.has?.(currentReadmeRoot)),
                );
                if (currentReadmeRoot
                    ? (!mountedForPage && !bypassed)
                    : Boolean(typeof chineseReadme !== 'undefined' && chineseReadme.state)) {
                    scheduleReadmeTranslation('mutation');
                }
            }
            if (FeatureSet.enable_issue_pr_translation) {
                scheduleIssuePrTranslationControls('mutation');
            }
            if (FeatureSet.enable_collaboration_helper) {
                scheduleCollaborationHelperControls('mutation');
            }
            if (FeatureSet.enable_repo_tldr) {
                scheduleTldrCapsuleControls('mutation');
            }
        };

        const observeCurrentBody = () => {
            if (observer) observer.disconnect();
            observedBody = document.body;
            const observerConfig = getPageObserverConfig();
            observedAttributes = observerConfig.attributeFilter.join(',');
            if (observedBody) observer.observe(observedBody, observerConfig);
        };

        observer = new MutationObserver(processMutationBatch);
        observeCurrentBody();
        refreshPageObserver = () => {
            if (document.body !== observedBody
                || getPageObserverConfig().attributeFilter.join(',') !== observedAttributes) observeCurrentBody();
            if (typeof refreshHydrationObserver === 'function') refreshHydrationObserver();
        };
    }

    /**
     * GitHub 的 SSR React 组件在 hydration 完成后才添加 loaded 类。
     * 在此之前改写文本会造成 hydration 失败，并让组件交互失效。
     */
    function watchReactHydration() {
        const handledLoadedRoots = new WeakSet();
        const handleLoadedReactRoot = element => {
            if (
                !FeatureSet.enable_extension
                || !pageConfig.currentPageType
                || !element.matches?.('react-app.loaded, react-partial.loaded')
                || handledLoadedRoots.has(element)
            ) {
                return;
            }
            handledLoadedRoots.add(element);

            traverseNode(element);
            scheduleReadmeTranslation('react:hydrated');
        };

        let observedHydrationBody = null;
        const observer = new MutationObserver(mutations => {
            mutations.forEach(({ target, type }) => {
                if (type === 'attributes') handleLoadedReactRoot(target);
            });
        });

        const observeHydrationBody = () => {
            if (!document.body || document.body === observedHydrationBody) return;
            observer.disconnect();
            observedHydrationBody = document.body;
            observer.observe(observedHydrationBody, {
                attributes: true,
                subtree: true,
                attributeFilter: ['class'],
            });
            document.querySelectorAll('react-app.loaded, react-partial.loaded').forEach(handleLoadedReactRoot);
        };

        refreshHydrationObserver = observeHydrationBody;
        observeHydrationBody();
    }

    /**
     * traverseNode 函数：遍历指定的节点，并对节点进行翻译。
     * @param {Node} rootNode - 需要遍历的节点。
     * @param {boolean} [attributesOnly=false] - 仅同步根节点属性（用于属性变更回调）。
     */
    function traverseNode(rootNode, attributesOnly = false) {
        if (!FeatureSet.enable_extension || !rootNode) return;

        const handleTextNode = node => {
            if (node.length > (pageConfig.maxTextNodeLength ?? 500)) return;
            transElement(node, 'data');
        }

        // textarea 的文本子节点就是用户正在输入的内容，翻译它会直接篡改输入。
        // 这里单独拦文本节点，而不是把 textarea 放进 ignoreSelectors，
        // 否则 handleElement 里的 placeholder / value 属性翻译会被一并跳过。
        const isUserInputText = node => node.parentElement?.tagName === 'TEXTAREA';

        // 如果 rootNode 是文本节点，先检查 ignoreSelectors 再处理
        if (rootNode.nodeType === Node.TEXT_NODE) {
            if (pageConfig.ignoreSelectors && rootNode.parentElement?.closest?.(pageConfig.ignoreSelectors)) return;
            if (!isUserInputText(rootNode)) handleTextNode(rootNode);
            return; // 文本节点没有子节点，直接返回
        }

        const handleElement = node => {
            applyCustomAttributes(node);
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
                    transElement(node, 'ariaLabel');
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
                    if (/tooltipped/.test(node.className)) transElement(node, 'ariaLabel');
                    break;

                case 'A':
                case 'SPAN':
                    transElement(node, 'title'); // title 属性
                    transElement(node.dataset, 'visibleText'); // 翻译 浏览器 提示对话框 ok
                    if (/tooltipped/.test(node.className)) transElement(node, 'ariaLabel');
                    break;

                default:
                    // 仅当 元素存在'tooltipped'样式 aria-label 才起效果
                    if (/tooltipped/.test(node.className)) transElement(node, 'ariaLabel'); // 带提示的元素，类似 tooltip 效果的
                    break;
            }
        }

        // TreeWalker 不会访问根节点；textarea 根节点仍需翻译控件文案，但不遍历输入内容。
        if (rootNode.nodeType === Node.ELEMENT_NODE && rootNode.tagName === 'TEXTAREA') {
            handleElement(rootNode);
            return;
        }

        if (pageConfig.ignoreSelectors && rootNode.closest?.(pageConfig.ignoreSelectors)) {
            return;
        }

        // 属性变化的目标本身不会被 TreeWalker.nextNode() 访问，非 TEXTAREA 根节点也需检查其属性和自身标签。
        const attributeTranslations = pageConfig.attributeTranslations;
        const translateAttributes = Boolean(attributeTranslations?.length);
        if (rootNode.nodeType === Node.ELEMENT_NODE) {
            if (translateAttributes) {
                transPageAttributes(rootNode, attributeTranslations);
            }
            handleElement(rootNode);
            if (attributesOnly) return;
        }

        const treeWalker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            node => {
                // 跳过用户输入内容
                if (node.nodeType === Node.TEXT_NODE) {
                    return isUserInputText(node)
                        ? NodeFilter.FILTER_REJECT
                        : NodeFilter.FILTER_ACCEPT;
                }
                // 跳过忽略的节点
                return node.matches?.(pageConfig.ignoreSelectors)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            },
        );

        // 预绑定处理函数提升性能
        const handlers = {
            [Node.ELEMENT_NODE]: handleElement,
            [Node.TEXT_NODE]: handleTextNode
        };

        let currentNode;
        while ((currentNode = treeWalker.nextNode())) {
            if (translateAttributes && currentNode.nodeType === Node.ELEMENT_NODE) {
                transPageAttributes(currentNode, attributeTranslations);
            }
            handlers[currentNode.nodeType]?.(currentNode);
        }
    }

    /**
     * detectPageType 函数：检测当前页面类型，基于URL、元素类名和meta信息。
     * @returns {string|boolean} 页面的类型，如'repository'、'dashboard'等，如果无法确定类型，那么返回 false。
     */
