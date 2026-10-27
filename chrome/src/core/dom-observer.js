/**
 * @file chrome/src/core/dom-observer.js
 * DOM 监听与 SPA 路由跳转守卫：MutationObserver、Turbo 监听与 DOM 遍历
 */

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
        scheduleCollaborationHelperControls('refreshCurrentPageTranslations');
        scheduleTldrCapsuleControls('refreshCurrentPageTranslations');
    }

    /**
     * Turbo 软导航后整页/片段可能被替换为未翻译英文，且返回时 react-partial
     * 往往已是 .loaded，hydration watcher 不会再触发。MutationObserver 也可能
     * 输给随后的 React reconcile。因此在 turbo:load 后做短延迟全量扫描。
     */
    function translateTurboSettledDom() {
        if (!FeatureSet.enable_extension || !pageConfig.currentPageType || !document.body) return;
        traverseNode(document.body);
        transTitle();
        transBySelector();
    }

    function scheduleTurboPageTranslation() {
        translateTurboSettledDom();
        scheduleReactGlobalNavRefresh();
        [80, 250, 800, 1800].forEach(delay => {
            window.setTimeout(translateTurboSettledDom, delay);
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

        // 1. 全局开关状态变化处理
        if (changedKeys.includes('enable_extension')) {
            const isEnabled = Boolean(FeatureSet.enable_extension);
            if (isEnabled) {
                document.documentElement.lang = CONFIG.LANG;
                refreshCurrentPageTranslations();
            } else {
                restoreReadmeTranslation();
                restoreIssuePrTranslations();
                restoreCollaborationHelperControls();
                restoreTldrCapsuleControls();
            }
        }

        // 2. 批量处理 README / AI 设置变更，单批次仅执行一次重置与调度
        const hasReadmeSettingsChange = changedKeys.some(isReadmeSettingKey);
        if (hasReadmeSettingsChange) {
            readmeRuntime.translationCache.clear();
            if (changedKeys.includes('readme_enable_repo_cache') && !FeatureSet.readme_enable_repo_cache) {
                readmeRuntime.repoCacheMap.clear();
                readmeRuntime.repoCacheLoaded = false;
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
            if (areaName !== 'sync') return;

            let hasValidChange = false;
            Object.entries(changes).forEach(([key, change]) => {
                if (!(key in FeatureSet)) return;
                FeatureSet[key] = change.newValue;
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
        if (newType && (force || newType !== pageConfig.currentPageType)) {
            pageConfig = buildPageConfig(newType);
            scheduleReadmeTranslation(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleIssuePrTranslationControls(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleCollaborationHelperControls(`${currentPageChangeTrigger}:pageTypeChanged`);
            scheduleTldrCapsuleControls(`${currentPageChangeTrigger}:pageTypeChanged`);
        }
    }

    function refreshAfterHistoryNavigation(trigger = '历史导航') {
        if (!FeatureSet.enable_extension || !document.body) return;

        updatePageConfig(trigger, true);
        refreshPageObserver();
        scheduleTurboPageTranslation();
        scheduleReadmeTranslation(trigger);
        scheduleIssuePrTranslationControls(trigger);
        scheduleCollaborationHelperControls(trigger);
        scheduleTldrCapsuleControls(trigger);
    }

    function scheduleHistoryRefresh(event) {
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


    function watchUpdate() {
        // 缓存当前页面的 URL
        let previousURL = window.location.href;
        let observer = null;
        let observedBody = null;

        const handleUrlChange = () => {
            const currentURL = window.location.href;
            // 如果页面的 URL 发生变化
            if (currentURL !== previousURL) {
                previousURL = currentURL;
                updatePageConfig('DOM变化');
            }
        }

        // textarea 可能位于 header.GlobalNav 等忽略祖先下，但其 placeholder 和 aria-label
        // 仍是控件文案；value、子文本和 contenteditable 内容继续保持不翻译。
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
                return (type === 'attributes' || (type === 'characterData' && pageConfig.characterData))
                    ? [{ node: target, type, attributeName }] // 否则，仅处理目标节点
                    : [];
            })
            // 过滤需要忽略的突变节点
            .filter(({ node, type, attributeName }) => {
                const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                return shouldTranslateTextareaChrome(node, type, attributeName) || (element
                    && !element.closest?.(pageConfig.ignoreMutationSelectors)
                    && !isReactGlobalNavPortalNode(element));
            })
            // 处理每个变化
            .forEach(({ node }) =>
                // 递归遍历节点树进行处理
                traverseNode(node)
            );
        }

        // 监听 document.body 下 DOM 变化，用于处理节点变化
        const processMutationBatch = mutations => {
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
            if (observedBody) observer.observe(observedBody, CONFIG.OBSERVER_CONFIG);
        };

        observer = new MutationObserver(processMutationBatch);
        observeCurrentBody();
        refreshPageObserver = () => {
            if (document.body !== observedBody) observeCurrentBody();
        };
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

        // textarea 的文本子节点就是用户正在输入的内容，翻译它会直接篡改输入。
        // 这里单独拦文本节点，而不是把 textarea 放进 ignoreSelectors，
        // 否则 handleElement 里的 placeholder / value 属性翻译会被一并跳过。
        const isUserInputText = node => node.parentElement?.tagName === 'TEXTAREA';

        // 如果 rootNode 是文本节点，直接处理
        if (rootNode.nodeType === Node.TEXT_NODE) {
            if (!isUserInputText(rootNode)) handleTextNode(rootNode);
            return; // 文本节点没有子节点，直接返回
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
