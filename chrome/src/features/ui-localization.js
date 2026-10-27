/**
 * @file chrome/src/features/ui-localization.js
 * 静态界面词库汉化：基于 locals.js 的 DOM 翻译、相对时间转换、React 全局顶栏适配
 */

    function isReactGlobalNavPortalNode(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (element?.matches?.('#search-suggestions-dialog, [aria-label="Quick search"], [aria-label="Search suggestions"]')
            || element?.querySelector?.('#search-suggestions-dialog, [aria-label="Quick search"], [aria-label="Search suggestions"]')) {
            return true;
        }

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
            && !!document.activeElement?.closest?.('header.GlobalNav, qbsearch-input, #__primerPortalRoot__, [role="dialog"]');
    }

    function setupReactGlobalNavTranslation() {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;

        const labels = I18N.conf.reactGlobalNavLabels || {};
        const dataContentLabelSelector = 'header.GlobalNav [data-component="text"][data-content]';
        const portalSurfaceSelector = [
            '#__primerPortalRoot__ [role="menu"]',
            '#__primerPortalRoot__ [role="dialog"]',
            '#__primerPortalRoot__ [role="tooltip"]',
            '#search-suggestions-dialog',
            '[aria-label="Quick search"]',
            '[aria-label="Search suggestions"]',
        ].join(', ');
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
            if (!FeatureSet.enable_extension || !surface) return;

            // textarea 只翻译控件文案，拒绝遍历子节点，避免改写用户输入内容。
            if (surface.nodeType === Node.ELEMENT_NODE && surface.tagName === 'TEXTAREA') {
                translateReactGlobalNavAttributes(surface);
                return;
            }

            if (shouldSkipReactGlobalNavNode(surface)) return;

            if (surface.nodeType === Node.ELEMENT_NODE) {
                translateReactGlobalNavAttributes(surface);
            }

            const walker = document.createTreeWalker(
                surface,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TEXTAREA') {
                            translateReactGlobalNavAttributes(node);
                            return NodeFilter.FILTER_REJECT;
                        }
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

        // 顶部搜索按钮的占位文本把 <kbd> 混排在文字中间（Type <kbd>/</kbd> to search），
        // 逐个文本节点翻译会把词条拆碎，所以整体取译文后再按受保护片段回填。
        function translateReactGlobalNavSearchPlaceholder() {
            const placeholder = document.querySelector('header.GlobalNav [class*="Search-module__placeholder__"]');
            if (!placeholder) return;

            const label = translateReactGlobalNavText(placeholder.textContent);
            if (!label || normalizeReactGlobalNavText(placeholder.textContent) === label) return;

            const textNodeGroups = [[]];
            const protectedTexts = [];

            const collectNodes = node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    textNodeGroups[textNodeGroups.length - 1].push(node);
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                // 遇到 kbd 之类不可改写的元素，另起一段
                if (node.matches?.(unsafeTextSelector)) {
                    const protectedText = normalizeReactGlobalNavText(node.textContent);
                    if (protectedText) {
                        protectedTexts.push(protectedText);
                        textNodeGroups.push([]);
                    }
                    return;
                }
                node.childNodes.forEach(collectNodes);
            };
            placeholder.childNodes.forEach(collectNodes);

            // 用受保护片段把译文切段；切不出来说明词条和 DOM 对不上，直接放弃，别改坏
            const segments = [];
            let remaining = label;
            for (const protectedText of protectedTexts) {
                const index = remaining.indexOf(protectedText);
                if (index === -1) return;
                segments.push(remaining.slice(0, index));
                remaining = remaining.slice(index + protectedText.length);
            }
            segments.push(remaining);

            const hasNowhereToPut = segments.some((segment, index) =>
                normalizeReactGlobalNavText(segment) && !textNodeGroups[index]?.length);
            if (hasNowhereToPut) return;

            textNodeGroups.forEach((nodes, segmentIndex) => {
                nodes.forEach((node, nodeIndex) => {
                    node.data = nodeIndex === 0 ? segments[segmentIndex] : '';
                });
            });
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
            translateReactGlobalNavSearchPlaceholder();

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

        function translateReactGlobalNavPortalsSoon() {
            if (!FeatureSet.enable_extension) return;

            const translatePortals = () => {
                observeReactGlobalNav();
                translateReactGlobalNavPortals();
            };

            window.requestAnimationFrame(translatePortals);
            [80, 200].forEach(delay => {
                window.setTimeout(translatePortals, delay);
            });
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
                document.querySelector('#search-suggestions-dialog'),
                document.querySelector('[aria-label="Quick search"]'),
                document.querySelector('[aria-label="Search suggestions"]'),
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
        ['click', 'focusin', 'focusout', 'pointerover'].forEach(eventName => {
            document.addEventListener(eventName, () => {
                translateReactGlobalNavPortalsSoon();
                scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true });
            }, true);
        });
    }

    /**
     * watchUpdate 函数：监视页面变化，根据变化的节点进行翻译
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
        // analytics-location 带 data-turbo-transient，Turbo 软导航时可能暂时缺失。
        // 使用与当前 URL 一致的仓库元数据和两级路径结构兜底，避免仓库页整页跳过翻译。
        const repositoryNwo = document.head
            .querySelector('meta[name="octolytics-dimension-repository_nwo"]')
            ?.content?.trim() || '';
        const pathRepository = pathname.split('/').slice(1, 3).join('/');
        const hasRepositoryMetadata = hostname === 'github.com'
            && /^[^/]+\/[^/]+$/.test(repositoryNwo)
            && repositoryNwo.toLowerCase() === pathRepository.toLowerCase();
        const reservedFirstSegment = /^\/(?:home|dashboard|feed|copilot|spark|signup|account_verifications|login|logout|sessions?|password_reset|orgs|organizations|explore|topics|notifications|watching|stars|issues|pulls|repos|search|discussions|gist|sponsors|marketplace|apps|codespaces|developer|features|status|education|sitemap|mcp|settings|account|new|redeem|trending|collections|showcases|about|pricing|security|enterprise|customer-stories|site|support|learn|events|tools|edu|campus|git|contact|users|installations|billing|plans)\//i;
        const isRepository = /\/<user-name>\/<repo-name>/.test(metaLocation)
            || hasRepositoryMetadata
            || (site === 'github'
                && !reservedFirstSegment.test(pathname)
                && /^\/[^\/@?#]+\/[^\/@?#]+(?:\/|$)/.test(pathname));
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

        // 时间文本形如 "on Jul 15"，中文语序里不需要这个 on。
        // 前面可能带空白，所以不能只匹配 /^on/，否则会残留成「打开于 on 7月15日」。
        // 同时只改承载文本的那个节点，避免用 el.textContent 赋值抹掉同级节点。
        const target = el.childNodes.length > 0 ? el.lastChild : el;
        const text = target.textContent;
        if (!text) return;

        const translatedText = text.replace(/^(\s*)on\b\s*/, '$1');
        if (translatedText !== text) {
            target.textContent = translatedText;
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

