(function (window, document, undefined) {
    'use strict';

    // ==========================================================================
    // [Module] core/constants.js
    // ==========================================================================

    const OPENAI_README_SYSTEM_PROMPT = `你是一个 GitHub README 翻译引擎。
请把输入数组中的英文文本翻译为目标中文语言，并严格遵守：
1. 保留 Markdown 语义，不要改动链接、URL、占位符、变量名、文件路径。
2. 代码片段、命令、配置键名和版本号保持不变。
3. 不要新增解释，不要总结，不要添加前后缀。
4. 返回 JSON 数组，长度与输入一致，顺序一致。`;

    /****************** 全局配置区（开发者可修改部分） ******************/
    const STORAGE_DEFAULTS = {
        enable_extension: true,
        prefer_chinese_readme: true,
        collect_ui_misses: false,
        enable_readme_translation: false,
        enable_issue_pr_translation: false,
        enable_collaboration_helper: false,
        enable_repo_tldr: false,
        readme_enable_token_record: false,
        readme_enable_repo_cache: false,
        readme_enable_progressive: false,
        readme_enable_debug: false,
        readme_provider: 'index_translate',
        readme_deepl_api_url: 'https://api-free.deepl.com/v2/translate',
        readme_deepl_api_key: '',
        readme_google_api_url: 'https://translation.googleapis.com/language/translate/v2',
        readme_google_api_key: '',
        readme_azure_api_url: 'https://api.cognitive.microsofttranslator.com/translate',
        readme_azure_api_key: '',
        readme_azure_region: '',
        readme_openai_api_url: 'https://api.deepseek.com',
        readme_openai_api_key: '',
        readme_openai_model: 'deepseek-flash',
        readme_qwen_mt_api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        readme_qwen_mt_api_key: '',
        readme_qwen_mt_model: 'qwen-mt-turbo',
        readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
        readme_index_translate_api_key: '',
        readme_index_translate_model: 'Index-Translate-35B-A3B',
    };

    const FeatureSet = new Proxy({ ...STORAGE_DEFAULTS }, {
        get(target, key) {
            return key === 'enable_extension' ? target[key] && !isPageExcluded() : target[key];
        },
    });

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
            '[class*="DirectoryRichtextContent"] article.markdown-body',
            'article.markdown-body.entry-content.container-lg[itemprop="text"]',
            'article.markdown-body.entry-content.container-lg',
            'article.markdown-body[itemprop="text"]'
        ],
        ABOUT_SELECTORS: [
            // 经典 UI
            '.f4.tmp-my-3',
            // React CSS module 侧栏（当前常见结构）
            'p[class*="SidebarAbout-module"][class*="description"]',
            // GitHub 改版后可能只保留 BorderGrid/description 哈希类
            '[class*="borderGrid__"] p[class*="description__"]',
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
            'button',
            '.snippet-clipboard-content',
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
        OPENAI_MAX_BATCH_ITEMS: 8,
        OPENAI_MAX_BATCH_CHARS: 3200,
        PROGRESSIVE_GROUP_SIZE: 16,
        OPENAI_PROGRESSIVE_GROUP_SIZE: 8,
        TRANSLATION_CONCURRENCY: 3,
        DEBOUNCE_MS: 700,
        RECORD_MAX_ENTRIES: 200,
        DEBUG_LOG_MAX_ENTRIES: 40,
        DEBUG_EVENT_MAX_ENTRIES: 240,
        DEBUG_TEXT_MAX_CHARS: 96,
        REPO_CACHE_MAX_ENTRIES: 24,
        MAX_CACHE_HTML_CHARS: 260000,
    };

    const README_LOCAL_STORAGE_KEYS = {
        TRANSLATION_RECORDS: 'ghcn_readme_translation_records',
        REPO_CACHE: 'ghcn_readme_repo_cache',
        DEBUG_LOGS: 'ghcn_readme_translation_debug_logs',
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
        runEpoch: 0,
        stateByElement: new WeakMap(),
        isApplyingTranslation: false,
        domMutationGuardDepth: 0,
        translationCache: new Map(),
        preservedCache: new Set(),
        repoCacheMap: new Map(),
        repoCacheLoaded: false,
        repoCacheLoadPromise: null,
        lastWarnKey: '',
    };

    const issuePrRuntime = {
        timerId: 0,
        inFlight: false,
        runEpoch: 0,
        stateByElement: new WeakMap(),
        lastWarnKey: '',
    };

    const collabRuntime = {
        timerId: 0,
        modalEl: null,
        modalCleanup: null,
    };

    const tldrRuntime = {
        timerId: 0,
        isBusy: false,
        genSeq: 0,
        mountSeq: 0,
        activeDocUrl: '',
        busyDocUrl: '',
        busyCard: null,
    };

    const FIXED_TARGET_LANG = 'zh-CN';
    const AI_CHAT_PROVIDERS = ['index_translate', 'openai', 'openai_compatible', 'deepseek', 'qwen', 'minimax', 'kimi', 'zhipu', 'volcengine'];

    let pageConfig = {};
    let scheduleReactGlobalNavRefresh = () => {};
    let refreshPageObserver = () => {};
    let refreshHydrationObserver = () => {};
    let historyRefreshTimer = null;

    // ==========================================================================
    // [Module] core/maintenance-tools.js
    // ==========================================================================

/* Shared validation for content scripts, settings and developer tools. */
var GhcnMaintenance = (() => {
    const DATA_KEY = 'ghcn_maintenance';
    const MISS_KEY = 'ghcn_ui_misses';
    const indexes = new WeakMap();
    const hosts = ['github.com', 'gist.github.com', 'skills.github.com', 'education.github.com', 'www.githubstatus.com'];
    function normalize(text) {
        return String(text || '').replace(/[\xa0\s]+/g, ' ').trim();
    }
    function scope(value) {
        const text = String(value || '').trim();
        if (text === '*') return text;
        if (text.length > 300 || /[?#\\\s]/.test(text)) throw new Error('页面范围不能包含查询参数、空格或反斜杠。');
        const match = text.match(/^([^/]+)(\/[^*]*)?(\*)?$/);
        if (!match || !hosts.includes(match[1])) throw new Error('范围格式：github.com/owner/repo/*，只允许末尾通配符。');
        return match[1] + (match[2] || '/') + (match[3] || '');
    }
    function matches(pattern, location) {
        if (pattern === '*') return true;
        const normalizedPattern = String(pattern || '').toLowerCase();
        const target = (String(location?.hostname || '') + String(location?.pathname || '')).toLowerCase();
        if (normalizedPattern.endsWith('*')) {
            const prefix = normalizedPattern.slice(0, -1);
            if (target.startsWith(prefix)) return true;
            const base = prefix.replace(/\/+$/, '');
            return Boolean(base && target === base);
        }
        return target.replace(/\/+$/, '') === normalizedPattern.replace(/\/+$/, '');
    }
    function validateData(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的词库配置。');
        const entries = input.entries ?? [];
        const excluded = input.excluded ?? [];
        if (!Array.isArray(entries) || entries.length > 1000 || !Array.isArray(excluded) || excluded.length > 100) throw new Error('最多 1000 条词条、100 条排除路径。');
        const seen = new Set();
        const validated = {
            entries: entries.map(item => {
                if (!item || typeof item.source !== 'string' || typeof item.target !== 'string') throw new Error('词条需要原文和译文。');
                const rawSource = item.source.trim(), rawTarget = item.target.trim(), page = scope(item.scope || '*');
                if (!rawSource || !rawTarget || /[\u0000-\u001f]/.test(rawSource + rawTarget)) throw new Error('词条为空、过长或包含控制字符。');
                const source = normalize(rawSource), target = rawTarget;
                if (!source || source.length > 500 || target.length > 2000) throw new Error('词条为空、过长或包含控制字符。');
                const key = page + '\n' + source;
                if (seen.has(key)) throw new Error('同一页面范围内存在重复原文：' + source);
                seen.add(key);
                return { scope: page, source, target };
            }),
            excluded: [...new Set(excluded.map(scope))],
        };
        if (JSON.stringify(validated).length > 500000) throw new Error('词库配置总量不能超过 50 万字符。');
        return validated;
    }
    function lookup(entries, text, location) {
        if (typeof text !== 'string' || !text) return undefined;
        let index = indexes.get(entries);
        if (!index) {
            index = new Map();
            for (const entry of entries) {
                const list = index.get(entry.source) || [];
                list.push(entry); index.set(entry.source, list);
            }
            indexes.set(entries, index);
        }
        const scoreScope = (s) => (s.endsWith('*') ? s.length - 1 : 10000 + s.length);
        let best;
        for (const entry of index.get(text) || []) {
            if (entry.source === text && matches(entry.scope, location)
                && (!best || scoreScope(entry.scope) > scoreScope(best.scope))) best = entry;
        }
        return best?.target;
    }
    function collectable(text, pathname = '') {
        if (typeof text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return false;
        const normalized = normalize(text);
        return normalized.length >= 6 && normalized.length <= 200
            && !/(?:settings|billing|security|tokens|secrets|credentials|login|sessions?|password_reset|account_verifications|two-factor|oauth|audit-log|enterprises|sso|people|invitations)(?:\/|$)/i.test(pathname)
            && /[a-z]{2,}\s+[a-z]{2,}/i.test(normalized)
            && !/(?:https?:|www\.|@|\b(?:sk|ghp|github_pat)[_-]|\bgh[opusr]_[A-Za-z0-9_]+|\bxox[baprs]-[A-Za-z0-9-]+|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]{10,}|\b[0-9a-f]{16,}\b|[\/\\]|[\u4e00-\u9fff])/i.test(normalized);
    }
    function settings(input, defaults, allowSecrets = false) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的设置配置。');
        const allowedProviders = new Set([
            'index_translate', 'deepl', 'google', 'azure', 'qwen_mt',
            'openai', 'openai_compatible', 'deepseek', 'qwen', 'minimax', 'kimi', 'zhipu', 'volcengine',
        ]);
        const result = {};
        for (const [key, defaultValue] of Object.entries(defaults)) {
            if (!Object.hasOwn(input, key) || (!allowSecrets && /(?:key|token|secret)/i.test(key) && !key.startsWith('readme_enable_'))) continue;
            const value = input[key];
            if (typeof value !== typeof defaultValue || (typeof value === 'string' && value.length > 4000)) throw new Error('配置字段无效：' + key);
            if (key === 'readme_provider' && value && !allowedProviders.has(String(value).trim().toLowerCase())) {
                throw new Error('不支持的翻译服务：' + value);
            }
            if (key.endsWith('_api_url') && value) {
                const cleaned = value.trim().replace(/\s+/g, '');
                let url;
                try {
                    url = new URL(cleaned);
                } catch { throw new Error('配置 URL 无效：' + key); }
                const protocol = url.protocol.toLowerCase();
                const hostname = url.hostname.toLowerCase();
                const isLocalHttp = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
                if (protocol !== 'https:' && !isLocalHttp) {
                    throw new Error('配置 URL 仅支持 HTTPS 或本机 HTTP（localhost/127.0.0.1）：' + key);
                }
                if (!allowSecrets) {
                    url.username = ''; url.password = ''; url.hash = '';
                    for (const name of [...url.searchParams.keys()]) if (/key|token|secret|password|auth|signature/i.test(name)) url.searchParams.delete(name);
                    result[key] = url.href;
                } else result[key] = cleaned;
            } else result[key] = value;
        }
        return result;
    }
    function backup(input, defaults, allowSecrets = false) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || input.format !== 'ghcn-backup' || input.version !== 1) throw new Error('不支持的备份文件。');
        if (input.settings !== undefined && (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))) {
            throw new Error('备份中的设置格式无效。');
        }
        return { data: validateData(input.data), settings: settings(input.settings || {}, defaults, allowSecrets) };
    }
    return { DATA_KEY, MISS_KEY, normalize, scope, matches, validateData, lookup, collectable, settings, backup };
})();

    // ==========================================================================
    // [Module] features/maintenance.js
    // ==========================================================================

    let maintenanceData = { entries: [], excluded: [] };
    const uiMisses = new Map();
    let uiMissTimer = 0;
    let uiMissCapturedAt = 0;
    let customWrites = new WeakMap();
    function hasCustomWrite(node, field, text) {
        if (typeof text !== 'string') return false;
        const map = customWrites.get(node);
        if (!map) return false;
        return map.get(field === 'ariaLabel' ? 'aria-label' : field) === text;
    }
    function rememberCustomWrite(node, field, text) {
        const fields = customWrites.get(node) || new Map();
        fields.set(field === 'ariaLabel' ? 'aria-label' : field, text);
        customWrites.set(node, fields);
    }

    function isPageExcluded() {
        return maintenanceData.excluded.some(pattern => GhcnMaintenance.matches(pattern, window.location));
    }

    function applyCustomAttributes(node) {
        if (!maintenanceData.entries.length) return;
        for (const name of ['aria-label', 'placeholder', 'title']) {
            const text = node.getAttribute(name);
            if (!text) continue;
            if (hasCustomWrite(node, name, text)) continue;
            const normalized = GhcnMaintenance.normalize(text);
            const translated = GhcnMaintenance.lookup(maintenanceData.entries, normalized, window.location);
            if (translated && translated !== text) {
                rememberCustomWrite(node, name, translated);
                node.setAttribute(name, translated);
            }
        }
    }

    async function loadMaintenanceSettings() {
        try {
            const raw = await chrome.storage.local.get(GhcnMaintenance.DATA_KEY);
            maintenanceData = GhcnMaintenance.validateData(raw[GhcnMaintenance.DATA_KEY] || {});
        }
        catch (error) {
            const isInvalidated = typeof isExtensionContextInvalidatedError === 'function'
                ? isExtensionContextInvalidatedError(error)
                : /extension context invalidated|context invalidated|插件上下文已失效/i.test(String(error?.message || error || ''));
            if (!isInvalidated) console.warn('[词库维护] 已忽略无效配置', error.message);
        }
    }

    function recordUiMiss(rawText) {
        const publicMeta = typeof document !== 'undefined'
            ? document.querySelector?.('meta[name="octolytics-dimension-repository_public"]')
            : null;
        if (publicMeta && publicMeta.getAttribute('content') !== 'true') return;
        const text = GhcnMaintenance.normalize(rawText);
        if (!FeatureSet.collect_ui_misses || !FeatureSet.enable_extension
            || !GhcnMaintenance.collectable(text, window.location.pathname) || uiMisses.size >= 200) return;
        const page = pageConfig.currentPageType;
        if (!page) return;
        const key = page + '\n' + text;
        const row = uiMisses.get(key) || { page, text, count: 0 };
        row.count++;
        uiMisses.set(key, row);
        uiMissCapturedAt = Date.now();
        if (uiMissTimer) return;
        uiMissTimer = window.setTimeout(() => {
            uiMissTimer = 0;
            const rows = [...uiMisses.values()];
            const capturedAt = uiMissCapturedAt || Date.now();
            uiMissCapturedAt = 0;
            uiMisses.clear();
            try {
                chrome.runtime.sendMessage({ type: 'ghcn-ui-misses', rows, capturedAt }, () => {
                    if (chrome.runtime.lastError) console.info('[词库维护] 日志未保存，请刷新页面。');
                });
            } catch {
                console.info('[词库维护] 日志未保存，请刷新页面。');
            }
        }, 2000);
    }

    const chineseReadme = { state: null, pending: null, cache: new Map(), failures: new Map(), bypass: new WeakMap() };

    function getDocumentUrlWithoutHash() {
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

    function runWithReadmeMutationGuard(fn) {
        if (typeof withReadmeDomMutationGuard === 'function') {
            return withReadmeDomMutationGuard(fn);
        }
        return fn();
    }

    function restoreChineseReadme() {
        const state = chineseReadme.state;
        if (!state) return;
        runWithReadmeMutationGuard(() => {
            state.root.hidden = state.hidden;
            state.copy.remove();
            state.controls.remove();
            chineseReadme.state = null;
        });
    }

    function isAlreadyChineseReadme(root) {
        if (!root) return false;
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(root) : null;
        const clone = (state?.originalHtml && typeof parseInertHtmlBody === 'function')
            ? parseInertHtmlBody(state.originalHtml)
            : (typeof root.cloneNode === 'function' ? root.cloneNode(true) : root);
        clone.querySelectorAll?.('pre, code, kbd, samp, script, style, svg, math').forEach(node => node.remove());
        const text = String(clone.textContent || '').trim();
        const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjkCount < 20) return false;
        const latinWords = (text.match(/[A-Za-z]{2,}/g) || []).length;
        return cjkCount >= latinWords * 1.5;
    }

    function detectRepoBranchName(repoPrefix) {
        const refNode = document.querySelector?.(
            '#branch-picker-repos-header-ref-selector [data-component="text"], #branch-picker-repos-header-ref-selector .css-truncate-target, [data-hotkey="w"] [data-component="text"]',
        );
        const direct = refNode?.textContent?.trim();
        if (direct && !direct.includes('\n')) return direct;
        const escapedPrefix = repoPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linkRe = new RegExp(`^${escapedPrefix}/(?:edit|blob)/(.+)/readme(?:[._-][^/]+)?$`, 'i');
        for (const link of document.querySelectorAll?.('a[href*="/blob/"], a[href*="/edit/"]') || []) {
            try {
                const url = new URL(link.getAttribute('href') || '', window.location.href);
                const path = decodeURIComponent(url.pathname);
                const match = path.match(linkRe);
                if (match?.[1]) return match[1];
            } catch { /* 忽略非法链接。 */ }
        }
        return '';
    }

    function findChineseReadmeCandidates(root) {
        const repo = getCurrentRepoInfo();
        if (!repo || window.location.hostname !== 'github.com') return [];
        if (isAlreadyChineseReadme(root)) return [];

        let currentPath;
        try {
            currentPath = decodeURIComponent(window.location.pathname);
        } catch {
            currentPath = window.location.pathname;
        }
        currentPath = currentPath.length > 1 ? currentPath.replace(/\/+$/, '') : currentPath;
        const lowerPath = currentPath.toLowerCase();
        const repoPrefix = '/' + repo.fullName;

        let mode = '';
        let blobPrefix = '';
        let detectedBranchLower = '';
        if (lowerPath === repoPrefix) {
            mode = 'repo';
            blobPrefix = repoPrefix + '/blob/';
            detectedBranchLower = detectRepoBranchName(repoPrefix).toLowerCase();
        } else if (lowerPath.startsWith(repoPrefix + '/tree/')) {
            const treeTail = currentPath.slice((repoPrefix + '/tree/').length);
            if (!treeTail) return [];
            mode = 'tree';
            blobPrefix = repoPrefix + '/blob/' + treeTail.toLowerCase() + '/';
        } else if (lowerPath.startsWith(repoPrefix + '/blob/')) {
            const blobTail = currentPath.slice((repoPrefix + '/blob/').length);
            const lastSlash = blobTail.lastIndexOf('/');
            if (lastSlash < 1) return [];
            const blobDir = blobTail.slice(0, lastSlash);
            const filename = blobTail.slice(lastSlash + 1);
            if (!/^readme(?:[._-](?:en(?:[._-]?(?:us|gb))?|english))?(?:\.(?:md|markdown|rst|txt))?$/i.test(filename)) {
                return [];
            }
            if (/(?:^|\/)(?:zh(?:[._-]?(?:cn|hans|tw|hant))?|cn|中文)$/i.test(blobDir)) {
                return [];
            }
            mode = 'blob';
            blobPrefix = currentPath.slice(0, currentPath.lastIndexOf('/') + 1).toLowerCase();
        } else {
            return [];
        }

        const subprojectDirRe = /^(?:packages|examples|apps|crates|plugins|modules|services|demos|samples|templates|tests?|benchmarks?)\//i;
        const chineseReadmeRe = /(?:\/readme[._-](?:zh(?:[._-]?(?:cn|hans|tw|hant))?|cn|中文)\.(?:md|markdown|rst)|\/(?:zh-cn|zh_cn|zh|cn)\/readme\.(?:md|markdown|rst))$/i;
        const rootLinks = [...root.querySelectorAll('a[href]')].map(link => ({ link, fromRoot: true }));
        const rootSet = new Set(rootLinks.map(item => item.link));
        const extraLinks = [...document.querySelectorAll('a[href*="readme" i]')]
            .filter(link => !rootSet.has(link))
            .map(link => ({ link, fromRoot: false }));
        const seen = new Map();

        for (const { link, fromRoot } of [...rootLinks, ...extraLinks]) {
            try {
                const href = link.getAttribute('href');
                if (!href) continue;
                const url = new URL(href, window.location.href);
                const path = decodeURIComponent(url.pathname);
                if (url.origin !== window.location.origin || !path.toLowerCase().startsWith(blobPrefix)) continue;
                if (!chineseReadmeRe.test(path)) continue;
                let rel;
                if (mode === 'repo') {
                    const afterBlob = path.slice(blobPrefix.length);
                    if (detectedBranchLower && afterBlob.toLowerCase().startsWith(detectedBranchLower + '/')) {
                        rel = afterBlob.slice(detectedBranchLower.length + 1);
                    } else {
                        const slashIndex = afterBlob.indexOf('/');
                        if (slashIndex <= 0) continue;
                        rel = afterBlob.slice(slashIndex + 1);
                    }
                } else {
                    rel = path.slice(blobPrefix.length);
                }
                if (!rel || subprojectDirRe.test(rel)) continue;
                if (!fromRoot && rel.includes('/') && !/^(?:zh-cn|zh_cn|zh|cn)\/readme\./i.test(rel)) continue;
                url.search = ''; url.hash = '';
                if (url.pathname === window.location.pathname) continue;
                const existing = seen.get(url.href);
                if (!existing || (fromRoot && !existing.fromRoot)) {
                    seen.set(url.href, { href: url.href, rel, fromRoot });
                }
            } catch { /* 非 URL 链接忽略。 */ }
        }
        return [...seen.values()].sort((a, b) => {
            const tradDiff = Number(/(?:tw|hant)/i.test(a.rel)) - Number(/(?:tw|hant)/i.test(b.rel));
            if (tradDiff !== 0) return tradDiff;
            const depthDiff = a.rel.split('/').length - b.rel.split('/').length;
            if (depthDiff !== 0) return depthDiff;
            return Number(b.fromRoot) - Number(a.fromRoot);
        }).map(item => item.href);
    }

    function findChineseReadme(root) {
        return findChineseReadmeCandidates(root)[0] || null;
    }

    function sanitizeChineseReadme(article, base) {
        const copy = document.importNode(article, true);
        copy.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,button,link,meta,base,svg,math,template,turbo-frame,turbo-stream').forEach(node => node.remove());
        const usedIds = new Set();
        const idMap = new Map();
        const assignSafeId = (rawId) => {
            const trimmed = String(rawId || '').trim();
            if (!trimmed || trimmed.length > 200 || /[\s\u0000-\u001f\u007f"'<>\\#?/]/.test(trimmed)) return '';
            const clean = trimmed.replace(/^user-content-/i, '') || trimmed;
            let candidate = `ghcn-cr-${clean}`;
            let suffix = 2;
            while (usedIds.has(candidate)) {
                candidate = `ghcn-cr-${clean}-${suffix++}`;
            }
            usedIds.add(candidate);
            idMap.set(trimmed, candidate);
            if (!idMap.has(clean)) idMap.set(clean, candidate);
            const lowerClean = clean.toLowerCase();
            if (!idMap.has(lowerClean)) idMap.set(lowerClean, candidate);
            return candidate;
        };
        const nodes = [copy, ...copy.querySelectorAll('*')];
        for (const node of nodes) {
            for (const attribute of [...node.attributes]) {
                const name = attribute.name;
                const lower = name.toLowerCase();
                if (/^on/i.test(name) || name.includes(':') || ['srcdoc', 'style', 'name'].includes(lower)
                    || /^data-(?:turbo(?:$|[-_])|action$|remote$|method$)/i.test(lower)) {
                    node.removeAttribute(name);
                }
            }
            if (node.hasAttribute('id')) {
                const mappedId = assignSafeId(node.getAttribute('id'));
                if (mappedId) node.setAttribute('id', mappedId);
                else node.removeAttribute('id');
            }
        }
        const resolveMappedFragment = (hashText) => {
            const fragment = hashText.startsWith('#') ? hashText.slice(1) : hashText;
            if (!fragment) return '';
            let decoded = fragment;
            try { decoded = decodeURIComponent(fragment); } catch {}
            const stripped = decoded.replace(/^user-content-/i, '');
            return idMap.get(fragment)
                || idMap.get(decoded)
                || idMap.get(stripped)
                || idMap.get(decoded.toLowerCase())
                || idMap.get(stripped.toLowerCase())
                || '';
        };
        const baseUrl = new URL(base);
        for (const node of nodes) {
            if (node.hasAttribute('href')) {
                const rawHref = String(node.getAttribute('href') || '').trim();
                if (rawHref.startsWith('#')) {
                    const mapped = resolveMappedFragment(rawHref);
                    if (mapped) node.setAttribute('href', `#${mapped}`);
                    else node.removeAttribute('href');
                } else {
                    try {
                        const url = new URL(rawHref, base);
                        if (url.origin === baseUrl.origin && url.pathname === baseUrl.pathname && url.hash) {
                            const mapped = resolveMappedFragment(url.hash);
                            if (mapped) {
                                node.setAttribute('href', `#${mapped}`);
                            } else if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
                                node.setAttribute('href', url.href);
                            } else {
                                node.removeAttribute('href');
                            }
                        } else if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
                            node.removeAttribute('href');
                        } else {
                            node.setAttribute('href', url.href);
                        }
                    } catch { node.removeAttribute('href'); }
                }
            }
            for (const attr of ['src', 'poster']) {
                if (!node.hasAttribute(attr)) continue;
                try {
                    const raw = node.getAttribute(attr);
                    const url = new URL(raw, base);
                    if (!['https:', 'http:'].includes(url.protocol)) node.removeAttribute(attr);
                    else node.setAttribute(attr, url.href);
                } catch { node.removeAttribute(attr); }
            }
            if (node.hasAttribute('srcset')) {
                const rawSrcset = String(node.getAttribute('srcset') || '');
                const parts = rawSrcset.split(',').map(part => part.trim()).filter(Boolean);
                const cleanParts = [];
                let validAll = parts.length > 0;
                for (const part of parts) {
                    const tokens = part.split(/\s+/);
                    if (tokens.length > 2 || !tokens[0]) { validAll = false; break; }
                    try {
                        const url = new URL(tokens[0], base);
                        if (!['https:', 'http:'].includes(url.protocol)) { validAll = false; break; }
                        if (tokens[1] && !/^(?:\d+w|\d+(?:\.\d+)?x)$/i.test(tokens[1])) { validAll = false; break; }
                        cleanParts.push(tokens[1] ? `${url.href} ${tokens[1]}` : url.href);
                    } catch {
                        validAll = false;
                        break;
                    }
                }
                if (validAll && cleanParts.length) node.setAttribute('srcset', cleanParts.join(', '));
                else node.removeAttribute('srcset');
            }
        }
        copy.dataset.ghcnChineseReadme = 'true';
        copy.setAttribute('translate', 'no');
        return copy;
    }

    async function preferChineseReadme() {
        const root = getReadmeRootElement();
        const currentDocUrl = getDocumentUrlWithoutHash();
        if (chineseReadme.state && (chineseReadme.state.root !== root || chineseReadme.state.pageUrl !== currentDocUrl || !FeatureSet.prefer_chinese_readme || !FeatureSet.enable_extension)) {
            restoreChineseReadme();
        }
        if (!root || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme || !isReadmePage() || chineseReadme.bypass.get(root) === currentDocUrl) return false;
        // 等 React 完成 hydration 再挂载；返回 true 暂缓 API，避免回退链路提前改 DOM。
        if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) return true;
        if (chineseReadme.state?.root === root && chineseReadme.state?.pageUrl === currentDocUrl) return true;
        const candidates = findChineseReadmeCandidates(root)
            .filter(candidate => Date.now() - (chineseReadme.failures.get(candidate) || 0) >= 300000);
        if (!candidates.length) return false;
        if (chineseReadme.pending) {
            if (chineseReadme.pending.pageUrl === currentDocUrl && chineseReadme.pending.root === root && candidates.includes(chineseReadme.pending.url)) {
                await chineseReadme.pending.promise;
                if (!root.isConnected || currentDocUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                    return false;
                }
                if (chineseReadme.state?.root === root && chineseReadme.state?.pageUrl === currentDocUrl) {
                    return true;
                }
                if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) {
                    return true;
                }
            } else {
                chineseReadme.pending.controller.abort();
            }
        }
        const remainingCandidates = candidates.filter(candidate => Date.now() - (chineseReadme.failures.get(candidate) || 0) >= 300000);
        for (const url of remainingCandidates) {
            const pageUrl = getDocumentUrlWithoutHash();
            if (!root.isConnected || pageUrl !== currentDocUrl || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) return false;
            const controller = new AbortController();
            const task = { url, pageUrl, root, controller, promise: null };
            task.promise = (async () => {
                let timedOut = false;
                try {
                    let cachedEntry = chineseReadme.cache.get(url);
                    if (typeof cachedEntry === 'string') {
                        cachedEntry = { html: cachedEntry, baseUrl: url };
                    }
                    let fetchedEntry = null;
                    if (!cachedEntry) {
                        const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
                        try {
                            const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
                            if (!response.ok || new URL(response.url || url).origin !== window.location.origin) return { ok: false, failed: true, aborted: false };
                            const html = await response.text();
                            if (html.length > 2000000) return { ok: false, failed: true, aborted: false };
                            fetchedEntry = { html, baseUrl: response.url || url };
                        } finally { window.clearTimeout(timeout); }
                    }
                    const entry = cachedEntry || fetchedEntry;
                    if (!root.isConnected || pageUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                        return { ok: false, failed: false, aborted: true };
                    }
                    const parsed = new DOMParser().parseFromString(entry.html, 'text/html');
                    const article = parsed.querySelector('article.markdown-body, [data-testid="readme"] .markdown-body');
                    if (!article || !/[\u4e00-\u9fff]/.test(article.textContent)) return { ok: false, failed: true, aborted: false };
                    if (fetchedEntry) {
                        if (chineseReadme.cache.size >= 10) chineseReadme.cache.delete(chineseReadme.cache.keys().next().value);
                        chineseReadme.cache.set(url, fetchedEntry);
                    }
                    const copy = sanitizeChineseReadme(article, entry.baseUrl || url);
                    if (!root.isConnected || pageUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                        return { ok: false, failed: false, aborted: true };
                    }
                    if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) return { ok: true, failed: false, aborted: false };
                    if (typeof getReadmeElementState === 'function' && typeof restoreReadmeTranslation === 'function') {
                        const apiState = getReadmeElementState(root);
                        if (apiState?.translatedHash || (apiState?.originalHtml && root.innerHTML !== apiState.originalHtml)) {
                            restoreReadmeTranslation();
                        }
                    }
                    const controls = document.createElement('div');
                    controls.className = 'ghcn-native-readme mb-2 d-flex flex-items-center';
                    controls.setAttribute('translate', 'no');
                    const label = document.createElement('span'); label.textContent = '仓库已有中文 README · ';
                    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn btn-sm'; toggle.textContent = '查看原文';
                    const hidden = root.hidden;
                    controls.append(label, toggle);
                    toggle.addEventListener('click', () => {
                        runWithReadmeMutationGuard(() => {
                            copy.hidden = !copy.hidden; root.hidden = !copy.hidden;
                            toggle.textContent = copy.hidden ? '查看中文版' : '查看原文';
                        });
                    });
                    if (FeatureSet.enable_readme_translation) {
                        const api = document.createElement('button'); api.type = 'button'; api.className = 'btn btn-sm ml-2'; api.textContent = '改用 API 翻译';
                        api.addEventListener('click', () => { chineseReadme.bypass.set(root, pageUrl); restoreChineseReadme(); scheduleReadmeTranslation('native:api'); });
                        controls.append(api);
                    }
                    runWithReadmeMutationGuard(() => {
                        root.before(controls, copy); root.hidden = true;
                        chineseReadme.state = { root, hidden, copy, controls, pageUrl };
                    });
                    return { ok: true, failed: false, aborted: false };
                } catch (error) {
                    if (controller.signal.aborted && !timedOut) return { ok: false, failed: false, aborted: true };
                    console.info('[中文 README] 获取失败，回退原有流程：', error.message);
                    return { ok: false, failed: true, aborted: false };
                }
            })();
            chineseReadme.pending = task;
            try {
                const result = await task.promise;
                if (result.failed) {
                    if (chineseReadme.failures.size >= 20) chineseReadme.failures.clear();
                    chineseReadme.failures.set(url, Date.now());
                    continue;
                }
                if (result.aborted) return false;
                if (result.ok) return true;
            } finally {
                if (chineseReadme.pending === task) chineseReadme.pending = null;
            }
        }
        return false;
    }

    // ==========================================================================
    // [Module] core/utils.js
    // ==========================================================================

    function normalizeUrl(url) {
        return (url || '').trim().replace(/\s+/g, '');
    }

    function decodeHtmlEntities(text) {
        const safeText = String(text || '').replace(/<\/textarea/gi, '&lt;/textarea');
        const parsed = new DOMParser().parseFromString(`<!doctype html><textarea>${safeText}</textarea>`, 'text/html');
        return parsed.querySelector('textarea')?.value || '';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text || '';
        return `${text.slice(0, maxLength)}...`;
    }

    function parseInertHtmlBody(html) {
        if (typeof DOMParser === 'function') {
            const parsedBody = new DOMParser().parseFromString(String(html || ''), 'text/html')?.body;
            if (parsedBody && typeof parsedBody.textContent === 'string') {
                return parsedBody;
            }
        }
        const container = document.createElement('div');
        container.innerHTML = String(html || '');
        return container;
    }

    function createHash(input) {
        const text = String(input || '');
        let h1 = 0x811c9dc5 ^ text.length;
        let h2 = 0x9e3779b1 + text.length;
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 0x01000193);
            h2 = (((h2 << 5) - h2) + ch) | 0;
        }
        return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
    }

    function isObjectObjectArtifact(value) {
        return /\[object Object\]/i.test(String(value || ''));
    }

    function containsObjectObjectArtifact(value) {
        return isObjectObjectArtifact(value);
    }

    function normalizeTranslationText(value, depth = 0) {
        if (value == null) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);

        if (depth > 4) return '';

        if (Array.isArray(value)) {
            return value
                .map(item => normalizeTranslationText(item, depth + 1))
                .filter(Boolean)
                .join('');
        }

        if (typeof value === 'object') {
            const preferredKeys = [
                'text',
                'translatedText',
                'translation',
                'translated',
                'content',
                'value',
                'result',
                'output_text',
                'outputText',
                // 部分模型会镜像请求结构，把译文包进 texts/translations 数组里返回
                'texts',
                'translations',
            ];

            for (const key of preferredKeys) {
                if (value[key] != null) {
                    const normalized = normalizeTranslationText(value[key], depth + 1);
                    if (normalized && !isObjectObjectArtifact(normalized)) {
                        return normalized;
                    }
                }
            }

            return '';
        }

        return '';
    }

    // ==========================================================================
    // [Module] core/storage-cache.js
    // ==========================================================================

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

    const NON_REPO_ROOT_SEGMENTS = new Set([
        'home', 'dashboard', 'feed', 'copilot', 'spark', 'signup', 'account_verifications',
        'login', 'logout', 'session', 'sessions', 'password_reset', 'orgs', 'organizations',
        'explore', 'topics', 'notifications', 'watching', 'stars', 'issues', 'pulls', 'repos',
        'search', 'trending', 'showcases', 'new', 'import', 'settings', 'installations',
        'marketplace', 'apps', 'account', 'projects', 'redeem', 'discussions', 'collections',
        'sponsors', 'sponsoring', 'github-copilot', 'codespaces', 'developer', 'features',
        'security', 'sitemap', 'education', 'mcp', 'users', 'billing', 'plans', 'about', 'pricing',
    ]);

    function getCurrentRepoInfo() {
        if (typeof window !== 'undefined' && window.location?.hostname && window.location.hostname !== 'github.com') {
            return null;
        }
        const fullName = buildRepoIdentifierFromPath(window.location.pathname);
        if (!fullName) return null;

        const [owner, repo] = fullName.split('/');
        if (!owner || !repo || NON_REPO_ROOT_SEGMENTS.has(owner)) return null;
        return { owner, repo, fullName };
    }

    function buildRepoCacheKey(repoInfo, sourceHash, signature) {
        if (!repoInfo?.owner || !repoInfo?.repo || !sourceHash || !signature) return '';
        return `${String(repoInfo.owner).toLowerCase()}/${String(repoInfo.repo).toLowerCase()}|${sourceHash}|${signature}`;
    }

    function getStableReadmeTextHash(html) {
        const container = typeof parseInertHtmlBody === 'function'
            ? parseInertHtmlBody(html)
            : (() => {
                const div = document.createElement('div');
                div.innerHTML = String(html || '');
                return div;
            })();
        return createHash(normalizeText(container.textContent || ''));
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

        if (usage.total_tokens != null && usage.total_tokens !== '') {
            const totalTokens = Number(usage.total_tokens);
            if (Number.isFinite(totalTokens) && totalTokens > 0) {
                return totalTokens;
            }
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
        if (error?.code === 'GHCN_CONTEXT_INVALIDATED') return true;
        const message = String(error?.message || error || '');
        return /extension context invalidated/i.test(message)
            || /context invalidated/i.test(message)
            || /extension context was invalidated/i.test(message)
            || /插件上下文已失效/.test(message);
    }

    function normalizeRuntimeErrorMessage(error) {
        if (isExtensionContextInvalidatedError(error)) {
            return '插件上下文已失效，请刷新当前 GitHub 页面后重试。';
        }

        if (error instanceof Error) return error.message;

        // chrome.runtime.lastError 及后台回传的错误常是带 message 的普通对象，
        // 直接 String() 会得到无意义的 "[object Object]"，需先取出可读信息。
        if (error && typeof error === 'object') {
            if (typeof error.message === 'string' && error.message.trim()) return error.message;
            try {
                const json = JSON.stringify(error);
                if (json && json !== '{}') return json;
            } catch { /* 循环引用等，退回下方兜底 */ }
        }

        return String(error || '翻译失败');
    }

    function normalizePreservedTexts(list) {
        if (!Array.isArray(list)) return [];

        const seen = new Set();
        const result = [];
        for (const item of list) {
            if (typeof item !== 'string') continue;
            const text = item.trim();
            if (!text || text.length > 160 || seen.has(text)) continue;
            seen.add(text);
            result.push(text);
            if (result.length >= 120) break;
        }
        return result;
    }

    function sanitizeCachedPayloadText(value) {
        return typeof value === 'string' && value.length > 0 && !containsObjectObjectArtifact(value)
            ? value
            : '';
    }

    function normalizeRepoCacheEntries(entries) {
        const list = Array.isArray(entries) ? entries : [];

        return list
            .filter((item) => item && typeof item.key === 'string' && item.key.length > 0)
            .map((item) => ({
                key: item.key,
                repo: typeof item.repo === 'string' ? item.repo : '',
                pathname: typeof item.pathname === 'string' ? item.pathname : '',
                sourceHash: typeof item.sourceHash === 'string' ? item.sourceHash : '',
                translatedHtml: sanitizeCachedPayloadText(item.translatedHtml),
                tldrContent: sanitizeCachedPayloadText(item.tldrContent),
                complete: item.complete === true,
                preservedTexts: normalizePreservedTexts(item.preservedTexts),
                updatedAt: Number(item.updatedAt || 0),
            }))
            .filter((item) => Boolean(item.translatedHtml || item.tldrContent))
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

    let localStorageWriteQueue = Promise.resolve();
    const REPO_CACHE_MAX_BYTES = 4 * 1024 * 1024;
    const DEBUG_LOGS_MAX_BYTES = 512 * 1024;

    function enqueueLocalStorageWrite(task) {
        const run = localStorageWriteQueue.catch(() => {}).then(task);
        localStorageWriteQueue = run.catch(() => {});
        return run;
    }

    function estimateJsonUtf8Bytes(value) {
        const json = JSON.stringify(value);
        if (typeof TextEncoder === 'function') {
            return new TextEncoder().encode(json).byteLength;
        }
        return json.length * 2;
    }

    function trimEntriesToByteBudget(entries, maxBytes) {
        const result = Array.isArray(entries) ? [...entries] : [];
        while (result.length > 1 && estimateJsonUtf8Bytes(result) > maxBytes) {
            result.pop();
        }
        return result;
    }

    function isQuotaExceededError(error) {
        const msg = String(error?.message || error || '');
        return error?.name === 'QuotaExceededError' || /quota/i.test(msg);
    }

    async function setLocalValueWithQuotaRetry(key, entries, trimFn) {
        let candidate = entries;
        try {
            await setLocalValue(key, candidate);
            return candidate;
        } catch (error) {
            if (!isQuotaExceededError(error) || !Array.isArray(candidate) || candidate.length <= 1) {
                throw error;
            }
            candidate = trimFn(candidate);
            await setLocalValue(key, candidate);
            return candidate;
        }
    }

    async function ensureRepoCacheLoaded() {
        if (readmeRuntime.repoCacheLoaded) return;
        if (readmeRuntime.repoCacheLoadPromise) {
            return readmeRuntime.repoCacheLoadPromise;
        }

        readmeRuntime.repoCacheLoadPromise = (async () => {
            const storedEntries = await getLocalValue(README_LOCAL_STORAGE_KEYS.REPO_CACHE, []);
            const normalizedEntries = normalizeRepoCacheEntries(storedEntries);

            readmeRuntime.repoCacheMap.clear();
            normalizedEntries.forEach((entry) => {
                readmeRuntime.repoCacheMap.set(entry.key, entry);
            });
            readmeRuntime.repoCacheLoaded = true;
        })();

        try {
            await readmeRuntime.repoCacheLoadPromise;
        } finally {
            readmeRuntime.repoCacheLoadPromise = null;
        }
    }

    async function getRepoCachedTranslation(cacheKey, options = {}) {
        if (!FeatureSet.readme_enable_repo_cache || !cacheKey) return null;
        await ensureRepoCacheLoaded();

        const entry = readmeRuntime.repoCacheMap.get(cacheKey);
        if (!entry) return null;
        if (!entry.translatedHtml && !entry.tldrContent) return null;
        if (options.requireComplete && entry.complete !== true) return null;
        return entry;
    }

    async function upsertRepoCachedTranslation(cacheKey, value) {
        if (!FeatureSet.readme_enable_repo_cache || !cacheKey) return;
        const hasHtml = typeof value?.translatedHtml === 'string'
            && value.translatedHtml.length > 0
            && value.translatedHtml.length <= README_CONFIG.MAX_CACHE_HTML_CHARS
            && !containsObjectObjectArtifact(value.translatedHtml);
        const hasTldr = typeof value?.tldrContent === 'string'
            && value.tldrContent.length > 0
            && value.tldrContent.length <= README_CONFIG.MAX_CACHE_HTML_CHARS
            && !containsObjectObjectArtifact(value.tldrContent);

        if (!hasHtml && !hasTldr) return;

        return enqueueLocalStorageWrite(async () => {
            await ensureRepoCacheLoaded();

            const storedRaw = await getLocalValue(README_LOCAL_STORAGE_KEYS.REPO_CACHE, []);
            const storedNormalized = normalizeRepoCacheEntries(storedRaw);
            const mergedMap = new Map();
            storedNormalized.forEach((entry) => mergedMap.set(entry.key, entry));
            for (const [key, entry] of readmeRuntime.repoCacheMap.entries()) {
                const storedEntry = mergedMap.get(key);
                if (!storedEntry || Number(entry.updatedAt || 0) > Number(storedEntry.updatedAt || 0)) {
                    mergedMap.set(key, entry);
                }
            }

            const existing = mergedMap.get(cacheKey) || {};
            mergedMap.set(cacheKey, {
                ...existing,
                key: cacheKey,
                repo: value.repo || existing.repo || '',
                pathname: typeof value.pathname === 'string' ? value.pathname : (existing.pathname || ''),
                sourceHash: value.sourceHash || existing.sourceHash || '',
                translatedHtml: hasHtml ? value.translatedHtml : (existing.translatedHtml || ''),
                tldrContent: hasTldr ? value.tldrContent : (existing.tldrContent || ''),
                complete: value.complete ?? existing.complete ?? false,
                preservedTexts: normalizePreservedTexts(value.preservedTexts !== undefined ? value.preservedTexts : existing.preservedTexts),
                updatedAt: Date.now(),
            });

            const entries = trimEntriesToByteBudget(
                normalizeRepoCacheEntries([...mergedMap.values()]),
                REPO_CACHE_MAX_BYTES,
            );

            const committed = await setLocalValueWithQuotaRetry(
                README_LOCAL_STORAGE_KEYS.REPO_CACHE,
                entries,
                (list) => list.slice(0, Math.max(1, Math.floor(list.length / 2))),
            );
            readmeRuntime.repoCacheMap.clear();
            committed.forEach((entry) => {
                readmeRuntime.repoCacheMap.set(entry.key, entry);
            });
            readmeRuntime.repoCacheLoaded = true;
        });
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

        return enqueueLocalStorageWrite(async () => {
            const existing = await getLocalValue(README_LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS, []);
            const records = Array.isArray(existing) ? [...existing] : [];
            records.push(nextRecord);

            const trimmed = trimTranslationRecords(records, README_CONFIG.RECORD_MAX_ENTRIES);
            await setLocalValueWithQuotaRetry(
                README_LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS,
                trimmed,
                (list) => list.slice(0, Math.max(1, Math.floor(list.length / 2))),
            );
        });
    }

    // ==========================================================================
    // [Module] core/text-filter.js
    // ==========================================================================

    function shouldSkipReadmeText(text) {
        if (!text) return true;
        if (text.length > 2000) return true;
        if (isMostlyCjkText(text)) return true;
        if (/^[0-9\s.,:;()\[\]{}+\-/*#@_`~!$%^&|<>="'\\]+$/.test(text)) return true;
        if (!/[A-Za-z]/.test(text)) return true;
        if (/[\u3400-\u9FFF]/.test(text) && !/[A-Za-z]{2,}/.test(text)) return true;
        return false;
    }

    function isLikelyTechnicalReadmeText(text, node = null) {
        const input = String(text || '').trim();
        const element = node?.parentElement;
        if (element?.closest('pre, code, kbd, samp, button, .snippet-clipboard-content')) {
            return true;
        }
        if (!input) return false;

        // 参数说明列表/表格中的单词键名（如 slug、tags、title、content）应保持原文，
        // 模型通常会原样返回，不能因此把 README 判为部分完成；但普通英文虚词仍需正常翻译。
        const commonListGlueWords = new Set([
            'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from', 'as', 'via',
            'into', 'over', 'under', 'between', 'through', 'without', 'using', 'the', 'is', 'are',
            'was', 'were', 'be', 'been', 'have', 'has', 'had', 'can', 'will', 'may', 'not', 'but',
            'if', 'when', 'where', 'that', 'this', 'these', 'those', 'plus', 'see', 'then', 'also',
            'only', 'both', 'either', 'all', 'any', 'each', 'more', 'less', 'than',
        ]);
        if (/^[a-z][a-z0-9_-]{1,24}$/.test(input)
            && !commonListGlueWords.has(input)
            && element?.closest('li, dt, table')) {
            return true;
        }

        // 有些 README 会把命令放在普通 p/div/span 中，不能只依赖 pre/code 标签判断。
        if (/^(?:[$>#]\s*)?(?:npm|pnpm|yarn|bun|node|python(?:3)?|pip(?:3)?|uv|go|cargo|docker(?:\s+compose)?|podman|kubectl|helm|git|gh|curl|wget|make|cmake|brew|apt(?:-get)?|apk|dnf|yum|ssh|chmod|chown|mkdir|cd|export|set)\b(?:\s|$)/i.test(input)
            || /^(?:\.\.?[\\/]|[A-Za-z]:[\\/])/.test(input)) {
            return true;
        }
        if (isLikelyOpaqueReadmeLabel(input, node)) return true;
        if (input.length > 120) return false;

        // 版本号、文件名和纯标识符通常不需要翻译；它们保持原文时不应把整篇 README 判为部分完成。
        if (/^[a-z]+\s+(?:version\s+)?v?\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9]+)?[.!]?$/i.test(input)) {
            return true;
        }
        return false;
    }

    function isLikelyOpaqueReadmeLabel(text, node = null) {
        const input = String(text || '').trim();
        if (!input || /[\u3400-\u9FFF]/.test(input)) return false;

        const element = node?.parentElement;
        if (/[·•]/.test(input) && !/[.!?;:]/.test(input)) {
            const segments = input.split(/\s*[·•]\s*/).filter(Boolean);
            const minSegments = element?.closest('table') ? 3 : 4;
            if (segments.length >= minSegments) {
                const proseSegmentWords = new Set([
                    'fast', 'simple', 'free', 'open', 'source', 'lightweight', 'secure', 'modern',
                    'easy', 'clean', 'powerful', 'flexible', 'reliable', 'private', 'local', 'cloud',
                    'docs', 'guide', 'install', 'features', 'demo', 'pricing', 'blog', 'about',
                    'contact', 'license', 'support', 'changelog', 'roadmap', 'getting', 'started',
                    'and', 'or', 'the', 'for', 'with', 'from', 'to', 'in', 'on', 'of', 'by', 'at',
                ]);
                const isProperToken = (token) => (
                    /^[A-Z][A-Za-z0-9.+-]*$/.test(token)
                    || /^[a-z]{1,4}[A-Z][A-Za-z0-9.+-]*$/.test(token)
                    || /^[A-Z0-9]{2,}[A-Za-z0-9.+-]*$/.test(token)
                    || /^(?:npm|pnpm|yarn|bun|cli|api|sdk|mcp|ide|os|fx|pi|ai|go|js|ts|py|rs)$/i.test(token)
                );
                const allBrandSegments = segments.every((segment) => {
                    const segWords = segment.split(/\s+/).filter(Boolean);
                    if (!segWords.length || segWords.length > 4) return false;
                    return segWords.every((word) => {
                        const cleaned = word.toLowerCase().replace(/^[([{]+|[)\]},.;:!?]+$/g, '');
                        return cleaned && !proseSegmentWords.has(cleaned) && isProperToken(word);
                    });
                });
                if (allBrandSegments) return true;
            }
        }
        if (input.length > 120) return false;

        const words = input.split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 8) return false;

        const isLink = Boolean(element?.closest('a[href]'));
        const isHeading = Boolean(element?.closest('h1, h2, h3, h4, h5, h6'));
        const isTableLink = isLink && Boolean(element?.closest('table'));
        const isTableDataCell = Boolean(element?.closest('td'));
        const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9]*$/.test(word));

        // 普通句子不能因为首字母大写就被误判为产品名；这些词出现时仍需正常翻译。
        const sentenceWords = new Set([
            'a', 'an', 'and', 'are', 'as', 'at', 'about', 'build', 'by', 'can', 'changelog',
            'community', 'configure', 'contribute', 'contributing', 'documentation', 'download',
            'features', 'for', 'from', 'get', 'getting', 'guide', 'how', 'in', 'install',
            'installation', 'into', 'is', 'it', 'license', 'of', 'on', 'or', 'overview',
            'quick', 'resources', 'roadmap', 'run', 'security', 'start', 'started', 'support',
            'test', 'the', 'this', 'to', 'use', 'usage', 'using', 'with', 'what', 'when',
            'where', 'why',
        ]);
        const normalizedWords = words.map((word) => word.toLowerCase().replace(/^[([{]+|[)\]},.;:!?]+$/g, ''));
        if (normalizedWords.length === 1 && sentenceWords.has(normalizedWords[0])) return false;

        const tableProseWords = new Set([
            'yes', 'no', 'none', 'all', 'other', 'others', 'default', 'defaults', 'optional',
            'required', 'supported', 'unsupported', 'available', 'unavailable', 'experimental',
            'stable', 'deprecated', 'recommended', 'legacy', 'manual', 'automatic', 'auto',
            'custom', 'local', 'remote', 'global', 'free', 'paid', 'open', 'closed', 'read',
            'write', 'full', 'partial', 'basic', 'advanced', 'high', 'medium', 'low', 'fast',
            'slow', 'new', 'old', 'active', 'inactive', 'enabled', 'disabled', 'planned',
            'done', 'pending', 'coming', 'soon', 'see', 'more', 'less', 'both', 'either',
            'neither', 'unknown', 'empty', 'any', 'every', 'only', 'always', 'never', 'name',
            'type', 'description', 'status', 'platform', 'platforms', 'method', 'command',
            'commands', 'option', 'options', 'notes', 'note', 'value', 'values', 'version',
            'versions', 'source', 'target', 'language', 'languages', 'summary', 'details',
            'system', 'systems', 'action', 'actions', 'mode', 'modes', 'file', 'files',
            'path', 'paths', 'config', 'setting', 'settings', 'package', 'packages',
            'plugin', 'plugins', 'tool', 'tools', 'client', 'clients', 'server', 'servers',
            'provider', 'providers', 'model', 'models', 'editor', 'editors', 'browser',
            'browsers', 'true', 'false', 'official', 'product', 'page', 'hardware',
            'architecture', 'interfaces', 'downloads', 'changelog', 'support', 'security',
            'board', 'chipset', 'terminal', 'kiosk', 'display', 'module', 'control',
            'power', 'permissions', 'capabilities', 'reports', 'bug', 'releases', 'faq',
        ]);

        if (isHeading && words.length >= 2 && document.title.includes(input)) {
            return true;
        }

        if (words.length === 1) {
            if (/^(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i.test(input)) return true;
            if (/^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:md|markdown|rst|txt|json|ya?ml|toml|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ps1|bat|cmd|exe|apk|aar|jar|zip|tar|gz|tgz|dmg|pkg|deb|rpm|appimage|iso|bin|so|dll|dylib|png|jpe?g|gif|svg|webp|ico|pdf|lock|env|ini|cfg|conf|gradle))$/i.test(input)) {
                return true;
            }
            if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.(?:com|org|net|io|ai|dev|app|co|gg|rs|xyz|cloud|tech|site|edu|gov|cn|uk|de|jp|fr|eu|info|biz|tv|cc|fm|ly)$/.test(input)) {
                return true;
            }
            if (isLink && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.(?:me|sh|so|to|tools|run|build|land|im|pro|page|link|work|studio|design)$/i.test(input)) {
                return true;
            }
            if (/^\(?(?:x86(?:_64)?|x64|amd64|arm64|aarch64|armhf|armv7|i386|i686|ppc64le|s390x|riscv64|mips64|wasm(?:32|64)?)\)?$/i.test(input)) return true;
            if (!/^FAQ$/i.test(input) && /^[A-Z0-9][A-Z0-9._+-]{1,24}$/.test(input)) return true;
            if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(input)
                || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(input)
                || /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(input)
                || /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}$/.test(input)) {
                return true;
            }
            if (isLink && /^[A-Z]$/.test(input)) return true;
        }

        if (/^(?:[A-Z][a-z]+ )+\([A-Z0-9]{2,}\)$/.test(input)) {
            return true;
        }

        if (normalizedWords.some((word) => sentenceWords.has(word) || tableProseWords.has(word))
            || /[,.:;!?()&/-]/.test(input)) {
            return false;
        }

        if (isTableLink && titleCaseWords.length === words.length && words.length <= 2) return true;
        if (isTableDataCell && titleCaseWords.length === words.length && words.length <= 2) return true;

        return false;
    }


    function isMostlyCjkText(text) {
        const input = String(text || '');
        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        const lowercaseLatinWords = (input.match(/\b[a-z]{2,}\b/g) || []).length;
        if (/、/.test(input) && lowercaseLatinWords === 0) return true;
        if (!cjkCount) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        const latinWords = (input.match(/[A-Za-z]{2,}/g) || []).length;
        const cjkPunctuation = (input.match(/[\u3000-\u303F\uFF01-\uFF5E]/g) || []).length;

        if (cjkCount >= 2 && lowercaseLatinWords === 0
            && !/^(?:Read|View|See|Open|Click|Switch|Use|Try|Get|Run|Add|Set)\b/i.test(input.trim())) {
            return true;
        }
        if (cjkCount >= 3 && cjkPunctuation > 0 && cjkCount >= lowercaseLatinWords * 2) return true;
        if (cjkCount >= 3 && lowercaseLatinWords <= 1
            && !/^(?:Read|View|See|Open|Click|Switch|Use|Try|Get|Run|Add|Set)\b/i.test(input.trim())) {
            return true;
        }

        // 若中文字符达到 8 个以上，且中文字数明显多于英文词数（技术名词混排常见场景），视为中文
        if (cjkCount >= 8 && cjkCount >= latinWords * 1.5) return true;
        // 中文标点加 6 个以上汉字也是明显的中文语句
        if (cjkCount >= 6 && cjkPunctuation > 0 && cjkCount >= latinWords) return true;

        return cjkCount >= 8 && cjkCount >= latinCount * 0.8;
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


    function normalizeText(text) {
        return text.replace(/\xa0|[\s]+/g, ' ').trim();
    }

    /****************** Issue / PR 协作润色助手 ******************/

    // ==========================================================================
    // [Module] core/dom-observer.js
    // ==========================================================================

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

    // ==========================================================================
    // [Module] features/ui-localization.js
    // ==========================================================================

    function isReactGlobalNavPortalNode(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!element) return false;

        const quickSearchSelector = '#search-suggestions-dialog, [aria-label="Quick search"], [aria-label="Search suggestions"]';
        const portalRoot = element.closest?.('#__primerPortalRoot__');
        if (element.closest?.(quickSearchSelector)) {
            return true;
        }
        if (!portalRoot) {
            if (element.id === '__primerPortalRoot__' || element.contains?.(document.querySelector?.('#search-suggestions-dialog'))) {
                return Boolean(element.querySelector?.(quickSearchSelector));
            }
            return false;
        }

        const portal = element.closest?.('[data-component="Portal"]')
            || element.querySelector?.('[data-component="Portal"]')
            || portalRoot;
        if (portal.matches?.(quickSearchSelector)
            || portal.querySelector?.(quickSearchSelector)) return true;

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
            '[contenteditable=""]',
            '[contenteditable="true"]',
            '[contenteditable="plaintext-only"]',
            '.notranslate',
            '[translate="no"]',
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
        const maxHeaderRetryCount = 4;
        let timer = null;
        let headerObserver = null;
        let lastReactGlobalNavMutationAt = Date.now();
        let lastReactGlobalNavPortalMutationAt = Date.now();
        let isApplyingNavTranslation = false;
        let headerRetryCount = 0;
        let portalRafId = 0;
        let portalTimers = [];
        let globalNavStaticIndex = null;
        let cachedNavPageType = '';
        const navLabelCache = new Map();
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

        function getGlobalNavStaticIndex() {
            if (globalNavStaticIndex) return globalNavStaticIndex;
            globalNavStaticIndex = new Map();
            const locale = I18N[CONFIG.LANG];
            if (!locale) return globalNavStaticIndex;

            for (const section of Object.values(locale)) {
                const dict = section?.static;
                if (!dict || typeof dict !== 'object') continue;
                for (const [key, value] of Object.entries(dict)) {
                    if (typeof value === 'string' && value && value !== key && !globalNavStaticIndex.has(key)) {
                        globalNavStaticIndex.set(key, value);
                    }
                }
            }
            return globalNavStaticIndex;
        }

        function findStaticGlobalNavLabel(source) {
            return getGlobalNavStaticIndex().get(source) || null;
        }

        function findRegexpGlobalNavLabel(source) {
            const locale = I18N[CONFIG.LANG];
            if (!locale) return null;

            const currentRules = typeof pageConfig !== 'undefined' && Array.isArray(pageConfig?.regexpRules)
                ? pageConfig.regexpRules
                : [];
            const publicRules = Array.isArray(locale.public?.regexp) ? locale.public.regexp : [];
            const candidateRuleLists = currentRules.length ? [currentRules] : [publicRules];

            for (const rules of candidateRuleLists) {
                for (const [pattern, replacement] of rules) {
                    const re = pattern?.global
                        ? new RegExp(pattern.source, pattern.flags.replace('g', ''))
                        : pattern;
                    const match = source.match(re);
                    if (!match || match.index !== 0 || match[0] !== source) continue;

                    const label = source.replace(re, replacement);
                    if (label !== source) return label;
                }
            }

            return null;
        }

        function isCustomGlobalNavEntry(source) {
            return typeof GhcnMaintenance !== 'undefined' && typeof maintenanceData !== 'undefined'
                && maintenanceData.entries.length
                && Boolean(GhcnMaintenance.lookup(maintenanceData.entries, source, window.location));
        }

        function hasCustomGlobalNavWrite(node, field, value) {
            return typeof hasCustomWrite === 'function' && typeof maintenanceData !== 'undefined'
                && maintenanceData.entries.length && hasCustomWrite(node, field, value);
        }

        function rememberCustomGlobalNavWrite(node, field, value) {
            if (typeof rememberCustomWrite === 'function') {
                rememberCustomWrite(node, field, value);
            }
        }

        function resolveReactGlobalNavLabel(source) {
            if (typeof GhcnMaintenance !== 'undefined' && typeof maintenanceData !== 'undefined' && maintenanceData.entries.length) {
                const custom = GhcnMaintenance.lookup(maintenanceData.entries, source, window.location);
                if (custom) return custom !== source ? custom : null;
            }
            if (!/[A-Za-z]/.test(source)) return null;

            const currentType = typeof pageConfig !== 'undefined' ? (pageConfig?.currentPageType || '') : '';
            if (cachedNavPageType !== currentType) {
                cachedNavPageType = currentType;
                navLabelCache.clear();
            }
            if (navLabelCache.has(source)) {
                return navLabelCache.get(source);
            }

            const ownNavLabel = Object.hasOwn(labels, source) && typeof labels[source] === 'string' && labels[source] !== source
                ? labels[source]
                : null;
            const resolved = ownNavLabel || findStaticGlobalNavLabel(source) || findRegexpGlobalNavLabel(source);
            const normalizedResult = resolved && resolved !== source ? resolved : null;

            if (navLabelCache.size >= 2000) {
                navLabelCache.delete(navLabelCache.keys().next().value);
            }
            navLabelCache.set(source, normalizedResult);
            return normalizedResult;
        }

        function normalizeReactGlobalNavText(text) {
            return text?.replace(/[\xa0\s]+/g, ' ').trim();
        }

        function translateReactGlobalNavText(text) {
            const source = normalizeReactGlobalNavText(text);
            return source ? resolveReactGlobalNavLabel(source) : null;
        }

        function translateReactGlobalNavElement(element, source) {
            const rawText = source ?? element.textContent;
            const normalized = normalizeReactGlobalNavText(rawText);
            if (!normalized) return;
            if (hasCustomGlobalNavWrite(element, 'textContent', element.textContent)) return;
            const label = resolveReactGlobalNavLabel(normalized);
            if (label && element.textContent !== label) {
                element.textContent = label;
                if (isCustomGlobalNavEntry(normalized)) {
                    rememberCustomGlobalNavWrite(element, 'textContent', label);
                    if (element.firstChild?.nodeType === Node.TEXT_NODE) {
                        rememberCustomGlobalNavWrite(element.firstChild, 'data', label);
                    }
                }
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
                if (!value) return;
                if (hasCustomGlobalNavWrite(element, attributeName, value)) return;
                const normalized = normalizeReactGlobalNavText(value);
                const label = normalized ? resolveReactGlobalNavLabel(normalized) : null;
                if (label && value !== label) {
                    if (isCustomGlobalNavEntry(normalized)) rememberCustomGlobalNavWrite(element, attributeName, label);
                    element.setAttribute(attributeName, label);
                }
            });
        }

        function translateReactGlobalNavTextNode(node) {
            if (hasCustomGlobalNavWrite(node, 'data', node.data)) return;
            if (node.parentElement
                && typeof node.parentElement.textContent === 'string'
                && hasCustomGlobalNavWrite(node.parentElement, 'textContent', node.parentElement.textContent)) return;
            const normalized = normalizeReactGlobalNavText(node.data);
            const label = normalized ? resolveReactGlobalNavLabel(normalized) : null;
            if (label) {
                const next = node.data.replace(node.data.trim(), () => label);
                if (next !== node.data) {
                    if (isCustomGlobalNavEntry(normalized)) rememberCustomGlobalNavWrite(node, 'data', next);
                    node.data = next;
                }
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
                    const nextText = nodeIndex === 0 ? segments[segmentIndex] : '';
                    if (node.data !== nextText) node.data = nextText;
                });
            });
        }

        function translateReactGlobalNavHeader() {
            const header = document.querySelector('header.GlobalNav');
            if (!header) return true;
            if (!canTranslateReactGlobalNavHeader()) return false;

            isApplyingNavTranslation = true;
            try {
                document.querySelectorAll(dataContentLabelSelector).forEach(element => {
                    if (!shouldSkipReactGlobalNavNode(element)) {
                        translateReactGlobalNavElement(element, element.getAttribute('data-content'));
                    }
                });
                translateReactGlobalNavSurface(header);
                translateReactGlobalNavSearchPlaceholder();
            } finally {
                headerObserver?.takeRecords?.();
                isApplyingNavTranslation = false;
            }

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
            isApplyingNavTranslation = true;
            try {
                surfaces.forEach(surface => {
                    if (isReactGlobalNavSearchPortal(surface) && !isReactGlobalNavSurfaceIdle('portal')) {
                        searchPortalPending = true;
                        return;
                    }
                    translateReactGlobalNavSurface(surface);
                });
            } finally {
                headerObserver?.takeRecords?.();
                isApplyingNavTranslation = false;
            }

            return !searchPortalPending;
        }

        function translateReactGlobalNavLabels(options = { requireSettledHeader: true }) {
            if (!FeatureSet.enable_extension) return;
            observeReactGlobalNav();

            const headerTranslated = translateReactGlobalNavHeader();
            const portalsTranslated = translateReactGlobalNavPortals();

            if (headerTranslated && portalsTranslated) {
                headerRetryCount = 0;
                return;
            }

            if (isReactGlobalNavSearchActive()) {
                return;
            }

            if ((options.requireSettledHeader && !headerTranslated) || !portalsTranslated) {
                if (headerRetryCount < maxHeaderRetryCount) {
                    headerRetryCount += 1;
                    scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, options);
                }
            }
        }

        function scheduleReactGlobalNavTranslation(delay = 800, options = {}) {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => translateReactGlobalNavLabels(options), delay);
        }

        function translateReactGlobalNavPortalsSoon() {
            if (!FeatureSet.enable_extension) return;

            if (portalRafId && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(portalRafId);
                portalRafId = 0;
            }
            portalTimers.forEach(id => window.clearTimeout(id));
            portalTimers = [];

            const translatePortals = () => {
                observeReactGlobalNav();
                translateReactGlobalNavPortals();
            };

            portalRafId = window.requestAnimationFrame(translatePortals);
            [80, 200].forEach(delay => {
                portalTimers.push(window.setTimeout(translatePortals, delay));
            });
        }

        function scheduleReactGlobalNavSeries() {
            headerRetryCount = 0;
            [800, 1600, 3000].forEach(delay => {
                window.setTimeout(() => translateReactGlobalNavLabels({ requireSettledHeader: true }), delay);
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
                    if (isApplyingNavTranslation) return;
                    mutations.forEach(mutation => recordReactGlobalNavMutation(mutation.target));
                    headerRetryCount = 0;
                    translateReactGlobalNavPortalsSoon();
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
            document.addEventListener(eventName, event => {
                if (eventName === 'pointerover'
                    && !event.target?.closest?.('header.GlobalNav, #__primerPortalRoot__')) {
                    return;
                }
                headerRetryCount = 0;
                translateReactGlobalNavPortalsSoon();
                scheduleReactGlobalNavTranslation(reactGlobalNavRetryMs, { requireSettledHeader: true });
            }, true);
        });
    }

    /**
     * watchUpdate 函数：监视页面变化，根据变化的节点进行翻译
     */

    function isFallbackRepositoryPath(pathname) {
        const reservedRoots = new Set([
            'home', 'dashboard', 'feed', 'copilot', 'spark', 'signup', 'account_verifications',
            'login', 'logout', 'session', 'sessions', 'password_reset', 'orgs', 'organizations',
            'explore', 'topics', 'notifications', 'watching', 'stars', 'issues', 'pulls', 'repos',
            'search', 'trending', 'showcases', 'new', 'import', 'settings', 'installations',
            'marketplace', 'apps', 'account', 'projects', 'redeem', 'discussions', 'collections',
            'sponsors', 'sponsoring', 'github-copilot', 'codespaces', 'developer', 'features',
            'security', 'sitemap', 'education', 'mcp', 'users', 'billing', 'plans',
        ]);
        const segments = pathname.split('/');
        if (segments.length < 3) return false;

        const owner = segments[1];
        const repo = segments[2];
        const isSegment = segment => /^[A-Za-z0-9._-]+$/.test(segment) && !/^\.+$/.test(segment);
        if (!isSegment(owner) || !isSegment(repo) || reservedRoots.has(owner.toLowerCase())) return false;

        const extra = segments.slice(3);
        const isRoot = extra.length === 0 || (extra.length === 1 && extra[0] === '');
        if (isRoot) return !['enterprise_plan', 'sponsoring'].includes(repo.toLowerCase());
        if (extra.some(segment => segment === '' || segment === '.' || segment === '..')) return false;
        return I18N.conf.rePagePathRepo.test(pathname);
    }

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
        const isRepository = /\/<user-name>\/<repo-name>/.test(metaLocation)
            || hasRepositoryMetadata
            || (site === 'github'
                && isFallbackRepositoryPath(pathname));
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
     * 仅翻译当前页面明确列出的属性原文，并可进一步限定路径。
     */
    function transPageAttributes(node, rules) {
        for (const [selector, name, translations, pathname] of rules) {
            const text = node.getAttribute(name);
            if (!text) continue;
            if (maintenanceData.entries.length && hasCustomWrite(node, name, text)) continue;
            const normalized = GhcnMaintenance.normalize ? GhcnMaintenance.normalize(text) : text.trim().replace(/[\xa0\s]+/g, ' ');
            const custom = GhcnMaintenance.lookup(maintenanceData.entries, normalized, window.location);
            const translated = custom || translations[text];
            // 使用当前路径，避免 SPA 从议题视图返回列表后继续沿用视图排序规则。
            if (typeof translated === 'string' && translated !== text
                && (!pathname || pathname.test(window.location.pathname)) && node.matches(selector)) {
                if (custom) rememberCustomWrite(node, name, translated);
                node.setAttribute(name, translated);
            }
        }
    }

    /** 翻译页面标题。 */
    function transTitle() {
        if (!FeatureSet.enable_extension) return;
        const text = document.title; // 获取标题文本内容
        let translatedText = Object.hasOwn(pageConfig.titleStaticDict, text) ? pageConfig.titleStaticDict[text] : '';
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
        // 前面可能带空白，且部分版本会把 "opened on" 合并到同一个文本节点。
        // 同时只改承载文本的那个节点，避免用 el.textContent 赋值抹掉同级节点。
        const target = el.childNodes.length > 0 ? el.lastChild : el;
        const text = target.textContent;
        if (!text) return;

        const translatedText = text.replace(/\bon\s+/gi, (match, offset) => offset === 0 ? ' ' : '');
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
        if (maintenanceData.entries.length && hasCustomWrite(el, field, text)) return false;

        const translatedText = transText(text); // 翻译后的文本
        if (translatedText) {
            if (GhcnMaintenance.lookup(maintenanceData.entries, text.trim().replace(/[\xa0\s]+/g, ' '), window.location)) rememberCustomWrite(el, field, translatedText);
            el[field] = translatedText; // 替换翻译后的内容
        } else {
            const element = el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
            if (element?.closest?.('button, [role="button"], [role="menuitem"], [role="tab"], label')
                && !element.closest('article, .markdown-body, .comment-body, input, textarea, [contenteditable], [data-hovercard-type], .AppHeader-context, [role="listbox"], [role="option"]')) recordUiMiss(text);
        }
    }

    /**
     * transText 函数：翻译文本内容。
     * @param {string} text - 需要翻译的文本内容。
     * @returns {string|boolean} 翻译后的文本内容，如果没有找到对应的翻译，那么返回 false。
     */
    function transText(text) {
        const trimmedText = text.trim(); // 去除首尾空格
        if (!trimmedText) return false;
        const cleanedText = trimmedText.replace(/\xa0|[\s]+/g, ' '); // 去除多余空白字符（包括 &nbsp; 空格 换行符）

        if (typeof GhcnMaintenance !== 'undefined' && typeof maintenanceData !== 'undefined') {
            const customTranslation = GhcnMaintenance.lookup(maintenanceData.entries, cleanedText, window.location);
            if (customTranslation && customTranslation !== cleanedText) {
                return text.replace(trimmedText, () => customTranslation);
            }
        }

        // 判断是否需要跳过翻译
        //  1. 检查内容是否为空或者仅包含空白字符或数字。
        //  2. 检查内容是否仅包含中文字符。
        //  3. 检查内容是否不包含英文字母和符号。
        const shouldSkip = text => /^[\s0-9]*$/.test(text) || /^[\u4e00-\u9fa5]+$/.test(text) || !/[a-zA-Z,.]/.test(text);
        if (shouldSkip(text)) return false;

        // 尝试获取翻译结果
        const translatedText = fetchTranslatedText(cleanedText);

        // 如果找到翻译并且不与清理后的文本相同，则返回替换后的结果
        if (translatedText && translatedText !== cleanedText) {
            return text.replace(trimmedText, () => translatedText); // 替换原字符，保留首尾空白部分
        }

        return false;
    }

    /**
     * fetchTranslatedText 函数：从特定页面的词库中获得翻译文本内容。
     * @param {string} text - 需要翻译的文本内容。
     * @returns {string|boolean} 翻译后的文本内容，如果没有找到对应的翻译，那么返回 false。
     */
    function fetchTranslatedText(text) {
        const custom = GhcnMaintenance.lookup(maintenanceData.entries, text, window.location);
        if (custom) return custom;
        const cachedText = pageConfig.textCache.get(text);
        if (cachedText !== undefined) return cachedText;

        const cacheSet = (key, value) => {
            if (!pageConfig.textCache.has(key) && pageConfig.textCache.size >= 5000) {
                pageConfig.textCache.delete(pageConfig.textCache.keys().next().value);
            }
            pageConfig.textCache.set(key, value);
        };

        // 静态翻译
        let translatedText = Object.hasOwn(pageConfig.staticDict, text) ? pageConfig.staticDict[text] : undefined; // 默认翻译 公共部分

        if (typeof translatedText === 'string') {
            cacheSet(text, translatedText);
            return translatedText;
        }

        // 正则翻译
        for (const [pattern, replacement] of pageConfig.regexpRules) {
            translatedText = text.replace(pattern, replacement);
            if (translatedText !== text) {
                cacheSet(text, translatedText);
                return translatedText;
            }
        }

        cacheSet(text, false);
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

    // ==========================================================================
    // [Module] providers/provider-config.js
    // ==========================================================================


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
                if (!url || !key) {
                    return { ok: false, message: 'Azure Translator 需要 API 地址与 API Key。' };
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

            case 'index_translate': {
                const rawUrl = normalizeUrl(FeatureSet.readme_index_translate_api_url);
                const url = normalizeOpenAiEndpoint(rawUrl);
                const key = (FeatureSet.readme_index_translate_api_key || '').trim();
                const model = (FeatureSet.readme_index_translate_model || '').trim();
                if (!url || !model) {
                    return { ok: false, message: '哔哩哔哩翻译需要 API 地址与模型名（API Key 可留空）。' };
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
        const search = parsedUrl.search || '';
        if (/\/chat\/completions$/i.test(path)) {
            return `${parsedUrl.origin}${path}${search}`;
        }

        if (!path) {
            return `${parsedUrl.origin}${getProviderDefaultBasePath(hostname)}/chat/completions${search}`;
        }

        return `${parsedUrl.origin}${path}/chat/completions${search}`;
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

    // ==========================================================================
    // [Module] providers/cloud-translators.js
    // ==========================================================================

    async function translateWithDeepL(texts, providerConfig) {
        const data = await proxyFetchJson({
            url: providerConfig.url,
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${providerConfig.key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: texts,
                target_lang: mapTargetLangForDeepL(),
            }),
        });

        return {
            translations: (data?.translations || []).map(item => normalizeTranslationText(item?.text ?? item)),
            tokens: 0,
        };
    }

    async function translateWithGoogle(texts, providerConfig) {
        const url = new URL(providerConfig.url);
        url.searchParams.set('key', providerConfig.key);

        const data = await proxyFetchJson({
            url: url.toString(),
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({
                q: texts,
                target: providerConfig.targetLang,
                format: 'text',
            }),
        });

        return {
            translations: (data?.data?.translations || []).map(item => normalizeTranslationText(item?.translatedText ?? item)),
            tokens: 0,
        };
    }

    async function translateWithAzure(texts, providerConfig) {
        const url = new URL(providerConfig.url);
        url.searchParams.set('api-version', '3.0');
        url.searchParams.set('to', mapTargetLangForAzure());

        const headers = {
            'Content-Type': 'application/json; charset=UTF-8',
            'Ocp-Apim-Subscription-Key': providerConfig.key,
            'X-ClientTraceId': crypto?.randomUUID?.() || String(Date.now()),
        };
        if (providerConfig.region) {
            headers['Ocp-Apim-Subscription-Region'] = providerConfig.region;
        }

        const data = await proxyFetchJson({
            url: url.toString(),
            method: 'POST',
            headers,
            body: JSON.stringify(texts.map(text => ({ text }))),
        });

        return {
            translations: (data || []).map(item => normalizeTranslationText(item?.translations?.[0]?.text ?? item)),
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
            const translated = extractChatMessageContent(firstChoice);

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

        const headers = {
            'Content-Type': 'application/json',
        };
        if (providerConfig.key) {
            headers.Authorization = `Bearer ${providerConfig.key}`;
        }

        const data = await proxyFetchJson({
            url: providerConfig.url,
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        const firstChoice = data?.choices?.[0] || {};
        const raw = extractChatMessageContent(firstChoice);
        const tokens = getReadmeUsageTokens(data);

        try {
            return {
                translations: parseOpenAiArray(raw, texts.length),
                tokens,
            };
        } catch (error) {
            if (error && typeof error === 'object') {
                error.tokens = tokens;
            }
            throw error;
        }
    }

    function extractChatMessageContent(messageOrChoice) {
        const firstChoice = messageOrChoice?.message ? messageOrChoice : { message: messageOrChoice };
        const content = firstChoice?.message?.content ?? firstChoice?.message?.text ?? firstChoice?.text;
        return normalizeTranslationText(content);
    }

    function parseOpenAiArray(rawText, expectedLength) {
        let text = normalizeTranslationText(rawText);
        text = stripOpenAiReasoningBlocks(text);
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        if (!text || isObjectObjectArtifact(text)) {
            throw createRecoverableTranslationError('OpenAI 兼容接口返回内容无效。');
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            const start = text.indexOf('[');
            const end = text.lastIndexOf(']');
            if (start !== -1 && end !== -1 && end > start) {
                try {
                    parsed = JSON.parse(text.slice(start, end + 1));
                } catch {
                    throw createRecoverableTranslationError('OpenAI 兼容接口返回内容不是合法 JSON 数组。');
                }
            } else {
                throw createRecoverableTranslationError('OpenAI 兼容接口返回内容不是合法 JSON 数组。');
            }
        }

        if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.translations)) parsed = parsed.translations;
            else if (Array.isArray(parsed.data)) parsed = parsed.data;
            else if (Array.isArray(parsed.results)) parsed = parsed.results;
            else if (Array.isArray(parsed.texts)) parsed = parsed.texts;
        }

        if (!Array.isArray(parsed)) {
            throw createRecoverableTranslationError('OpenAI 兼容接口返回内容不是数组（或未包含 translations/data/results 数组字段）。');
        }

        if (parsed.length !== expectedLength) {
            throw createRecoverableTranslationError(`OpenAI 兼容接口返回数量不匹配，期望 ${expectedLength}，实际 ${parsed.length}`);
        }

        return parsed.map((item) => {
            const normalized = normalizeTranslationText(item);
            if (isObjectObjectArtifact(normalized)) {
                throw createRecoverableTranslationError('OpenAI 兼容接口返回了无法解析的对象条目。');
            }
            if (item && typeof item === 'object' && !Array.isArray(item) && !normalized) {
                throw createRecoverableTranslationError('OpenAI 兼容接口返回了无法解析的对象条目。');
            }
            return normalized;
        });
    }

    function stripOpenAiReasoningBlocks(text) {
        return String(text || '').replace(/^(?:\s*<think>[\s\S]*?<\/think>)+/i, '').trim();
    }

    function sendProxyMessageOnce(request) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome?.runtime?.id) {
                    reject(new Error(normalizeRuntimeErrorMessage(new Error('Extension context invalidated.'))));
                    return;
                }

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
            } catch (err) {
                reject(new Error(normalizeRuntimeErrorMessage(err)));
            }
        });
    }

    async function proxyFetchJson(request) {
        // MV3 后台 service worker 可能处于空闲/重启中，首个消息偶发
        // “Could not establish connection / message channel closed”，短暂退避后重试。
        // 注意：仅对“消息未送达后台”的瞬时失败重试；上下文失效需刷新页面，不重试。
        const maxAttempts = 3;
        const isConnectError = (error) => /Could not establish connection|Receiving end does not exist/i.test(error?.message || '');
        let response;
        for (let attempt = 1; ; attempt += 1) {
            try {
                response = await sendProxyMessageOnce(request);
                break;
            } catch (error) {
                if (isExtensionContextInvalidatedError(error) || !isConnectError(error) || attempt >= maxAttempts) {
                    throw error;
                }
                await new Promise((resolve) => window.setTimeout(resolve, 150 * attempt));
            }
        }

        if (!response) {
            throw new Error('翻译请求失败：后台未返回响应。');
        }

        const { ok, status, statusText, body, error, userMessage } = response;
        if (userMessage) throw new Error(userMessage);
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

        // 兼容官方端点、本地桥接及使用原模型名的中转接口。
        const isIndexTranslate = providerConfig?.provider === 'index_translate'
            || getProviderHost(providerConfig?.url) === 'index-translate.bilibili.com'
            || /(?:^|\/)Index-Translate(?:-|$)/i.test(String(providerConfig?.model || '').trim());
        if (isIndexTranslate) {
            payload.stream = false;
            payload.chat_template_kwargs = { ...payload.chat_template_kwargs, enable_thinking: false };
        } else if (isDeepSeekEndpoint(providerConfig?.url) || isKimiEndpoint(providerConfig?.url)) {
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

    // ==========================================================================
    // [Module] providers/dispatcher.js
    // ==========================================================================

    function setBoundedTranslationCache(key, value) {
        if (!readmeRuntime.translationCache) return;
        if (!readmeRuntime.translationCache.has(key) && readmeRuntime.translationCache.size >= 2000) {
            readmeRuntime.translationCache.delete(readmeRuntime.translationCache.keys().next().value);
        }
        readmeRuntime.translationCache.set(key, value);
    }

    function addBoundedPreservedCache(key) {
        if (!readmeRuntime.preservedCache) return;
        if (!readmeRuntime.preservedCache.has(key) && readmeRuntime.preservedCache.size >= 1000) {
            readmeRuntime.preservedCache.delete(readmeRuntime.preservedCache.keys().next().value);
        }
        readmeRuntime.preservedCache.add(key);
    }

    function isPlausiblePreservedText(text) {
        const input = String(text || '').trim();
        if (!input) return false;
        if (typeof isLikelyOpaqueReadmeLabel === 'function' && isLikelyOpaqueReadmeLabel(input)) return true;
        const normalizedVs = input.replace(/\bvs\.\s+(?=[A-Z])/gi, 'vs ');
        if (normalizedVs.length > 80 || /[.!?]$/.test(normalizedVs) || /[.!?]\s+[A-Z]/.test(normalizedVs)) return false;

        const tokens = normalizedVs.split(/\s+/).filter(Boolean);
        if (!tokens.length || tokens.length > 12) return false;

        const isConnector = (token) => /^(?:[+&/|·•–—×-]|vs\.?)$/i.test(token);
        if (isConnector(tokens[0]) || isConnector(tokens[tokens.length - 1])) return false;

        let hasConnector = false;
        let prevWasConnector = false;
        const words = [];
        for (const token of tokens) {
            if (isConnector(token)) {
                if (prevWasConnector) return false;
                hasConnector = true;
                prevWasConnector = true;
            } else {
                prevWasConnector = false;
                words.push(token);
            }
        }
        if (!words.length || words.length > (hasConnector ? 8 : 5)) return false;

        const proseIndicators = new Set([
            'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'will', 'would', 'should',
            'could', 'can', 'may', 'might', 'must', 'have', 'has', 'had', 'do', 'does', 'did',
            'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'if', 'when', 'where',
            'why', 'how', 'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'we',
            'our', 'please', 'click', 'run', 'install', 'see', 'read', 'use', 'using', 'support',
            'supports', 'allow', 'allows', 'require', 'requires', 'provide', 'provides', 'return',
            'returns', 'fail', 'fails', 'pending', 'sentence', 'properly', 'following', 'command',
            'more', 'less', 'about', 'only', 'also', 'here', 'there', 'now', 'then',
            'fast', 'simple', 'easy', 'reliable', 'flexible', 'powerful', 'lightweight',
            'getting', 'started', 'quick', 'overview', 'features', 'license', 'roadmap',
            'changelog', 'contributing', 'documentation', 'download', 'downloads', 'troubleshooting',
        ]);
        if (words.some((w) => proseIndicators.has(w.toLowerCase().replace(/[^a-z]/g, '')))) {
            return false;
        }
        return words.every((w) => {
            const clean = w.replace(/^[(\[]+|[)\]:,]+$/g, '');
            return /^[A-Z0-9][A-Za-z0-9.+_-]*$/.test(clean)
                || /^[a-z]{1,4}[A-Z][A-Za-z0-9.+_-]*$/.test(clean)
                || /^[b-df-hj-np-tv-xz]{2,10}$/.test(clean)
                || /^[a-z][a-z0-9]*\d[a-z0-9]*$/.test(clean)
                || /^(?:v\d[\w.-]*|cli|api|sdk|ui|ai|ml|db|os|io|js|ts|py|go|rs|x64|x86(?:_64)?|amd64|arm64|aarch64|armhf|armv7|i386|i686|ppc64le|s390x|riscv64|mips64|wasm(?:32|64)?)$/i.test(clean);
        });
    }

    async function translateTextsWithProvider(texts, providerConfig, options = {}) {
        const translatedMap = new Map();
        const uncached = [];
        let totalTokens = 0;
        const preferSingleItem = !!options.preferSingleItem;
        const debugContext = options.debugContext || null;
        const debugPhase = options.debugPhase || 'provider';

        texts.forEach(text => {
            const cacheKey = `${providerConfig.signature}|${text}`;
            const cached = normalizeTranslationText(readmeRuntime.translationCache.get(cacheKey));

            if (!preferSingleItem && isUsableTranslation(text, cached)) {
                translatedMap.set(text, cached);
            } else if (!preferSingleItem && readmeRuntime.preservedCache?.has(cacheKey)) {
                translatedMap.set(text, text);
            } else {
                if (cached && isObjectObjectArtifact(cached)) {
                    readmeRuntime.translationCache.delete(cacheKey);
                }
                uncached.push(text);
            }
        });

        const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
        const maxBatchItems = preferSingleItem
            ? 1
            : (usesAiBatchLimits ? README_CONFIG.OPENAI_MAX_BATCH_ITEMS : README_CONFIG.MAX_BATCH_ITEMS);
        const maxBatchChars = preferSingleItem
            ? Number.MAX_SAFE_INTEGER
            : (usesAiBatchLimits ? README_CONFIG.OPENAI_MAX_BATCH_CHARS : README_CONFIG.MAX_BATCH_CHARS);
        const requestedConcurrency = Number(options.concurrency);
        const batchConcurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency >= 1
            ? Math.floor(requestedConcurrency)
            : (preferSingleItem ? 2 : README_CONFIG.TRANSLATION_CONCURRENCY);
        const batches = buildBatches(uncached, maxBatchItems, maxBatchChars);
        addReadmeDebugEvent(debugContext, 'batches_created', {
            batchPhase: debugPhase,
            inputCount: texts.length,
            uncachedCount: uncached.length,
            batchCount: batches.length,
            concurrency: batchConcurrency,
            batchSizes: batches.map((batch) => batch.length),
        });
        const batchResults = await mapWithConcurrency(
            batches,
            batchConcurrency,
            async (batch, batchIndex) => {
                const startedAt = Date.now();
                addReadmeDebugEvent(debugContext, 'batch_start', {
                    batchPhase: debugPhase,
                    batch: batchIndex,
                    itemCount: batch.length,
                    texts: batch.slice(0, 24).map((text) => ({
                        textHash: createHash(text),
                        textPreview: sanitizeReadmeDebugText(text),
                    })),
                });

                try {
                    const batchResult = await translateBatchWithFallback(batch, providerConfig);
                    const batchTranslations = batchResult.translations;
                    const degradedFlags = batchResult.degradedFlags || batch.map(() => false);
                    let translatedItems = 0;
                    let extraTokens = 0;
                    const missedItems = [];
                    const preservedItems = [];

                    for (let index = 0; index < batch.length; index += 1) {
                        const text = batch[index];
                        const degraded = Boolean(degradedFlags[index]);
                        let translated = normalizeTranslationText(batchTranslations[index]);
                        let retryDegraded = false;
                        let retryRan = false;

                        if (!degraded && !isUsableTranslation(text, translated) && batch.length > 1) {
                            retryRan = true;
                            try {
                                const retry = await translateBatchWithFallback([text], providerConfig);
                                extraTokens += retry.tokens;
                                retryDegraded = Boolean(retry.degradedFlags?.[0]);
                                translated = normalizeTranslationText(retry.translations[0]);
                            } catch (error) {
                                retryDegraded = true;
                                if (isExtensionContextInvalidatedError(error)) {
                                    throw error;
                                }
                                console.warn('[README翻译] 单条重试失败:', error);
                            }
                        }

                        const cacheKey = `${providerConfig.signature}|${text}`;
                        if (isUsableTranslation(text, translated)) {
                            readmeRuntime.preservedCache?.delete(cacheKey);
                            setBoundedTranslationCache(cacheKey, translated);
                            translatedMap.set(text, translated);
                            translatedItems += 1;
                        } else if (!degraded
                            && (!retryRan || !retryDegraded)
                            && translated === text
                            && isPlausiblePreservedText(text)) {
                            addBoundedPreservedCache(cacheKey);
                            translatedMap.set(text, text);
                            preservedItems.push({
                                textHash: createHash(text),
                                textPreview: sanitizeReadmeDebugText(text),
                            });
                        } else {
                            translatedMap.set(text, text);
                            missedItems.push({
                                textHash: createHash(text),
                                textPreview: sanitizeReadmeDebugText(text),
                            });
                        }
                    }

                    const batchTotalTokens = batchResult.tokens + extraTokens;
                    addReadmeDebugEvent(debugContext, 'batch_end', {
                        batchPhase: debugPhase,
                        batch: batchIndex,
                        itemCount: batch.length,
                        translatedItems,
                        preservedItems,
                        missedItems,
                        tokens: batchTotalTokens,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    });
                    return batchTotalTokens;
                } catch (error) {
                    addReadmeDebugEvent(debugContext, 'batch_failed', {
                        batchPhase: debugPhase,
                        batch: batchIndex,
                        itemCount: batch.length,
                        message: normalizeRuntimeErrorMessage(error),
                        durationMs: Math.max(0, Date.now() - startedAt),
                    });
                    throw error;
                }
            },
        );
        totalTokens = batchResults.reduce((sum, tokens) => sum + tokens, 0);

        return {
            translatedMap,
            totalTokens,
        };
    }

    async function mapWithConcurrency(items, concurrency, worker) {
        const values = Array.isArray(items) ? items : [];
        if (!values.length) return [];

        const results = new Array(values.length);
        let nextIndex = 0;
        let aborted = false;
        const workerCount = Math.min(values.length, Math.max(1, Number(concurrency) || 1));

        const runWorker = async () => {
            while (!aborted) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= values.length) return;
                try {
                    results[index] = await worker(values[index], index);
                } catch (error) {
                    aborted = true;
                    throw error;
                }
            }
        };

        await Promise.all(Array.from({ length: workerCount }, runWorker));
        return results;
    }

    // 内容/解析类错误：HTTP 已成功，只是返回体不可解析，可降级为原文而不必中断整篇翻译。
    // 传输/鉴权/配置类错误不带此标记，仍会照常上抛以便向用户报错。
    function createRecoverableTranslationError(message) {
        const error = new Error(message);
        error.recoverable = true;
        return error;
    }

    function isTransientGatewayError(error) {
        if (!error || (typeof isExtensionContextInvalidatedError === 'function' && isExtensionContextInvalidatedError(error))) {
            return false;
        }
        const message = String(error?.message || error || '');
        if (/HTML 页面/.test(message)) return false;
        return /\(\s*(?:502|503|504)\b/.test(message)
            || /UNEXPECTED_EOF_WHILE_READING|ECONNRESET/i.test(message);
    }

    async function translateBatchWithFallback(batch, providerConfig, options = {}) {
        const gatewayRetriesLeft = Number.isInteger(options.gatewayRetriesLeft) ? options.gatewayRetriesLeft : 1;
        try {
            const result = await translateBatch(batch, providerConfig);
            const translations = result?.translations;
            const tokens = Math.max(0, Number(result?.tokens) || 0);

            if (!Array.isArray(translations) || translations.length !== batch.length) {
                const err = createRecoverableTranslationError('翻译结果数量与请求数量不一致，请检查接口配置。');
                err.tokens = tokens;
                throw err;
            }
            return {
                translations,
                degradedFlags: batch.map(() => false),
                tokens,
            };
        } catch (error) {
            if (gatewayRetriesLeft > 0 && isTransientGatewayError(error)) {
                const waitMs = 350;
                const delayFn = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
                    ? window.setTimeout.bind(window)
                    : setTimeout;
                await new Promise((resolve) => delayFn(resolve, waitMs));
                return translateBatchWithFallback(batch, providerConfig, {
                    gatewayRetriesLeft: gatewayRetriesLeft - 1,
                });
            }

            const isAiProvider = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';

            // 仅对 AI 接口的“内容/解析类”错误做降级；网络/鉴权/配置等错误继续上抛，
            // 避免把整篇静默留成英文、且能向用户报错。
            if (!isAiProvider || !error?.recoverable) {
                throw error;
            }

            // 单条仍失败：降级为原文占位（交由上层单条重试与补翻译 pass 处理），
            // 关键是让二分中已翻好的兄弟条目不再被一条坏内容连坐丢失。
            if (batch.length <= 1) {
                return {
                    translations: batch.slice(),
                    degradedFlags: batch.map(() => true),
                    tokens: Math.max(0, Number(error?.tokens) || 0),
                };
            }

            // OpenAI 兼容接口在部分平台上会因 JSON 输出不稳定导致整批失败，二分缩小坏条目的影响范围。
            const parentTokens = Math.max(0, Number(error?.tokens) || 0);
            const midpoint = Math.ceil(batch.length / 2);
            const left = await translateBatchWithFallback(batch.slice(0, midpoint), providerConfig);
            const right = await translateBatchWithFallback(batch.slice(midpoint), providerConfig);
            return {
                translations: [...left.translations, ...right.translations],
                degradedFlags: [...left.degradedFlags, ...right.degradedFlags],
                tokens: parentTokens + left.tokens + right.tokens,
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
            case 'index_translate':
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

    // ==========================================================================
    // [Module] features/markdown-translation.js
    // ==========================================================================

    function isRepositoryPage() {
        return (typeof pageConfig.currentPageType === 'string' && pageConfig.currentPageType.startsWith('repository'))
            || Boolean(getCurrentRepoInfo());
    }

    function isReadmePage() {
        const pageType = pageConfig.currentPageType;
        if (pageType === 'repository'
            || pageType === 'repository/tree'
            || pageType === 'repository/blob') {
            return true;
        }

        // GitHub Turbo/React 页面类型偶尔会短暂带有未知后缀；只要当前是仓库页
        // 且实际存在 README 根节点，就继续处理，避免 About 能翻译而 README 被跳过。
        return isRepositoryPage() && Boolean(getReadmeRootElement());
    }

    function isReadmeTranslationEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_readme_translation && isReadmePage();
    }

    function isRepoAboutTranslationEnabled() {
        return FeatureSet.enable_extension
            && FeatureSet.enable_readme_translation
            && (isRepositoryPage() || Boolean(getRepoAboutElement()));
    }

    function getReadmeRootElement() {
        for (const selector of README_CONFIG.ROOT_SELECTORS) {
            const elements = typeof document.querySelectorAll === 'function'
                ? document.querySelectorAll(selector)
                : [document.querySelector(selector)].filter(Boolean);
            for (const element of elements) {
                if (!element) continue;
                if (element.closest?.('[data-ghcn-chinese-readme]')) continue;
                // 避免在议题/PR 等页面误选普通 markdown 正文
                if (element.closest?.('.js-comment-body, [data-testid="markdown-body"], .comment-body')) {
                    continue;
                }

                return element;
            }
        }

        return null;
    }

    // 仓库侧栏 About 描述（兼容经典 UI、SidebarAbout CSS-module 和 BorderGrid 哈希类）。
    // 属仓库主自定义的自由文本，静态词库无法收录，故与 README 一样走 AI 内容翻译、就地替换。
    function getRepoAboutElements() {
        const elements = [];
        README_CONFIG.ABOUT_SELECTORS.forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                if (elements.includes(element)) return;
                if (element.closest('.js-comment-body, [data-testid="markdown-body"], .comment-body')) return;
                elements.push(element);
            });
        });
        return elements;
    }

    function getRepoAboutElement() {
        return getRepoAboutElements()[0] || null;
    }

    async function translateRepoAboutDescription(debugContext = null, reason = 'unknown') {
        const providerConfig = getProviderConfig();
        const aboutElements = getRepoAboutElements();
        if (!aboutElements.length) return 0;
        addReadmeDebugEvent(debugContext, 'about_start', { elementCount: aboutElements.length });
        if (!providerConfig.ok) {
            warnReadmeConfig(`About 描述未翻译：${providerConfig.message}`);
            addReadmeDebugEvent(debugContext, 'about_skipped', { reason: providerConfig.message });
            return 0;
        }

        const startAt = performance.now();
        const expectedHref = window.location.href;
        const runEpoch = readmeRuntime.runEpoch || 0;
        const initialAboutEnabled = Boolean(FeatureSet.enable_readme_translation);
        const isAboutRunValid = () => (readmeRuntime.runEpoch || 0) === runEpoch
            && FeatureSet.enable_extension
            && (!initialAboutEnabled || FeatureSet.enable_readme_translation)
            && window.location.href === expectedHref
            && aboutElements.some((el) => el.isConnected);

        const repoInfo = getCurrentRepoInfo();
        const elementsWithTasks = [];

        for (const aboutEl of aboutElements) {
            const tasks = collectReadmeTextTasks(aboutEl)
                .filter((task) => !isLikelyOpaqueReadmeLabel(task.normalizedText, task.node))
                .filter((task) => !isLikelyTechnicalReadmeText(task.normalizedText, task.node));
            if (tasks.length) {
                elementsWithTasks.push({ aboutEl, tasks });
            }
        }

        if (!elementsWithTasks.length) {
            addReadmeDebugEvent(debugContext, 'about_end', { translatedCount: 0, skipped: 'already_translated' });
            return 0;
        }

        const allTasks = elementsWithTasks.flatMap((item) => item.tasks);
        const uniqueTexts = [...new Set(allTasks.map((task) => task.normalizedText))];
        const sourceHash = createHash(uniqueTexts.join('||'));
        const signature = providerConfig.signature;
        const cacheKey = repoInfo && sourceHash && signature
            ? `about:${repoInfo.fullName}|${sourceHash}|${signature}`
            : '';

        let translatedCount = 0;
        let totalTokens = 0;

        if (cacheKey) {
            const cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true }).catch((error) => {
                if (isExtensionContextInvalidatedError(error)) throw error;
                return null;
            });
            if (!isAboutRunValid()) return 0;
            if (cached?.translatedHtml) {
                try {
                    const cachedData = JSON.parse(cached.translatedHtml);
                    if (cachedData?.translations && typeof cachedData.translations === 'object') {
                        hydrateReadmePreservedCache(signature, cached.preservedTexts);
                        const translatedMap = new Map(Object.entries(cachedData.translations));
                        for (const { aboutEl, tasks } of elementsWithTasks) {
                            if (!aboutEl.isConnected) continue;
                            const tasksByText = new Map();
                            tasks.forEach((task) => {
                                if (!tasksByText.has(task.normalizedText)) {
                                    tasksByText.set(task.normalizedText, []);
                                }
                                tasksByText.get(task.normalizedText).push(task);
                            });
                            translatedCount += withReadmeDomMutationGuard(() =>
                                applyTextGroupTranslations(aboutEl, tasksByText, uniqueTexts, translatedMap));
                            aboutEl.setAttribute('data-ghcn-about-translated', 'true');
                        }

                        addReadmeDebugEvent(debugContext, 'about_end', { translatedCount, cacheHit: true });
                        await appendReadmeTranslationRecord({
                            sourceType: 'about',
                            status: 'cache_hit',
                            tokens: 0,
                            durationMs: performance.now() - startAt,
                            sourceHash,
                            detail: 'about_cache_hit',
                        }).catch((error) => {
                            if (!isExtensionContextInvalidatedError(error)) {
                                console.warn('[About翻译] 写入缓存记录失败:', error);
                            }
                        });

                        return translatedCount;
                    }
                } catch {
                    // JSON 解析失败则回退至常规翻译
                }
            }
        }

        if (!isAboutRunValid()) return 0;
        const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig, {
            debugContext,
            debugPhase: 'about',
        });
        totalTokens = tokens;
        if (!isAboutRunValid()) return 0;

        for (const { aboutEl, tasks } of elementsWithTasks) {
            if (!aboutEl.isConnected) continue;
            const tasksByText = new Map();
            tasks.forEach((task) => {
                if (!tasksByText.has(task.normalizedText)) {
                    tasksByText.set(task.normalizedText, []);
                }
                tasksByText.get(task.normalizedText).push(task);
            });
            translatedCount += withReadmeDomMutationGuard(() =>
                applyTextGroupTranslations(aboutEl, tasksByText, uniqueTexts, translatedMap));
            aboutEl.setAttribute('data-ghcn-about-translated', 'true');
        }

        const preservedAboutTexts = [];
        let unresolvedAboutCount = 0;
        allTasks.forEach((task) => {
            if (!task.node?.isConnected) return;
            const liveText = normalizeText(task.node.data || '');
            if (liveText !== task.normalizedText) return;
            if (readmeRuntime.preservedCache?.has(`${signature}|${task.normalizedText}`)) {
                if (!preservedAboutTexts.includes(task.normalizedText)) {
                    preservedAboutTexts.push(task.normalizedText);
                }
                return;
            }
            unresolvedAboutCount += 1;
        });
        const isAboutComplete = unresolvedAboutCount === 0;

        addReadmeDebugEvent(debugContext, 'about_end', { translatedCount });

        if (translatedCount > 0 || totalTokens > 0) {
            if (cacheKey && isAboutComplete) {
                const cachePayload = {
                    translations: Object.fromEntries(translatedMap),
                };
                await upsertRepoCachedTranslation(cacheKey, {
                    repo: repoInfo?.fullName || '',
                    sourceHash,
                    translatedHtml: JSON.stringify(cachePayload),
                    complete: true,
                    preservedTexts: preservedAboutTexts,
                }).catch((error) => {
                    if (!isExtensionContextInvalidatedError(error)) {
                        console.warn('[About翻译] 写入缓存失败:', error);
                    }
                });
            }

            await appendReadmeTranslationRecord({
                sourceType: 'about',
                status: isAboutComplete ? 'success' : 'partial',
                tokens: totalTokens,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: `about_translated_nodes=${translatedCount}`,
            }).catch((error) => {
                if (!isExtensionContextInvalidatedError(error)) {
                    console.warn('[About翻译] 写入翻译记录失败:', error);
                }
            });
        }

        return translatedCount;
    }

    function getReadmeElementState(readmeEl) {
        if (!readmeRuntime.stateByElement.has(readmeEl)) {
            readmeRuntime.stateByElement.set(readmeEl, {
                originalHtml: '',
                translatedHash: '',
                translatedTextHash: '',
                translatedSignature: '',
            });
        }

        return readmeRuntime.stateByElement.get(readmeEl);
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


    function createReadmeDebugContext(reason) {
        if (!FeatureSet.readme_enable_debug) return null;

        return {
            runId: generateRecordId(),
            repo: getCurrentRepoInfo()?.fullName || 'unknown/unknown',
            reason: reason || 'unknown',
            provider: (FeatureSet.readme_provider || '').trim().toLowerCase(),
            createdAt: Date.now(),
            events: [],
        };
    }

    function sanitizeReadmeDebugText(text) {
        return truncateText(String(text || '')
            .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
            .replace(/(?:sk|gh[opsu]|xox[baprs])-?[A-Za-z0-9_-]{8,}/g, '[redacted]')
            .replace(/https?:\/\/[^\s)]+/gi, '[url]')
            .replace(/[\r\n\t]+/g, ' ')
            .trim(), README_CONFIG.DEBUG_TEXT_MAX_CHARS);
    }

    function describeReadmeDebugTask(task, rootEl) {
        const node = task?.node;
        const parent = node?.parentElement;
        const path = [];
        let current = parent;
        while (current && current !== rootEl && path.length < 5) {
            const tag = current.tagName?.toLowerCase() || 'element';
            const className = typeof current.className === 'string'
                ? current.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            path.unshift(className ? `${tag}.${className}` : tag);
            current = current.parentElement;
        }

        return {
            textHash: createHash(task?.normalizedText || ''),
            textPreview: sanitizeReadmeDebugText(task?.normalizedText),
            element: path.join(' > ') || 'unknown',
        };
    }

    function addReadmeDebugEvent(context, phase, detail = {}) {
        if (!context) return;

        const event = {
            at: Date.now(),
            ...detail,
            phase,
        };
        if (detail.status) context.status = detail.status;
        context.events.push(event);
        if (context.events.length > README_CONFIG.DEBUG_EVENT_MAX_ENTRIES) {
            context.events.splice(0, context.events.length - README_CONFIG.DEBUG_EVENT_MAX_ENTRIES);
        }
        console.debug('[README翻译调试]', context.runId, event);
    }

    async function flushReadmeDebugContext(context, status, summary = {}) {
        if (!context) return;

        const entry = {
            runId: context.runId,
            repo: context.repo,
            reason: context.reason,
            provider: context.provider,
            status: context.status || status,
            createdAt: context.createdAt,
            finishedAt: Date.now(),
            durationMs: Math.max(0, Date.now() - context.createdAt),
            summary,
            events: context.events,
        };

        try {
            const writeLogs = async () => {
                const existing = await getLocalValue(README_LOCAL_STORAGE_KEYS.DEBUG_LOGS, []);
                const logs = Array.isArray(existing) ? [...existing] : [];
                logs.push(entry);
                const sliced = logs.slice(-README_CONFIG.DEBUG_LOG_MAX_ENTRIES);
                const budgeted = typeof trimEntriesToByteBudget === 'function'
                    ? (() => {
                        const copy = [...sliced];
                        while (copy.length > 1 && estimateJsonUtf8Bytes(copy) > DEBUG_LOGS_MAX_BYTES) {
                            copy.shift();
                        }
                        return copy;
                    })()
                    : sliced;
                if (typeof setLocalValueWithQuotaRetry === 'function') {
                    await setLocalValueWithQuotaRetry(
                        README_LOCAL_STORAGE_KEYS.DEBUG_LOGS,
                        budgeted,
                        (list) => list.slice(-Math.max(1, Math.floor(list.length / 2))),
                    );
                } else {
                    await setLocalValue(README_LOCAL_STORAGE_KEYS.DEBUG_LOGS, budgeted);
                }
            };
            if (typeof enqueueLocalStorageWrite === 'function') {
                await enqueueLocalStorageWrite(writeLogs);
            } else {
                await writeLogs();
            }
        } catch (error) {
            if (!isExtensionContextInvalidatedError(error)) {
                console.warn('[README翻译调试] 保存调试日志失败:', error);
            }
        }
    }

    function pushReadmeDomMutationGuard() {
        readmeRuntime.domMutationGuardDepth += 1;
        readmeRuntime.isApplyingTranslation = true;
    }

    function popReadmeDomMutationGuard() {
        readmeRuntime.domMutationGuardDepth = Math.max(0, readmeRuntime.domMutationGuardDepth - 1);
        if (readmeRuntime.domMutationGuardDepth === 0) {
            window.setTimeout(() => {
                if (readmeRuntime.domMutationGuardDepth === 0) {
                    readmeRuntime.isApplyingTranslation = false;
                }
            }, 0);
        }
    }

    function withReadmeDomMutationGuard(callback) {
        pushReadmeDomMutationGuard();
        try {
            return callback();
        } finally {
            popReadmeDomMutationGuard();
        }
    }

    function refreshReadmeTextTaskNodes(rootEl, tasks) {
        if (!rootEl || !tasks.length) return tasks;

        const usedNodes = new Set();
        const resolved = tasks.map((task) => {
            const node = task?.node;
            const inRoot = typeof rootEl.contains !== 'function' || rootEl.contains(node);
            const matchesText = node && normalizeText(node.data || '') === task.normalizedText;
            if (node?.isConnected && inRoot && matchesText && !usedNodes.has(node)) {
                usedNodes.add(node);
                return task;
            }
            return null;
        });

        if (resolved.every(Boolean)) {
            return resolved;
        }

        const liveByText = new Map();
        collectReadmeTextTasks(rootEl)
            .filter((liveTask) => !isLikelyTechnicalReadmeText(liveTask.normalizedText, liveTask.node))
            .forEach((liveTask) => {
                if (!liveByText.has(liveTask.normalizedText)) {
                    liveByText.set(liveTask.normalizedText, []);
                }
                liveByText.get(liveTask.normalizedText).push(liveTask);
            });

        const refreshed = [];
        tasks.forEach((task, index) => {
            const existing = resolved[index];
            if (existing) {
                refreshed.push(existing);
                return;
            }

            const candidates = liveByText.get(task.normalizedText) || [];
            const replacement = candidates.find((candidate) => !usedNodes.has(candidate.node));
            if (replacement?.node) {
                usedNodes.add(replacement.node);
                refreshed.push(replacement);
            }
        });

        return refreshed;
    }

    function needsReadmeTranslation(text) {
        return !shouldSkipReadmeText(text);
    }

    function isUsableTranslation(sourceText, translatedText) {
        const translated = normalizeTranslationText(translatedText);
        return !!translated
            && !isObjectObjectArtifact(translated)
            && translated !== sourceText
            && needsReadmeTranslation(sourceText);
    }

    function applyTextGroupTranslations(rootEl, tasksByText, texts, translatedMap) {
        let translatedCount = 0;
        const translatableTasks = [];

        texts.forEach((text) => {
            const translated = normalizeTranslationText(translatedMap.get(text));
            if (!isUsableTranslation(text, translated)) return;
            (tasksByText.get(text) || []).forEach((task) => translatableTasks.push(task));
        });
        if (!translatableTasks.length) return 0;

        refreshReadmeTextTaskNodes(rootEl, translatableTasks).forEach((task) => {
            const translated = normalizeTranslationText(translatedMap.get(task.normalizedText));
            if (!isUsableTranslation(task.normalizedText, translated)) return;
            if (!task.node?.isConnected) return;
            task.node.data = task.rawText.replace(task.trimmedText, () => translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function sanitizeCachedHtmlTree(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;

        root.querySelectorAll('script, style, iframe, object, embed, form, base, meta, link, template, turbo-frame, turbo-stream')
            .forEach((node) => node.remove());

        const baseHref = typeof window !== 'undefined' && window.location?.href
            ? window.location.href
            : 'https://github.com/';
        const elements = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
        for (const el of elements) {
            if (el.attributes && typeof el.attributes[Symbol.iterator] === 'function') {
                for (const attr of [...el.attributes]) {
                    const attrName = String(attr.name || '').toLowerCase();
                    if (/^on/i.test(attrName)
                        || attrName === 'srcdoc'
                        || attrName === 'formaction'
                        || attrName.startsWith('data-turbo-')
                        || attrName === 'data-action'
                        || attrName === 'data-remote'
                        || attrName === 'data-method') {
                        el.removeAttribute(attr.name);
                    }
                }
            }

            for (const urlAttr of ['href', 'src', 'xlink:href', 'poster']) {
                if (!el.hasAttribute?.(urlAttr)) continue;
                const raw = String(el.getAttribute(urlAttr) || '').trim();
                if (!raw) {
                    el.removeAttribute(urlAttr);
                    continue;
                }
                if (raw.startsWith('#') && urlAttr === 'href') continue;
                try {
                    const resolved = new URL(raw, baseHref);
                    const allowedProtocols = urlAttr === 'href'
                        ? ['https:', 'http:', 'mailto:']
                        : ['https:', 'http:'];
                    if (!allowedProtocols.includes(resolved.protocol.toLowerCase())) {
                        el.removeAttribute(urlAttr);
                    }
                } catch {
                    el.removeAttribute(urlAttr);
                }
            }

            if (el.hasAttribute?.('srcset')) {
                const rawSrcset = String(el.getAttribute('srcset') || '');
                const parts = rawSrcset.split(',').map((part) => part.trim()).filter(Boolean);
                let validAll = parts.length > 0;
                for (const part of parts) {
                    const tokens = part.split(/\s+/);
                    if (tokens.length > 2 || !tokens[0]) {
                        validAll = false;
                        break;
                    }
                    try {
                        const resolved = new URL(tokens[0], baseHref);
                        if (!['https:', 'http:'].includes(resolved.protocol.toLowerCase())) {
                            validAll = false;
                            break;
                        }
                        if (tokens[1] && !/^(?:\d+w|\d+(?:\.\d+)?x)$/i.test(tokens[1])) {
                            validAll = false;
                            break;
                        }
                    } catch {
                        validAll = false;
                        break;
                    }
                }
                if (!validAll) {
                    el.removeAttribute('srcset');
                }
            }
        }
    }

    function replaceElementChildrenFromHtml(element, html) {
        const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
        sanitizeCachedHtmlTree(parsed.body);
        const nodes = Array.from(parsed.body.childNodes, node => document.importNode(node, true));
        element.replaceChildren(...nodes);
    }

    function applyReadmeHtml(readmeEl, html) {
        return withReadmeDomMutationGuard(() => {
            replaceElementChildrenFromHtml(readmeEl, html);
        });
    }

    function applyReadmeTextGroupTranslations(rootEl, tasksByText, texts, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTextGroupTranslations(rootEl, tasksByText, texts, translatedMap));
    }

    function applyTaskTranslations(rootEl, tasks, translatedMap) {
        let translatedCount = 0;

        refreshReadmeTextTaskNodes(rootEl, tasks).forEach((task) => {
            const translated = normalizeTranslationText(translatedMap.get(task.normalizedText));
            if (!isUsableTranslation(task.normalizedText, translated)) return;
            if (!task.node?.isConnected) return;

            task.node.data = task.rawText.replace(task.trimmedText, () => translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function applyReadmeTaskTranslations(rootEl, tasks, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTaskTranslations(rootEl, tasks, translatedMap));
    }

    async function waitForNextPaint() {
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
    }

    function restoreReadmeTranslation() {
        readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
        const readmeEl = getReadmeRootElement();
        if (!readmeEl) return;

        const state = getReadmeElementState(readmeEl);
        if (state.originalHtml && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        state.translatedHash = '';
        state.translatedTextHash = '';
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
                if (isExtensionContextInvalidatedError(err)) {
                    console.info('[README翻译] 插件上下文已失效（插件已更新或重载），请刷新当前 GitHub 页面后继续使用。');
                    return;
                }
                console.error('[README翻译] 执行失败:', err);
            });
        }, README_CONFIG.DEBOUNCE_MS);
    }

    async function runReadmeTranslation(reason) {
        const shouldTranslateReadme = isReadmeTranslationEnabled();
        const shouldPreferChinese = FeatureSet.enable_extension && FeatureSet.prefer_chinese_readme && isReadmePage();
        const shouldTranslateAbout = isRepoAboutTranslationEnabled();
        if (!shouldTranslateReadme && !shouldTranslateAbout && !shouldPreferChinese) {
            restoreChineseReadme();
            restoreReadmeTranslation();
            return;
        }

        if (readmeRuntime.inFlight) {
            readmeRuntime.rerunRequested = true;
            return;
        }

        const readmeEl = getReadmeRootElement();
        if (!readmeEl) restoreChineseReadme();
        if (!readmeEl && !getRepoAboutElement()) return;

        readmeRuntime.inFlight = true;
        const startAt = performance.now();
        const debugContext = createReadmeDebugContext(reason);
        let debugStatus = 'success';

        try {
            addReadmeDebugEvent(debugContext, 'run_start', {
                readmeEnabled: shouldTranslateReadme,
                aboutEnabled: shouldTranslateAbout,
            });
            // About 与 README 没有内容依赖，分别发起翻译请求；任一请求失败只告警，不影响另一部分。
            const translationTasks = [];
            if (shouldTranslateAbout) {
                translationTasks.push(translateRepoAboutDescription(debugContext, reason).catch((error) => {
                    if (isExtensionContextInvalidatedError(error)) {
                        readmeRuntime.rerunRequested = false;
                        return;
                    }
                    addReadmeDebugEvent(debugContext, 'about_failed', {
                        message: normalizeRuntimeErrorMessage(error),
                    });
                    console.warn('[About翻译] 执行失败:', error);
                }));
            }

            if ((shouldTranslateReadme || shouldPreferChinese) && readmeEl) {
                translationTasks.push((async () => {
                    if (await preferChineseReadme()) {
                        addReadmeDebugEvent(debugContext, 'readme_skipped', {
                            reason: (typeof chineseReadme !== 'undefined' && chineseReadme?.state?.root === readmeEl)
                                ? 'native_chinese_readme'
                                : 'waiting_react_hydration',
                        });
                        return;
                    }
                    if (shouldTranslateReadme && FeatureSet.enable_extension && readmeEl.isConnected
                        && readmeEl === getReadmeRootElement() && isReadmePage()) await translateReadmeElement(readmeEl, reason, debugContext);
                })());
            }

            await Promise.all(translationTasks);
        } catch (error) {
            debugStatus = 'failed';
            if (isExtensionContextInvalidatedError(error)) {
                readmeRuntime.rerunRequested = false;
                throw error;
            }
            addReadmeDebugEvent(debugContext, 'run_failed', {
                message: normalizeRuntimeErrorMessage(error),
            });
            const sourceHash = readmeEl
                ? getStableReadmeTextHash(getReadmeElementState(readmeEl).originalHtml || readmeEl.innerHTML || '')
                : '';
            await appendReadmeTranslationRecord({
                sourceType: 'readme',
                status: 'failed',
                tokens: 0,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: normalizeRuntimeErrorMessage(error),
            }).catch((recordError) => {
                if (!isExtensionContextInvalidatedError(recordError)) {
                    console.warn('[README翻译] 记录失败日志时出错:', recordError);
                }
            });
            throw error;
        } finally {
            addReadmeDebugEvent(debugContext, 'run_end', {
                durationMs: Math.max(0, performance.now() - startAt),
            });
            await flushReadmeDebugContext(debugContext, debugStatus, {
                durationMs: Math.max(0, performance.now() - startAt),
            });
            readmeRuntime.inFlight = false;
            if (readmeRuntime.rerunRequested) {
                readmeRuntime.rerunRequested = false;
                scheduleReadmeTranslation('rerun');
            }
        }
    }

    async function translateReadmeElement(readmeEl, reason, debugContext = null) {
        const startAt = performance.now();
        const expectedHref = window.location.href;
        const initialReadmeEnabled = Boolean(FeatureSet.enable_readme_translation);
        const runEpoch = readmeRuntime.runEpoch || 0;
        const isRunValid = () => (readmeRuntime.runEpoch || 0) === runEpoch
            && (typeof isPageExcluded !== 'function' || FeatureSet.enable_extension)
            && (!initialReadmeEnabled || FeatureSet.enable_readme_translation)
            && readmeEl.isConnected
            && window.location.href === expectedHref;
        const state = getReadmeElementState(readmeEl);
        const currentHash = createHash(readmeEl.innerHTML);
        const currentTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

        if (state.translatedHash && currentHash !== state.translatedHash) {
            if (state.translatedTextHash && currentTextHash === state.translatedTextHash) {
                // GitHub/React 只重建了等价 HTML（属性、节点包装或空白变化），保留翻译基线，
                // 避免把稳定的本地翻译误判成新内容并再次请求接口。
                state.translatedHash = currentHash;
            } else {
                // README 被重新渲染为新的文本内容时，才重置翻译状态。
                state.originalHtml = readmeEl.innerHTML;
                state.translatedHash = '';
                state.translatedTextHash = '';
                state.translatedSignature = '';
            }
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
        // 只根据 README 的可见文本生成内容指纹，忽略 GitHub React 动态属性和节点包装变化。
        // 这样刷新/软导航时可以命中本地仓库缓存，不会因 HTML 外壳变化重复调用接口。
        const sourceHash = getStableReadmeTextHash(state.originalHtml);
        const signature = createHash(`${providerConfig.signature}\n${sourceHash}`);
        addReadmeDebugEvent(debugContext, 'readme_start', {
            reason: reason || 'unknown',
            sourceHash,
            htmlLength: state.originalHtml.length,
        });
        if (state.translatedSignature === signature && currentHash === state.translatedHash) {
            addReadmeDebugEvent(debugContext, 'readme_skipped', { reason: 'already_translated' });
            return;
        }

        const sourceBody = typeof parseInertHtmlBody === 'function'
            ? parseInertHtmlBody(state.originalHtml)
            : readmeEl;
        const sourceText = normalizeText(sourceBody.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            if (readmeEl.innerHTML !== state.originalHtml) {
                applyReadmeHtml(readmeEl, state.originalHtml);
            }

            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
            return;
        }

        const repoCacheKey = buildRepoCacheKey(repoInfo, sourceHash, providerConfig.signature);
        // 兼容 2.5.9 之前按原始 HTML 建立的缓存；命中后会在下方迁移为稳定文本指纹。
        const legacyRepoCacheKey = buildRepoCacheKey(
            repoInfo,
            createHash(state.originalHtml),
            providerConfig.signature,
        );
        let cacheKeyUsed = repoCacheKey;
        let cacheHit = await getRepoCachedTranslation(repoCacheKey).catch((error) => {
            if (isExtensionContextInvalidatedError(error)) throw error;
            console.warn('[README翻译] 读取仓库缓存失败:', error);
            return null;
        });
        if (!isRunValid()) return;
        if (!cacheHit && legacyRepoCacheKey && legacyRepoCacheKey !== repoCacheKey) {
            cacheHit = await getRepoCachedTranslation(legacyRepoCacheKey).catch((error) => {
                if (isExtensionContextInvalidatedError(error)) throw error;
                console.warn('[README翻译] 读取旧版仓库缓存失败:', error);
                return null;
            });
            if (!isRunValid()) return;
            if (cacheHit) cacheKeyUsed = legacyRepoCacheKey;
        }

        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[README翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                applyReadmeHtml(readmeEl, cacheHit.translatedHtml);
                hydrateReadmePreservedCache(providerConfig.signature, cacheHit.preservedTexts);
                const cachedRemaining = cacheHit.complete === true
                    ? []
                    : collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                        .filter((task) => task.node?.isConnected);
                if (!cachedRemaining.length) {
                    state.translatedSignature = signature;
                    state.translatedHash = createHash(readmeEl.innerHTML);
                    state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

                    await appendReadmeTranslationRecord({
                        sourceType: 'readme',
                        status: 'cache_hit',
                        tokens: 0,
                        durationMs: performance.now() - startAt,
                        sourceHash,
                        detail: `cache_reason=${reason || 'unknown'}`,
                    }).catch((error) => {
                        if (!isExtensionContextInvalidatedError(error)) {
                            console.warn('[README翻译] 写入缓存命中记录失败:', error);
                        }
                    });
                    addReadmeDebugEvent(debugContext, 'cache_hit', {
                        cacheKey: cacheKeyUsed,
                        stableCacheKey: repoCacheKey,
                        migrated: cacheKeyUsed !== repoCacheKey,
                        htmlLength: cacheHit.translatedHtml.length,
                        complete: true,
                    });
                    if (cacheKeyUsed !== repoCacheKey || cacheHit.complete !== true) {
                        const preservedTexts = collectReadmePreservedTexts(readmeEl, providerConfig.signature);
                        await upsertRepoCachedTranslation(repoCacheKey, {
                            repo: repoInfo?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                            preservedTexts: preservedTexts.length ? preservedTexts : cacheHit.preservedTexts,
                        }).catch((error) => {
                            if (!isExtensionContextInvalidatedError(error)) {
                                console.warn('[README翻译] 迁移/补全仓库缓存失败:', error);
                            }
                        });
                    }
                    return;
                }

                partialCacheApplied = true;
                addReadmeDebugEvent(debugContext, 'partial_cache_hit', {
                    cacheKey: cacheKeyUsed,
                    stableCacheKey: repoCacheKey,
                    migrated: cacheKeyUsed !== repoCacheKey,
                    remaining: cachedRemaining.length,
                    htmlLength: cacheHit.translatedHtml.length,
                });
            }
        }

        let translatedCount = 0;
        let totalTokens = 0;
        let retryMissedCount = 0;

        if (!partialCacheApplied && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        const runTranslationPass = async (passName) => {
            if (!isRunValid()) return { translatedCount: 0, totalTokens: 0 };
            const tasks = (partialCacheApplied
                ? collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                : collectReadmeTextTasks(readmeEl))
                .filter((task) => !isLikelyOpaqueReadmeLabel(task.normalizedText, task.node))
                .filter((task) => !isLikelyTechnicalReadmeText(task.normalizedText, task.node));
            addReadmeDebugEvent(debugContext, 'pass_start', {
                pass: passName,
                taskCount: tasks.length,
                concurrency: README_CONFIG.TRANSLATION_CONCURRENCY,
                progressive: Boolean(FeatureSet.readme_enable_progressive),
                tasks: tasks.slice(0, 24).map((task) => describeReadmeDebugTask(task, readmeEl)),
            });
            if (!tasks.length) return { translatedCount: 0, totalTokens: 0 };

            const uniqueTexts = [...new Set(tasks.map(task => task.normalizedText))];
            const tasksByText = new Map();
            tasks.forEach((task) => {
                if (!tasksByText.has(task.normalizedText)) {
                    tasksByText.set(task.normalizedText, []);
                }
                tasksByText.get(task.normalizedText).push(task);
            });

            let passTranslatedCount = 0;
            let passTokens = 0;

            if (FeatureSet.readme_enable_progressive) {
                const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
                const groupSize = usesAiBatchLimits
                    ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                    : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
                const groups = buildProgressiveTaskGroups(readmeEl, tasks, groupSize);

                const groupResults = await mapWithConcurrency(
                    groups,
                    README_CONFIG.TRANSLATION_CONCURRENCY,
                    async (group, index) => {
                        if (!isRunValid()) {
                            return { applied: 0, tokens: 0 };
                        }
                        const groupTexts = [...new Set(group.map(task => task.normalizedText))];
                        const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(
                            groupTexts,
                            providerConfig,
                            { debugContext, debugPhase: passName, debugBatchIndex: index, concurrency: 1 },
                        );

                        // 软导航与开关防重入校验：若网络请求期间用户已跳转、关闭开关或节点已卸载，安全放弃本次 DOM 回填
                        if (!readmeEl.isConnected || window.location.href !== expectedHref || !isRunValid()) {
                            return { applied: 0, tokens: groupTokens };
                        }

                        const applied = applyReadmeTaskTranslations(readmeEl, group, translatedMap);
                        addReadmeDebugEvent(debugContext, 'group_applied', {
                            pass: passName,
                            batch: index,
                            requested: groupTexts.length,
                            applied,
                            tokens: groupTokens,
                        });
                        if (index < groups.length - 1 && isRunValid()) await waitForNextPaint();
                        return { applied, tokens: groupTokens };
                    },
                );
                groupResults.forEach(({ applied, tokens }) => {
                    passTokens += tokens;
                    passTranslatedCount += applied;
                });
            } else {
                const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(
                    uniqueTexts,
                    providerConfig,
                    { debugContext, debugPhase: passName, debugBatchIndex: 0 },
                );
                passTokens += tokens;

                if (!isRunValid()) {
                    return { translatedCount: 0, totalTokens: passTokens };
                }

                passTranslatedCount += applyReadmeTextGroupTranslations(readmeEl, tasksByText, uniqueTexts, translatedMap);
            }

            addReadmeDebugEvent(debugContext, 'pass_end', {
                pass: passName,
                translatedCount: passTranslatedCount,
                totalTokens: passTokens,
            });
            return { translatedCount: passTranslatedCount, totalTokens: passTokens };
        };

        const firstPass = await runTranslationPass('initial');
        translatedCount += firstPass.translatedCount;
        totalTokens += firstPass.totalTokens;

        if (!isRunValid()) {
            return;
        }

        // 补翻译：首轮后仍有未翻句子（渐进翻译期间 DOM 被 React 重渲染、或个别条目内容降级为原文），
        // 逐条重试收尾。以“无进展即停止 + 最多 maxRetryPasses 轮”双重保险避免空转。
        const maxRetryPasses = 2;
        for (let attempt = 0; attempt < maxRetryPasses; attempt += 1) {
            if (!isRunValid()) break;

            const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                .filter((task) => task.node?.isConnected);
            addReadmeDebugEvent(debugContext, 'retry_scan', {
                attempt,
                remaining: remainingTasks.length,
                tasks: remainingTasks.slice(0, 24).map((task) => describeReadmeDebugTask(task, readmeEl)),
            });
            if (!remainingTasks.length) break;
            if (attempt === 0) retryMissedCount = remainingTasks.length;

            const retryTexts = [...new Set(remainingTasks.map((task) => task.normalizedText))];
            const retryTasksByText = new Map();
            remainingTasks.forEach((task) => {
                if (!retryTasksByText.has(task.normalizedText)) {
                    retryTasksByText.set(task.normalizedText, []);
                }
                retryTasksByText.get(task.normalizedText).push(task);
            });

            if (!isRunValid()) break;
            const { translatedMap, totalTokens: retryTokens } = await translateTextsWithProvider(
                retryTexts,
                providerConfig,
                { preferSingleItem: true, debugContext, debugPhase: `retry_${attempt + 1}` },
            );
            totalTokens += retryTokens;

            if (!isRunValid()) break;

            const applied = applyReadmeTextGroupTranslations(readmeEl, retryTasksByText, retryTexts, translatedMap);
            translatedCount += applied;
            addReadmeDebugEvent(debugContext, 'retry_applied', {
                attempt,
                requested: retryTexts.length,
                applied,
                tokens: retryTokens,
            });
            if (!applied) break;
        }

        if (!isRunValid()) {
            return;
        }

        if (!translatedCount && !totalTokens && !partialCacheApplied
            && !collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                .some((task) => task.node?.isConnected)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
            return;
        }

        const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
            .filter((task) => task.node?.isConnected);
        const stillMissed = remainingTasks.length;
        addReadmeDebugEvent(debugContext, 'readme_end', {
            status: stillMissed ? 'partial' : 'success',
            translatedCount,
            retryMissedCount,
            remaining: stillMissed,
            remainingTasks: remainingTasks.slice(0, 24)
                .map((task) => describeReadmeDebugTask(task, readmeEl)),
        });
        state.translatedSignature = signature;
        state.translatedHash = createHash(readmeEl.innerHTML);
        state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

        if (!stillMissed || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(repoCacheKey, {
                repo: repoInfo?.fullName || '',
                sourceHash,
                translatedHtml: readmeEl.innerHTML,
                complete: !stillMissed,
                preservedTexts: collectReadmePreservedTexts(readmeEl, providerConfig.signature),
            }).catch((error) => {
                if (!isExtensionContextInvalidatedError(error)) {
                    console.warn('[README翻译] 写入仓库缓存失败:', error);
                }
            });
        }

        await appendReadmeTranslationRecord({
            sourceType: 'readme',
            status: stillMissed ? 'partial' : 'success',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `translated_nodes=${translatedCount};retry_missed=${retryMissedCount};remaining=${stillMissed}`,
        }).catch((error) => {
            if (!isExtensionContextInvalidatedError(error)) {
                console.warn('[README翻译] 写入翻译记录失败:', error);
            }
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
        const showMask = (NodeFilter.SHOW_ELEMENT || 1) | NodeFilter.SHOW_TEXT;
        const walker = document.createTreeWalker(readmeEl, showMask, {
            acceptNode(node) {
                if (node.nodeType === 1) {
                    return node.matches?.(README_CONFIG.SKIP_PARENT_SELECTOR)
                        ? (NodeFilter.FILTER_REJECT || 2)
                        : (NodeFilter.FILTER_ACCEPT || 1);
                }
                return (NodeFilter.FILTER_ACCEPT || 1);
            },
        });

        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType !== 3) continue;
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest?.(README_CONFIG.SKIP_PARENT_SELECTOR)) continue;

            const rawText = node.data;
            const trimmedText = rawText.trim();
            const normalizedText = normalizeText(trimmedText);

            if (shouldSkipReadmeText(normalizedText)) continue;

            tasks.push({ node, rawText, trimmedText, normalizedText });
        }

        return tasks;
    }


    function collectReadmeOriginalTextCounts(originalHtml) {
        const container = typeof parseInertHtmlBody === 'function'
            ? parseInertHtmlBody(originalHtml)
            : (() => {
                const div = document.createElement('div');
                div.innerHTML = String(originalHtml || '');
                return div;
            })();
        const counts = new Map();

        collectReadmeTextTasks(container).forEach((task) => {
            if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return;
            counts.set(task.normalizedText, (counts.get(task.normalizedText) || 0) + 1);
        });
        return counts;
    }

    function hydrateReadmePreservedCache(providerSignature, preservedTexts) {
        if (!providerSignature || !Array.isArray(preservedTexts) || !readmeRuntime.preservedCache) return;

        preservedTexts.forEach((item) => {
            if (typeof item !== 'string') return;
            const normalized = normalizeText(item);
            if (!normalized) return;
            readmeRuntime.preservedCache.add(`${providerSignature}|${normalized}`);
        });
    }

    function collectReadmePreservedTexts(readmeEl, providerSignature) {
        if (!readmeEl || !providerSignature || !readmeRuntime.preservedCache?.size) return [];

        const seen = new Set();
        const preservedTexts = [];
        collectReadmeTextTasks(readmeEl).forEach((task) => {
            if (!readmeRuntime.preservedCache.has(`${providerSignature}|${task.normalizedText}`)) return;
            if (seen.has(task.normalizedText)) return;
            seen.add(task.normalizedText);
            preservedTexts.push(task.normalizedText);
        });
        return preservedTexts;
    }

    function collectReadmeUntranslatedTasks(readmeEl, originalHtml, providerSignature = '') {
        const originalCounts = collectReadmeOriginalTextCounts(originalHtml);
        return collectReadmeTextTasks(readmeEl)
            .filter((task) => {
                if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return false;
                if (providerSignature && readmeRuntime.preservedCache?.has(`${providerSignature}|${task.normalizedText}`)) {
                    return false;
                }
                const remaining = originalCounts.get(task.normalizedText) || 0;
                if (!remaining) return false;

                originalCounts.set(task.normalizedText, remaining - 1);
                return true;
            });
    }

    // ==========================================================================
    // [Module] features/discussion-translation.js
    // ==========================================================================

    function isIssueOrPrDiscussionPage() {
        if (window.location.hostname !== 'github.com') return false;
        return /^\/[^/]+\/[^/]+\/(?:issues|pull|discussions)\/\d+(?:\/|$)/.test(window.location.pathname);
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

        const match = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\//);
        if (match?.[1] === 'issues') return 'issue';
        if (match?.[1] === 'pull') return 'pull';
        if (match?.[1] === 'discussions') return 'discussion';
        return 'issue';
    }

    function getDiscussionRecordSourceType(item) {
        return item?.sourceType || getIssuePrRecordSourceType();
    }

    function getDiscussionDocUrl() {
        if (typeof getDocumentUrlWithoutHash === 'function') {
            return getDocumentUrlWithoutHash();
        }
        const href = String(window?.location?.href || '');
        if (!href) return '';
        try {
            const parsed = new URL(href);
            parsed.hash = '';
            return parsed.href;
        } catch {
            return href.split('#')[0];
        }
    }

    function getIssuePrDiscussionState(item) {
        const keyEl = item?.markdownEl || item;
        if (!issuePrRuntime.stateByElement.has(keyEl)) {
            issuePrRuntime.stateByElement.set(keyEl, {
                originalHtml: '',
                translatedHash: '',
                translatedSignature: '',
                isBusy: false,
                runSeq: 0,
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
                if (markdownEl.closest('.js-preview-body, form, [data-testid="markdown-editor"]')) return null;

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

        const findMenuButton = (scope) => {
            if (!scope?.querySelector) return null;

            const menuSelectors = [
                '[data-testid="comment-header-hamburger"]',
                'svg.octicon-kebab-horizontal',
                'button[aria-label*="More" i]',
                'button[aria-label*="Actions" i]',
                'button[aria-label*="更多"]',
                'button[aria-label*="操作"]',
            ];
            for (const selector of menuSelectors) {
                const menuNode = scope.querySelector(selector);
                const menuButton = menuNode?.closest('button, [role="button"]');
                if (menuButton) return menuButton;
            }
            return null;
        };

        const belongsToItem = (candidate) => {
            if (!candidate) return false;
            const nestedBodies = candidate.querySelectorAll?.('.markdown-body:not(.ghcn-discussion-translation-panel), [data-testid="markdown-body"]:not(.ghcn-discussion-translation-panel)');
            if (nestedBodies && nestedBodies.length > 1) return false;
            const ownerComment = candidate.closest?.('[data-testid="issue-body"], [data-testid="comment-body"], [data-testid^="comment-viewer-outer-box"], .react-issue-comment, .timeline-comment, .js-comment');
            if (ownerComment && !ownerComment.contains(item.markdownEl)) return false;
            return true;
        };

        // 回复评论可能嵌套在同一个 timeline-comment-group 中；从正文向上查找，
        // 优先使用当前评论自己的操作菜单，避免误用父评论或标题区域的 flex 容器。
        let menuButton = null;
        let scope = item.markdownEl?.parentElement;
        while (scope && rootEl.contains(scope)) {
            menuButton = findMenuButton(scope);
            if (menuButton && belongsToItem(menuButton)) break;
            menuButton = null;
            if (scope === rootEl) break;
            scope = scope.parentElement;
        }
        menuButton ||= findMenuButton(rootEl);
        if (menuButton && !belongsToItem(menuButton)) menuButton = null;

        // 新版 GitHub 把三个点放在 .timeline-comment-actions 内层的 flex 行中；
        // 优先使用该行，避免插入块级外层后被换到上一行。
        const actionRow = menuButton?.closest('comment-actions-container')?.parentElement;
        if (belongsToItem(actionRow)) return actionRow;

        // 兼容旧版直接把菜单放在 .timeline-comment-actions 下的结构。
        const actionGroup = menuButton?.closest('.timeline-comment-actions');
        if (belongsToItem(actionGroup)) return actionGroup;

        // 当前 React 评论头部会把三点按钮包在 ActionsButtonsContainer 中；
        // 直接挂到该容器，才能让翻译按钮紧挨三点左侧，而不是排在贡献者标签之前。
        const menuButtonsContainer = menuButton?.closest('[class*="ActionsButtonsContainer"]');
        if (belongsToItem(menuButtonsContainer)) return menuButtonsContainer;

        const menuRow = menuButton?.closest('[data-testid="comment-header-right-side-items"], .timeline-comment-actions > .d-flex');
        if (belongsToItem(menuRow)) return menuRow;

        const commentActionsRow = rootEl.querySelector('comment-actions-container')?.parentElement;
        if (belongsToItem(commentActionsRow)) return commentActionsRow;

        const slotCandidates = [
            rootEl.querySelector('[data-testid="comment-header-right-side-items"] [class*="ActionsButtonsContainer"]'),
            rootEl.querySelector('[data-testid="comment-header-right-side-items"] [data-testid="comment-header-hamburger"]')?.parentElement,
            rootEl.querySelector('[data-testid="comment-header-right-side-items"]'),
            rootEl.querySelector('.timeline-comment-actions'),
            rootEl.querySelector('.timeline-comment-header .timeline-comment-actions'),
            rootEl.querySelector('[class*="actionsSection"]'),
            rootEl.querySelector('[class*="actionsWrapper"]'),
            rootEl.querySelector('[aria-label="Discussion actions"]')?.parentElement,
            rootEl.querySelector('[aria-label="Discussion comment actions"]')?.parentElement,
            rootEl.querySelector('[data-testid="discussion-comment-actions"]'),
            rootEl.querySelector('[aria-label="Issue body actions"]')?.parentElement,
            rootEl.querySelector('[aria-label="Comment actions"]')?.parentElement,
            rootEl.querySelector('[aria-label="讨论操作"]')?.parentElement,
            rootEl.querySelector('[aria-label="讨论评论操作"]')?.parentElement,
            rootEl.querySelector('[aria-label="议题正文操作"]')?.parentElement,
            rootEl.querySelector('[aria-label="评论操作"]')?.parentElement,
            rootEl.querySelector('[data-testid="issue-body-header-author"]')?.closest('[class*="activityHeader"]'),
        ];
        return slotCandidates.find(belongsToItem) || null;
    }

    function buildDiscussionCacheKey(item, sourceHash, signature) {
        const repoInfo = getCurrentRepoInfo();
        if (!repoInfo?.fullName || !sourceHash || !signature) return '';

        const sourceType = getDiscussionRecordSourceType(item);
        const discussionMatch = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\/(\d+)/);
        const discussionType = discussionMatch?.[1] || sourceType;
        const discussionNumber = discussionMatch?.[2] || getReleaseIdentifier(item) || 'unknown';
        const commentId = item?.rootEl?.id
            || item?.rootEl?.querySelector('a[href*="#issue-"], a[href*="#issuecomment-"], a[href*="#discussion_r"], a[href*="#discussioncomment-"]')?.hash?.slice(1)
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
                border: 1px solid var(--borderColor-muted, #d8dee4);
                border-left: 3px solid var(--borderColor-accent-emphasis, #0969da);
                margin: 12px 0 0;
                padding: 12px 16px;
                background: var(--bgColor-muted, #f6f8fa);
                border-radius: 6px;
                line-height: 1.6;
            }
            .ghcn-discussion-translation-panel blockquote {
                margin: 8px 0;
                padding: 0 1em;
                color: var(--fgColor-muted, #656d76);
                border-left: 0.25em solid var(--borderColor-default, #d0d7de);
            }
            [data-color-mode="dark"] .ghcn-discussion-translate-btn {
                background-color: var(--button-default-bgColor-rest, #21262d);
                border-color: var(--button-default-borderColor-rest, rgba(240, 246, 252, 0.1));
                color: var(--button-default-fgColor-rest, #c9d1d9);
            }
            [data-color-mode="dark"] .ghcn-discussion-translate-btn:hover {
                background-color: var(--button-default-bgColor-hover, #30363d);
                border-color: var(--button-default-borderColor-hover, #8b949e);
                color: var(--button-default-fgColor-rest, #ffffff);
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel {
                background: var(--bgColor-muted, #161b22) !important;
                border: 1px solid var(--borderColor-default, #30363d) !important;
                border-left: 3px solid var(--borderColor-accent-emphasis, #1f6feb) !important;
                color: var(--fgColor-default, #e6edf3) !important;
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel blockquote {
                color: var(--fgColor-muted, #848d97) !important;
                border-left-color: var(--borderColor-default, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel hr {
                background-color: var(--borderColor-default, #30363d) !important;
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
        const slotEl = findDiscussionActionsSlot(item);
        const existingToolbars = slotEl
            ? [...slotEl.querySelectorAll('[data-ghcn-discussion-translate="toolbar"]')]
            : (item.sourceType === 'release' && item.viewerEl
                ? [...item.viewerEl.querySelectorAll('[data-ghcn-discussion-translate="toolbar"]')]
                : []);
        const toolbar = state.toolbarEl?.isConnected
            ? state.toolbarEl
            : existingToolbars[0] || null;

        if (toolbar) {
            // React 可能替换正文节点但保留评论操作行；该新正文会有新的 WeakMap 状态，
            // 因此先复用操作行中已有工具条，并清理旧扫描/旧状态留下的重复节点。
            existingToolbars.forEach((existingToolbar) => {
                if (existingToolbar !== toolbar) existingToolbar.remove();
            });
            let contentChanged = false;
            if (!state.isBusy && state.translatedEl && state.translatedHash) {
                const liveHash = createHash(item.markdownEl.innerHTML);
                if (liveHash !== state.translatedHash) {
                    contentChanged = true;
                    restoreIssuePrBody(item);
                }
            }
            const needsRender = contentChanged || state.toolbarEl !== toolbar;
            state.toolbarEl = toolbar;
            // GitHub 的 Turbo/React 重绘可能保留旧工具条节点；每次扫描都把它
            // 重新归位到三个点所在的操作行，避免遗留在 header 顶部。
            if (slotEl && toolbar.parentElement !== slotEl) {
                slotEl.insertBefore(toolbar, slotEl.firstChild);
            }
            if (needsRender) renderDiscussionToolbar(item);
            return;
        }

        if (!slotEl && item.sourceType !== 'release') return;

        const newToolbar = document.createElement('div');
        newToolbar.className = 'ghcn-discussion-translate-toolbar';
        if (item.sourceType === 'release') {
            newToolbar.classList.add('ghcn-discussion-translate-toolbar--release');
        }
        newToolbar.dataset.ghcnDiscussionTranslate = 'toolbar';

        state.toolbarEl = newToolbar;
        renderDiscussionToolbar(item);
        if (slotEl) {
            slotEl.insertBefore(newToolbar, slotEl.firstChild);
        } else if (item.sourceType === 'release') {
            item.viewerEl.insertBefore(newToolbar, item.markdownEl);
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
                    if (error?.__ghcnStaleRun) return;
                    if (typeof isExtensionContextInvalidatedError !== 'function' || !isExtensionContextInvalidatedError(error)) {
                        console.error('[Issue/PR翻译] 执行失败:', error);
                    }
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

        const runEpoch = issuePrRuntime.runEpoch || 0;
        const runId = (state.runSeq || 0) + 1;
        state.runSeq = runId;
        const isCurrentRun = () => state.runSeq === runId && (issuePrRuntime.runEpoch || 0) === runEpoch;

        clearIssuePrError(state.toolbarEl);
        state.errorMessage = '';

        state.isBusy = true;
        renderDiscussionToolbar(item);

        try {
            const completed = await translateIssuePrBody(item, { runEpoch, runId });
            if (completed && isCurrentRun() && state.translatedEl) {
                setDiscussionViewMode(item, 'translated');
            }
        } catch (error) {
            if (!isCurrentRun()) {
                if (error && typeof error === 'object') {
                    error.__ghcnStaleRun = true;
                }
                throw error;
            }
            state.errorMessage = normalizeRuntimeErrorMessage(error);
            throw error;
        } finally {
            if (isCurrentRun()) {
                state.isBusy = false;
                renderDiscussionToolbar(item);
            }
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
        state.runSeq = (state.runSeq || 0) + 1;
        state.isBusy = false;
        state.translatedEl?.remove();
        state.translatedEl = null;
        if (state.toolbarEl && !state.toolbarEl.isConnected) {
            state.toolbarEl = null;
        }
        state.mode = 'original';
        state.originalHtml = '';
        state.translatedHash = '';
        state.translatedSignature = '';
        item.markdownEl?.removeAttribute('data-ghcn-discussion-hidden');
        item.markdownEl?.removeAttribute('data-ghcn-discussion-view-mode');
        renderDiscussionToolbar(item);
    }

    function restoreIssuePrTranslations() {
        issuePrRuntime.runEpoch = (issuePrRuntime.runEpoch || 0) + 1;
        document.querySelectorAll('[data-ghcn-discussion-translate="toolbar"]').forEach((toolbar) => toolbar.remove());
        document.querySelectorAll('.ghcn-discussion-translation-panel').forEach((panel) => panel.remove());
        document.querySelectorAll('[data-ghcn-discussion-hidden]').forEach((el) => {
            el.removeAttribute('data-ghcn-discussion-hidden');
            el.removeAttribute('data-ghcn-discussion-view-mode');
            delete el.dataset.ghcnDiscussionTranslate;
        });
        findDiscussionItems().forEach((item) => {
            restoreIssuePrBody(item);
            delete item.markdownEl.dataset.ghcnDiscussionTranslate;
        });
    }

    async function translateIssuePrBody(item, options = {}) {
        const startAt = performance.now();
        const expectedDocUrl = getDiscussionDocUrl();
        const state = getIssuePrDiscussionState(item);
        const markdownEl = item.markdownEl;
        const runEpoch = options.runEpoch ?? (issuePrRuntime.runEpoch || 0);
        const runId = options.runId ?? (state.runSeq || 0);
        const isCurrentRun = () => (issuePrRuntime.runEpoch || 0) === runEpoch && (state.runSeq || 0) === runId;
        const isRunValid = () => isCurrentRun()
            && getDiscussionDocUrl() === expectedDocUrl
            && markdownEl.isConnected
            && FeatureSet.enable_extension
            && FeatureSet.enable_issue_pr_translation;

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
            return true;
        }

        const sourceText = normalizeText(markdownEl.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            return false;
        }

        const cacheKey = buildDiscussionCacheKey(item, sourceHash, providerConfig.signature);
        const cacheHit = await getRepoCachedTranslation(cacheKey).catch((error) => {
            if (typeof isExtensionContextInvalidatedError === 'function' && isExtensionContextInvalidatedError(error)) {
                throw error;
            }
            console.warn('[Issue/PR翻译] 读取讨论缓存失败:', error);
            return null;
        });
        if (!isRunValid()) return false;

        let translatedEl = createTranslatedClone(markdownEl);
        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[Issue/PR翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                replaceElementChildrenFromHtml(translatedEl, cacheHit.translatedHtml);
                if (cacheHit.preservedTexts && typeof hydrateReadmePreservedCache === 'function') {
                    hydrateReadmePreservedCache(providerConfig.signature, cacheHit.preservedTexts);
                }
                const cachedRemaining = cacheHit.complete === true
                    ? []
                    : collectIssuePrTextTasks(translatedEl)
                        .filter((task) => !readmeRuntime.preservedCache?.has(`${providerConfig.signature}|${task.normalizedText}`));
                if (!cachedRemaining.length) {
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
                        if (typeof isExtensionContextInvalidatedError !== 'function' || !isExtensionContextInvalidatedError(error)) {
                            console.warn('[Issue/PR翻译] 写入缓存命中记录失败:', error);
                        }
                    });
                    if (!isRunValid()) return false;
                    if (cacheHit.complete !== true) {
                        const preservedTexts = [...new Set(
                            collectIssuePrTextTasks(translatedEl)
                                .map((task) => task.normalizedText)
                                .filter((text) => readmeRuntime.preservedCache?.has(`${providerConfig.signature}|${text}`)),
                        )];
                        await upsertRepoCachedTranslation(cacheKey, {
                            repo: getCurrentRepoInfo()?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                            preservedTexts,
                        }).catch((error) => {
                            if (typeof isExtensionContextInvalidatedError !== 'function' || !isExtensionContextInvalidatedError(error)) {
                                console.warn('[Issue/PR翻译] 补全讨论缓存状态失败:', error);
                            }
                        });
                    }
                    return true;
                }

                partialCacheApplied = true;
            }
        }

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

        try {
            if (FeatureSet.readme_enable_progressive) {
                const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
                const groupSize = usesAiBatchLimits
                    ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                    : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
                const groups = buildProgressiveTaskGroupsByBlock(translatedEl, tasks, groupSize, ISSUE_PR_CONFIG.BLOCK_SELECTOR);

                for (let index = 0; index < groups.length; index += 1) {
                    if (!isRunValid()) {
                        if (isCurrentRun()) restoreIssuePrBody(item);
                        return false;
                    }
                    const groupTexts = [...new Set(groups[index].map(task => task.normalizedText))];
                    const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(groupTexts, providerConfig);
                    if (!isRunValid()) {
                        if (isCurrentRun()) restoreIssuePrBody(item);
                        return false;
                    }
                    totalTokens += groupTokens;
                    translatedCount += applyTaskTranslations(translatedEl, groups[index], translatedMap);

                    if (index < groups.length - 1) {
                        await waitForNextPaint();
                    }
                }
            } else {
                const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig);
                if (!isRunValid()) {
                    if (isCurrentRun()) restoreIssuePrBody(item);
                    return false;
                }
                totalTokens += tokens;
                translatedCount += applyTextGroupTranslations(translatedEl, tasksByText, uniqueTexts, translatedMap);
            }
        } catch (error) {
            if (isCurrentRun()) {
                restoreIssuePrBody(item);
            }
            throw error;
        }

        if (!isRunValid()) {
            if (isCurrentRun()) restoreIssuePrBody(item);
            return false;
        }

        const remainingTasks = collectIssuePrTextTasks(translatedEl)
            .filter((task) => !readmeRuntime.preservedCache?.has(`${providerConfig.signature}|${task.normalizedText}`));
        const complete = !remainingTasks.length;
        state.translatedSignature = complete ? signature : '';
        state.translatedHash = complete ? createHash(markdownEl.innerHTML) : '';
        state.sourceHash = sourceHash;
        state.errorMessage = '';

        const preservedTexts = [...new Set(
            collectIssuePrTextTasks(translatedEl)
                .map((task) => task.normalizedText)
                .filter((text) => readmeRuntime.preservedCache?.has(`${providerConfig.signature}|${text}`)),
        )];

        if (complete || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(cacheKey, {
                repo: getCurrentRepoInfo()?.fullName || '',
                sourceHash,
                translatedHtml: translatedEl.innerHTML,
                complete,
                preservedTexts,
            }).catch((error) => {
                if (typeof isExtensionContextInvalidatedError !== 'function' || !isExtensionContextInvalidatedError(error)) {
                    console.warn('[Issue/PR翻译] 写入讨论缓存失败:', error);
                }
            });
        }

        await appendReadmeTranslationRecord({
            sourceType: getDiscussionRecordSourceType(item),
            status: complete ? 'success' : 'partial',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `${getDiscussionRecordSourceType(item)}_translated_nodes=${translatedCount}`,
        }).catch((error) => {
            if (typeof isExtensionContextInvalidatedError !== 'function' || !isExtensionContextInvalidatedError(error)) {
                console.warn('[Issue/PR翻译] 写入翻译记录失败:', error);
            }
        });
        return true;
    }

    function createTranslatedClone(markdownEl) {
        const translatedEl = markdownEl.cloneNode(true);
        translatedEl.classList.add('ghcn-discussion-translation-panel');
        translatedEl.removeAttribute('id');
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

            if (shouldSkipReadmeText(normalizedText)
                || (typeof isLikelyTechnicalReadmeText === 'function' && isLikelyTechnicalReadmeText(normalizedText, node))) continue;

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

    // ==========================================================================
    // [Module] features/collaboration-helper.js
    // ==========================================================================

    const COLLAB_CONFIG = {
        DEBOUNCE_MS: 160,
        TEXTAREA_SELECTORS: [
            // Primer & React markdown editors
            'textarea[data-testid="markdown-editor-text-area"]',
            'textarea[data-testid*="editor"]',
            'textarea[data-testid*="comment"]',
            '[data-component="MarkdownEditor"] textarea',
            '[data-testid="markdown-editor"] textarea',
            '[data-testid="comment-composer"] textarea',

            // New Issue & Issue Forms / Templates
            'form.new_issue textarea',
            'form#new_issue textarea',
            'form[action*="/issues"] textarea',
            'textarea[name^="issue["]',
            'textarea[name^="issue_form["]',
            'textarea[id^="issue_"]',
            'textarea#issue_body',

            // New Pull Request & Compare
            'form.new_pull_request textarea',
            'form#new_pull_request textarea',
            'form.js-new-pr-form textarea',
            'form[action*="/pull"] textarea',
            'form[action$="/pulls"] textarea',
            'form[action*="/compare"] textarea',
            '[data-testid="compare-pr-form"] textarea',
            'textarea[name^="pull_request["]',
            'textarea[id^="pull_request_"]',
            'textarea#pull_request_body',

            // Comments & Discussions
            'textarea#new_comment_field',
            'textarea#discussion_body',
            'textarea[name^="comment["]',
            'textarea[name^="discussion["]',
            'textarea[name^="discussion_comment["]',
            'form.js-new-comment-form textarea',
            'form.js-comment-update textarea',
            'textarea.js-comment-field',
            'textarea.comment-form-textarea',
            '.js-previewable-comment-form textarea',
        ].join(', '),
    };

    const COLLAB_ICONS = {
        sparkle: '<svg class="octicon octicon-sparkle" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.492 7.492 0 0 0 4.464 4.464l1.306.478a.5.5 0 0 1 0 .94l-1.306.478a7.492 7.492 0 0 0-4.464 4.464l-.478 1.306a.5.5 0 0 1-.94 0l-.478-1.306a7.492 7.492 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.492 7.492 0 0 0 4.464-4.464Z"></path></svg>',
    };

    const COLLAB_MODES = [
        { id: 'bug', label: 'Bug 反馈', desc: '规范化 Issue 缺陷报告（重现步骤、预期行为等）' },
        { id: 'feature', label: '功能建议', desc: '规范化 Feature Request（背景动机、设计方案等）' },
        { id: 'reply', label: '讨论回复', desc: '得体、清晰的开源 PR/Issue 评审与讨论回复' },
        { id: 'general', label: '通用润色', desc: '通用地道英文技术 Markdown 润色' },
    ];

    const COLLAB_PROMPTS = {
        bug: `You are an expert open-source maintainer and technical writer. Transform the user's Chinese draft into a professional, structured, idiomatic English GitHub Bug Report in Markdown.
Structure it with clean Markdown sections such as:
### Description
### Steps to Reproduce
### Expected Behavior
### Actual Behavior
### Environment (if applicable)

Strict rules:
1. Retain all code snippets, terminal commands, log traces, error messages, URLs, version numbers, and variable names verbatim.
2. Translate all Chinese descriptions into concise, professional, idiomatic technical English commonly used in leading GitHub projects.
3. Output ONLY the raw Markdown content. Do NOT include any conversational preamble, greetings, or postscript comments.`,

        feature: `You are an expert open-source maintainer and technical writer. Transform the user's Chinese draft into a professional, structured, idiomatic English GitHub Feature Request in Markdown.
Structure it with clean Markdown sections such as:
### Problem Statement / Motivation
### Proposed Solution
### Alternatives Considered (if applicable)
### Additional Context

Strict rules:
1. Retain all code snippets, terminal commands, URLs, and variable names verbatim.
2. Translate all Chinese descriptions into clear, persuasive, idiomatic technical English.
3. Output ONLY the raw Markdown content. Do NOT include any conversational preamble, greetings, or postscript comments.`,

        reply: `You are an expert open-source maintainer and technical writer. Transform the user's Chinese draft into a polite, clear, concise, and professional English reply for a GitHub Issue or Pull Request discussion.

Strict rules:
1. Preserve all code blocks, technical terms, commit hashes, PR/Issue references (#123), and usernames (@name).
2. Use respectful, constructive open-source collaboration tone.
3. Output ONLY the raw Markdown content. Do NOT include any conversational preamble or greetings before the content.`,

        general: `You are an expert technical writer for GitHub open-source repositories. Polish the user's draft into clean, professional, concise, and idiomatic technical English Markdown.

Strict rules:
1. Retain all code blocks, commands, URLs, variables, and technical formatting verbatim.
2. Improve clarity, grammar, tone, and technical phrasing.
3. Output ONLY the raw Markdown content. Do NOT include any conversational preamble or pleasantries.`,
    };

    function isCollaborationHelperEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_collaboration_helper && window.location.hostname === 'github.com';
    }

    let collabListenersAttached = false;
    function ensureCollaborationGlobalListeners() {
        if (collabListenersAttached) return;
        collabListenersAttached = true;

        // 1. 用户聚焦到任意输入框时，若尚未挂载润色助手则立即触发扫描挂载
        document.addEventListener('focusin', (event) => {
            const target = event.target;
            if (target && target.tagName === 'TEXTAREA') {
                if (isCollaborationHelperEnabled()) {
                    scheduleCollaborationHelperControls('textarea:focusin', true);
                }
            }
        }, { passive: true });

        // 2. 用户点击页面按钮或选项卡（如 "Create pull request"、"Write" 选项卡、展开抽屉、模板选择等）
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target) return;
            const interactiveEl = target.closest?.(
                'button, a, summary, [role="tab"], [data-details-container], .btn, .tabnav-tab'
            );
            if (interactiveEl && isCollaborationHelperEnabled()) {
                scheduleCollaborationHelperControls('document:click');
            }
        }, { passive: true });
    }

    function scheduleCollaborationHelperControls(reason, immediate = false) {
        if (!FeatureSet.enable_extension) return;

        if (collabRuntime.timerId) {
            window.clearTimeout(collabRuntime.timerId);
            collabRuntime.timerId = 0;
        }

        const delay = immediate ? 10 : COLLAB_CONFIG.DEBOUNCE_MS;
        collabRuntime.timerId = window.setTimeout(() => {
            collabRuntime.timerId = 0;
            setupCollaborationHelperControls(reason);
        }, delay);
    }

    function setupCollaborationHelperControls() {
        if (!isCollaborationHelperEnabled()) {
            restoreCollaborationHelperControls();
            return;
        }

        ensureCollaborationGlobalListeners();
        injectCollaborationControlStyles();

        findCollaborationTextareas().forEach((textarea) => {
            mountCollaborationToolbar(textarea);
        });
    }

    function restoreCollaborationHelperControls() {
        document.querySelectorAll('[data-ghcn-collab-btn]').forEach((btn) => btn.remove());
        document.querySelectorAll('.ghcn-collab-fallback-bar').forEach((bar) => bar.remove());
        closeCollaborationModal();
    }

    function isValidCollaborationTextarea(el) {
        if (!el || !el.isConnected) return false;
        if (el.tagName !== 'TEXTAREA') return false;
        if (el.disabled || el.readOnly) return false;
        if (el.closest('.ghcn-collab-modal')) return false;
        if (el.type === 'hidden' || el.hasAttribute('hidden')) return false;

        // 过滤搜索框与密钥/Token等敏感输入字段
        const nameOrId = `${el.name || ''} ${el.id || ''} ${el.className || ''}`.toLowerCase();
        if (/token|secret|password|credential|private_key/i.test(nameOrId)) return false;

        return true;
    }

    function findCollaborationTextareas() {
        const found = new Set();

        // 1. 常规选择器批量发现
        document.querySelectorAll(COLLAB_CONFIG.TEXTAREA_SELECTORS).forEach((el) => {
            if (isValidCollaborationTextarea(el)) {
                found.add(el);
            }
        });

        // 2. 由 markdown-toolbar 的 for 属性反查绑定的 textarea (精确 1:1 关系)
        document.querySelectorAll('markdown-toolbar[for], markdown-toolbar[data-for], [role="toolbar"][data-for]').forEach((toolbar) => {
            const targetId = toolbar.getAttribute('for') || toolbar.getAttribute('data-for');
            if (targetId) {
                const targetEl = document.getElementById(targetId);
                if (isValidCollaborationTextarea(targetEl)) {
                    found.add(targetEl);
                }
            }
        });

        // 3. 由 markdown-toolbar 所在容器向下反查 textarea
        document.querySelectorAll('markdown-toolbar:not([for])').forEach((toolbar) => {
            const container = toolbar.closest('.js-previewable-comment-form, [data-component="MarkdownEditor"], [data-testid="markdown-editor"], .form-group, form') || toolbar.parentElement;
            if (container) {
                const targetEl = container.querySelector('textarea');
                if (isValidCollaborationTextarea(targetEl)) {
                    found.add(targetEl);
                }
            }
        });

        return [...found];
    }

    function findCollaborationToolbarMountPoint(textarea) {
        if (!textarea) return null;

        const toolbarSelectors = [
            'markdown-toolbar',
            '[aria-label="Formatting tools"]',
            '[aria-label="格式化工具"]',
            '[role="toolbar"]',
            '[data-testid="markdown-editor-toolbar"]',
            '[data-testid="markdown-editor-actions"]',
            '[class*="MarkdownEditor-module__toolbar"]',
            '[class*="MarkdownEditor-module__actions"]',
            '.markdown-toolbar',
            '.tabnav-extra',
            '.tabnav',
        ];

        const belongsToTextarea = (el) => {
            if (!el) return false;
            const targetFor = el.getAttribute?.('for') || el.getAttribute?.('data-for');
            if (targetFor && (!textarea.id || targetFor !== textarea.id)) return false;
            const formGroup = el.closest?.('.form-group');
            if (formGroup && !formGroup.contains(textarea)) return false;
            const editor = el.closest?.('[data-testid="markdown-editor"], [data-component="MarkdownEditor"], .js-previewable-comment-form');
            if (editor && !editor.contains(textarea)) return false;
            return true;
        };

        let toolbar = null;

        // 1. 优先通过 textarea.id 与 markdown-toolbar[for] 进行精确 1:1 匹配
        if (textarea.id) {
            let escapedId = textarea.id;
            try {
                if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
                    escapedId = CSS.escape(textarea.id);
                }
            } catch { /* 保留原始 id */ }
            toolbar = document.querySelector(`markdown-toolbar[for="${escapedId}"]`)
                   || document.querySelector(`markdown-toolbar[data-for="${escapedId}"]`)
                   || document.querySelector(`[role="toolbar"][data-for="${escapedId}"]`);
            if (toolbar && !belongsToTextarea(toolbar)) {
                toolbar = null;
            }
        }

        // 2. 次优先：在当前 textarea 独立的作用域容器内寻找工具栏（防止 Issue 模板等多字段表单串位）
        if (!toolbar) {
            const localScope = textarea.closest(
                '[data-testid="markdown-editor"], [data-component="MarkdownEditor"], .js-previewable-comment-form, .timeline-comment, .js-comment, [data-testid="comment-composer"], .form-group'
            ) || textarea.parentElement;

            if (localScope) {
                for (const selector of toolbarSelectors) {
                    const el = localScope.querySelector(selector);
                    if (el && belongsToTextarea(el)) {
                        toolbar = el;
                        break;
                    }
                }
            }
        }

        // 3. 兜底在所属表单范围查找（仅限同一独立作用域内的工具栏）
        if (!toolbar) {
            const formScope = textarea.closest('form') || textarea.parentElement;
            if (formScope) {
                for (const selector of toolbarSelectors) {
                    const el = formScope.querySelector(selector);
                    if (el && belongsToTextarea(el)) {
                        const validAreas = [...formScope.querySelectorAll('textarea')].filter(isValidCollaborationTextarea);
                        if (validAreas.length <= 1) {
                            toolbar = el;
                            break;
                        }
                    }
                }
            }
        }

        if (toolbar) {
            // 定位开头的标题按钮 (H)，确保紧贴在工具栏最左侧第一项（放在工具栏左起）
            const headingBtn = toolbar.querySelector(
                'button[data-md-button="heading"], button[aria-label*="heading" i], button[aria-label*="Heading"], button[aria-label*="标题"], button:has(svg.octicon-heading), button[data-testid*="heading"]'
            );
            if (headingBtn) {
                const topToolbarItem = headingBtn.closest('md-header') || headingBtn.closest('[data-md-button]') || headingBtn.closest('.toolbar-item') || headingBtn;
                if (topToolbarItem && topToolbarItem.parentElement) {
                    return {
                        container: topToolbarItem.parentElement,
                        beforeEl: topToolbarItem,
                    };
                }
            }

            // 无标题按钮时（如 Issue Form 模板中通常无 md-header），定位首个格式化工具（如 md-bold），保证排在工具栏左起
            const firstTool = toolbar.querySelector(
                'md-bold, md-italic, [data-md-button], .toolbar-item, button:not([data-ghcn-collab-btn]), [role="button"]:not([data-ghcn-collab-btn])'
            );
            if (firstTool) {
                const topItem = firstTool.closest('md-bold, md-italic, [data-md-button], .toolbar-item') || firstTool;
                if (topItem && topItem.parentElement) {
                    return {
                        container: topItem.parentElement,
                        beforeEl: topItem,
                    };
                }
            }

            // 兜底直接插入在 toolbar 第一项前
            const firstChild = toolbar.querySelector(':scope > :not([data-ghcn-collab-btn])');
            return {
                container: toolbar,
                beforeEl: firstChild || null,
            };
        }

        // 4. Tab 栏之后的右侧工具区域兜底
        const editorContainer = textarea.closest(
            '[data-testid="markdown-editor"], [data-testid="comment-composer"], .js-previewable-comment-form, form, .timeline-comment'
        ) || textarea.parentElement;

        if (editorContainer) {
            const validAreas = [...editorContainer.querySelectorAll('textarea')].filter(isValidCollaborationTextarea);
            if (validAreas.length <= 1) {
                const tabList = editorContainer.querySelector('[role="tablist"], [data-testid="markdown-editor-tab-bar"], [data-testid="markdown-editor-tabs"], ul.tabnav-tabs');
                if (tabList && tabList.parentElement) {
                    const nextSibling = tabList.nextElementSibling;
                    if (nextSibling && belongsToTextarea(nextSibling)) {
                        return {
                            container: nextSibling,
                            beforeEl: nextSibling.firstElementChild,
                        };
                    }
                }
            }
        }

        return null;
    }

    function mountCollaborationToolbar(textarea) {
        const mountPoint = findCollaborationToolbarMountPoint(textarea);
        if (mountPoint && mountPoint.container) {
            // 清理可能已插入的旧 fallback bar
            const fallbackBar = textarea.parentElement?.querySelector('.ghcn-collab-fallback-bar');
            if (fallbackBar) {
                fallbackBar.remove();
            }

            const existingBtn = mountPoint.container.querySelector('[data-ghcn-collab-btn]');
            if (existingBtn) {
                if (existingBtn === mountPoint.beforeEl?.previousElementSibling || (existingBtn === mountPoint.container.firstElementChild && !mountPoint.beforeEl)) {
                    existingBtn.__ghcnTargetTextarea = textarea;
                    textarea.__ghcnCollabBtn = existingBtn;
                    return;
                }
                existingBtn.remove();
            }

            const btn = createCollaborationButton(textarea);
            if (mountPoint.beforeEl) {
                mountPoint.container.insertBefore(btn, mountPoint.beforeEl);
            } else {
                mountPoint.container.prepend(btn);
            }
            return;
        }

        // 仅在完全没有工具栏的最简纯文本框下使用外部 fallback
        if (textarea.parentElement && !textarea.parentElement.querySelector('[data-ghcn-collab-btn]')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ghcn-collab-fallback-bar';
            const btn = createCollaborationButton(textarea);
            wrapper.appendChild(btn);
            textarea.parentElement.insertBefore(wrapper, textarea);
        }
    }

    function createCollaborationButton(textarea) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghcn-collab-btn';
        btn.setAttribute('data-ghcn-collab-btn', 'true');
        btn.title = '将中文草稿润色为规范、地道的英文 Markdown';
        btn.innerHTML = `<span class="ghcn-collab-btn-icon" aria-hidden="true">${COLLAB_ICONS.sparkle}</span><span class="ghcn-collab-btn-label">润色转为英文</span>`;
        btn.__ghcnTargetTextarea = textarea;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openCollaborationModal(btn.__ghcnTargetTextarea || textarea);
        });
        textarea.__ghcnCollabBtn = btn;
        return btn;
    }

    function detectDefaultCollaborationMode(textarea) {
        const pathname = String(window.location.pathname || '').toLowerCase();
        const search = String(window.location.search || '').toLowerCase();

        if (search.includes('feature') || search.includes('enhancement')) return 'feature';
        if (search.includes('bug') || search.includes('defect')) return 'bug';

        if (pathname.includes('/issues/new')) {
            const contextText = `${textarea?.name || ''} ${textarea?.id || ''} ${textarea?.getAttribute('aria-label') || ''}`.toLowerCase();
            if (contextText.includes('feature') || contextText.includes('enhancement')) return 'feature';
            return 'bug';
        }

        if (pathname.includes('/pull/new') || pathname.includes('/pulls/new') || pathname.includes('/compare')) return 'feature';

        if (
            textarea?.name?.includes('comment')
            || textarea?.id?.includes('comment')
            || /\/(?:issues|pull)\/\d+/.test(pathname)
            || pathname.includes('/discussions')
        ) {
            return 'reply';
        }

        return 'general';
    }

    function closeCollaborationModal() {
        if (typeof collabRuntime.modalCleanup === 'function') {
            try {
                collabRuntime.modalCleanup();
            } catch { /* 忽略弹窗清理异常 */ }
            collabRuntime.modalCleanup = null;
        }
        if (collabRuntime.modalEl) {
            collabRuntime.modalEl.remove();
            collabRuntime.modalEl = null;
        }
    }

    function openCollaborationModal(textarea) {
        closeCollaborationModal();

        const initialDraft = (textarea?.value || '').trim();
        let activeMode = detectDefaultCollaborationMode(textarea);
        let isBusy = false;

        const overlay = document.createElement('div');
        overlay.className = 'ghcn-collab-overlay';
        overlay.dataset.ghcnCollab = 'modal';

        const modal = document.createElement('div');
        modal.className = 'ghcn-collab-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'ghcn-collab-header';
        header.innerHTML = `
            <div class="ghcn-collab-title-wrap">
                <h3 class="ghcn-collab-title"><span class="ghcn-collab-title-icon" aria-hidden="true">${COLLAB_ICONS.sparkle}</span> GitHub 协作润色助手</h3>
                <p class="ghcn-collab-subtitle">将中文草稿润色为规范、地道的开源英文 Markdown</p>
            </div>
            <button type="button" class="ghcn-collab-close" title="关闭 (Esc)">×</button>
        `;

        // Mode switch tabs
        const modeBar = document.createElement('div');
        modeBar.className = 'ghcn-collab-modes';
        COLLAB_MODES.forEach((mode) => {
            const modeBtn = document.createElement('button');
            modeBtn.type = 'button';
            modeBtn.className = `ghcn-collab-mode-btn${mode.id === activeMode ? ' is-active' : ''}`;
            modeBtn.dataset.mode = mode.id;
            modeBtn.title = mode.desc;
            modeBtn.textContent = mode.label;
            modeBtn.addEventListener('click', () => {
                if (isBusy || activeMode === mode.id) return;
                activeMode = mode.id;
                modeBar.querySelectorAll('.ghcn-collab-mode-btn').forEach((btn) => {
                    btn.classList.toggle('is-active', btn.dataset.mode === activeMode);
                });
                if (draftArea.value.trim()) {
                    triggerPolish();
                }
            });
            modeBar.appendChild(modeBtn);
        });

        // Dual columns
        const body = document.createElement('div');
        body.className = 'ghcn-collab-body';

        // Left column: Chinese Draft
        const leftCol = document.createElement('div');
        leftCol.className = 'ghcn-collab-col';
        const leftHeader = document.createElement('div');
        leftHeader.className = 'ghcn-collab-col-header';
        leftHeader.textContent = '中文草稿 / 原始想法';
        const leftContent = document.createElement('div');
        leftContent.className = 'ghcn-collab-col-body';
        const draftArea = document.createElement('textarea');
        draftArea.className = 'ghcn-collab-textarea';
        draftArea.placeholder = '在此输入中文草稿或要表达的原始想法...（如：遇到了什么问题、重现步骤、期望改动等）';
        draftArea.value = initialDraft;
        leftContent.appendChild(draftArea);
        leftCol.appendChild(leftHeader);
        leftCol.appendChild(leftContent);

        // Right column: Polished English Markdown
        const rightCol = document.createElement('div');
        rightCol.className = 'ghcn-collab-col';
        const rightHeader = document.createElement('div');
        rightHeader.className = 'ghcn-collab-col-header';
        rightHeader.textContent = '润色英文 (Markdown)';
        const rightContent = document.createElement('div');
        rightContent.className = 'ghcn-collab-col-body';
        const previewArea = document.createElement('textarea');
        previewArea.className = 'ghcn-collab-textarea';
        previewArea.placeholder = '润色结果将显示在此处，支持在此直接二次编辑微调，确认后可一键填入...';
        rightContent.appendChild(previewArea);
        rightCol.appendChild(rightHeader);
        rightCol.appendChild(rightContent);

        body.appendChild(leftCol);
        body.appendChild(rightCol);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'ghcn-collab-footer';

        const statusEl = document.createElement('div');
        statusEl.className = 'ghcn-collab-status';
        statusEl.textContent = '就绪';

        const actions = document.createElement('div');
        actions.className = 'ghcn-collab-actions';

        const polishBtn = document.createElement('button');
        polishBtn.type = 'button';
        polishBtn.className = 'ghcn-collab-action-btn ghcn-collab-action-btn--primary';
        polishBtn.textContent = '开始润色';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ghcn-collab-action-btn';
        copyBtn.textContent = '复制英文';
        copyBtn.disabled = true;

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'ghcn-collab-action-btn ghcn-collab-action-btn--apply';
        applyBtn.textContent = '填入输入框';
        applyBtn.disabled = true;

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ghcn-collab-action-btn';
        cancelBtn.textContent = '取消';

        actions.appendChild(cancelBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(polishBtn);
        actions.appendChild(applyBtn);

        footer.appendChild(statusEl);
        footer.appendChild(actions);

        modal.appendChild(header);
        modal.appendChild(modeBar);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);

        // Polish runner
        const triggerPolish = async () => {
            const draft = draftArea.value.trim();
            if (!draft) {
                statusEl.className = 'ghcn-collab-status is-error';
                statusEl.textContent = '请先在左侧输入中文草稿。';
                draftArea.focus();
                return;
            }

            isBusy = true;
            statusEl.className = 'ghcn-collab-status';
            statusEl.innerHTML = '<span class="ghcn-collab-spinner"></span> 正在思考并组织 Markdown 结构...';
            polishBtn.disabled = true;
            applyBtn.disabled = true;
            copyBtn.disabled = true;

            try {
                const result = await polishCollaborationDraft(draft, activeMode);
                previewArea.value = result.text;
                statusEl.className = 'ghcn-collab-status is-success';
                statusEl.textContent = `润色完成（消耗 ${result.tokens} tokens，耗时 ${Math.round(result.durationMs)}ms）`;
                applyBtn.disabled = false;
                copyBtn.disabled = false;
            } catch (error) {
                statusEl.className = 'ghcn-collab-status is-error';
                statusEl.textContent = `润色失败: ${normalizeRuntimeErrorMessage(error)}`;
                if (previewArea.value.trim()) {
                    applyBtn.disabled = false;
                    copyBtn.disabled = false;
                }
            } finally {
                isBusy = false;
                polishBtn.disabled = false;
            }
        };

        // Event bindings
        polishBtn.addEventListener('click', triggerPolish);

        previewArea.addEventListener('input', () => {
            const hasText = Boolean(previewArea.value.trim());
            applyBtn.disabled = !hasText;
            copyBtn.disabled = !hasText;
        });

        let copyResetTimer = 0;
        copyBtn.addEventListener('click', async () => {
            const text = previewArea.value;
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                window.clearTimeout(copyResetTimer);
                copyBtn.textContent = '已复制';
                copyResetTimer = window.setTimeout(() => {
                    copyResetTimer = 0;
                    copyBtn.textContent = '复制英文';
                }, 1500);
            } catch {
                previewArea.select();
                document.execCommand('copy');
            }
        });

        applyBtn.addEventListener('click', () => {
            const text = previewArea.value;
            if (!text) return;
            const applied = applyPolishedTextToTextarea(textarea, text);
            if (!applied) {
                statusEl.className = 'ghcn-collab-status is-error';
                statusEl.textContent = '原输入框已失效或不可编辑，请点击“复制英文”手动粘贴。';
                return;
            }
            closeCollaborationModal();
        });

        cancelBtn.addEventListener('click', closeCollaborationModal);
        header.querySelector('.ghcn-collab-close')?.addEventListener('click', closeCollaborationModal);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeCollaborationModal();
            }
        });

        const keyHandler = (event) => {
            if (!overlay.isConnected) {
                closeCollaborationModal();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCollaborationModal();
            }
        };
        window.addEventListener('keydown', keyHandler);

        const cleanupListeners = () => {
            window.clearTimeout(copyResetTimer);
            copyResetTimer = 0;
            window.removeEventListener('keydown', keyHandler);
        };
        const originalRemove = overlay.remove.bind(overlay);
        overlay.remove = () => {
            cleanupListeners();
            originalRemove();
        };

        collabRuntime.modalCleanup = cleanupListeners;
        collabRuntime.modalEl = overlay;
        document.body.appendChild(overlay);

        if (initialDraft) {
            triggerPolish();
        } else {
            draftArea.focus();
        }
    }

    async function polishCollaborationDraft(draftText, mode = 'general') {
        const startAt = performance.now();
        const providerConfig = getProviderConfig();
        if (!providerConfig.ok) {
            throw new Error(providerConfig.message);
        }

        const systemPrompt = COLLAB_PROMPTS[mode] || COLLAB_PROMPTS.general;
        let polishedText = '';
        let totalTokens = 0;
        const isAiProvider = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'openai_compatible';

        if (!isAiProvider) {
            throw new Error('协作润色需要配置 OpenAI 兼容的对话模型（推荐 DeepSeek）。');
        }

        if (isAiProvider) {
            const payload = {
                model: providerConfig.model,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: draftText },
                ],
            };
            applyOpenAiCompatibleRequestOptions(payload, providerConfig);

            const headers = {
                'Content-Type': 'application/json',
            };
            if (providerConfig.key) {
                headers.Authorization = `Bearer ${providerConfig.key}`;
            }

            const data = await proxyFetchJson({
                url: providerConfig.url,
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });

            const firstChoice = data?.choices?.[0] || {};
            polishedText = stripOpenAiReasoningBlocks(extractChatMessageContent(firstChoice));
            const codeBlockMatch = polishedText.match(/^```(?:markdown)?\r?\n([\s\S]*?)\r?\n```$/i);
            if (codeBlockMatch) {
                polishedText = codeBlockMatch[1].trim();
            }
            totalTokens = getReadmeUsageTokens(data);
        }

        if (!polishedText) {
            throw new Error('润色服务未返回有效文本，请重试或检查接口配置。');
        }

        const durationMs = performance.now() - startAt;

        await appendReadmeTranslationRecord({
            sourceType: 'collab',
            status: 'success',
            tokens: totalTokens,
            durationMs,
            detail: `collab_mode=${mode}`,
        }).catch((err) => {
            const isInvalidated = typeof isExtensionContextInvalidatedError === 'function'
                ? isExtensionContextInvalidatedError(err)
                : /extension context invalidated|context invalidated|插件上下文已失效/i.test(String(err?.message || err || ''));
            if (!isInvalidated) {
                console.warn('[协作润色助手] 记录写入失败:', err);
            }
        });

        return {
            text: polishedText,
            tokens: totalTokens,
            durationMs,
        };
    }

    function applyPolishedTextToTextarea(textarea, text) {
        if (!textarea || !textarea.isConnected || textarea.disabled || textarea.readOnly) return false;
        textarea.focus();
        textarea.select();

        let execSucceeded = false;
        try {
            execSucceeded = document.execCommand('insertText', false, text);
        } catch {
            execSucceeded = false;
        }

        if (!execSucceeded || textarea.value !== text) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(textarea, text);
            } else {
                textarea.value = text;
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }

    function injectCollaborationControlStyles() {
        if (document.getElementById('ghcn-collab-style')) return;

        const style = document.createElement('style');
        style.id = 'ghcn-collab-style';
        style.textContent = `
            .ghcn-collab-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 3px 8px;
                font-size: 12px;
                font-weight: 500;
                line-height: 18px;
                color: var(--button-default-fgColor-rest, var(--fgColor-default, #1f2328));
                background-color: var(--button-default-bgColor-rest, #f6f8fa);
                border: 1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d0d7de));
                border-radius: 6px;
                box-shadow: var(--button-default-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.04));
                cursor: pointer;
                vertical-align: middle;
                margin-left: 0;
                margin-right: 8px;
                height: 28px;
                transition: all 0.15s ease;
                white-space: nowrap;
                text-decoration: none;
                user-select: none;
                box-sizing: border-box;
                align-self: center;
            }
            .ghcn-collab-btn:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6) !important;
                border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d0d7de)) !important;
                color: var(--button-default-fgColor-rest, var(--fgColor-default, #1f2328)) !important;
            }
            .ghcn-collab-btn:active {
                background-color: var(--button-default-bgColor-active, #ebecf0) !important;
            }
            .ghcn-collab-btn-label {
                color: inherit !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                line-height: 18px !important;
            }
            .ghcn-collab-btn-icon {
                display: inline-flex !important;
                align-items: center !important;
                color: #8250df !important;
            }
            .ghcn-collab-btn:hover .ghcn-collab-btn-icon {
                color: #6639ba !important;
            }
            markdown-toolbar .ghcn-collab-btn,
            .tabnav .ghcn-collab-btn,
            .comment-form-head .ghcn-collab-btn {
                position: relative;
                top: -3.5px;
                vertical-align: middle;
                align-self: center;
            }
            [data-color-mode="dark"] .ghcn-collab-btn {
                background-color: var(--button-default-bgColor-rest, #21262d) !important;
                border-color: var(--button-default-borderColor-rest, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-default-fgColor-rest, #c9d1d9) !important;
            }
            [data-color-mode="dark"] .ghcn-collab-btn:hover {
                background-color: var(--button-default-bgColor-hover, #30363d) !important;
                border-color: var(--button-default-borderColor-hover, #8b949e) !important;
                color: var(--button-default-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-collab-btn .ghcn-collab-btn-icon {
                color: #a371f7 !important;
            }
            .ghcn-collab-fallback-bar {
                display: flex;
                align-items: center;
                margin-bottom: 6px;
            }
            .ghcn-collab-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(2px);
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
            }
            .ghcn-collab-modal {
                background: var(--bgColor-default, #ffffff);
                color: var(--fgColor-default, #1f2328);
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 12px;
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
                width: 960px;
                max-width: 96vw;
                height: 640px;
                max-height: 92vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
            }
            .ghcn-collab-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 20px;
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4);
                background: var(--bgColor-muted, #f6f8fa);
            }
            .ghcn-collab-title-wrap {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .ghcn-collab-title {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 6px;
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-collab-subtitle {
                margin: 0;
                font-size: 12px;
                color: var(--fgColor-muted, #656d76);
            }
            .ghcn-collab-close {
                background: none;
                border: none;
                font-size: 20px;
                line-height: 1;
                color: var(--fgColor-muted, #656d76);
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 6px;
                transition: background-color 0.15s, color 0.15s;
            }
            .ghcn-collab-close:hover {
                background: rgba(0, 0, 0, 0.08);
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-collab-title-icon {
                display: inline-flex;
                align-items: center;
                color: #8250df;
            }
            .ghcn-collab-modes {
                display: flex;
                gap: 8px;
                padding: 10px 20px;
                background: var(--bgColor-default, #ffffff);
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4);
                overflow-x: auto;
            }
            .ghcn-collab-mode-btn {
                background: var(--button-default-bgColor-rest, #f6f8fa);
                border: 1px solid var(--button-default-borderColor-rest, #d0d7de);
                color: var(--fgColor-default, #1f2328);
                border-radius: 20px;
                padding: 4px 14px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
            }
            .ghcn-collab-mode-btn:hover {
                background: var(--button-default-bgColor-hover, #f3f4f6);
                border-color: var(--borderColor-default, #d0d7de);
            }
            .ghcn-collab-mode-btn.is-active {
                background: var(--fgColor-default, #1f2328);
                border-color: var(--fgColor-default, #1f2328);
                color: var(--bgColor-default, #ffffff);
                font-weight: 600;
            }
            .ghcn-collab-body {
                flex: 1;
                display: flex;
                min-height: 0;
                background: var(--bgColor-default, #ffffff);
            }
            .ghcn-collab-col {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-width: 0;
                border-right: 1px solid var(--borderColor-muted, #d8dee4);
            }
            .ghcn-collab-col:last-child {
                border-right: none;
            }
            .ghcn-collab-col-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 16px;
                font-size: 12px;
                font-weight: 600;
                color: var(--fgColor-muted, #656d76);
                background: var(--bgColor-muted, #f6f8fa);
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4);
            }
            .ghcn-collab-col-body {
                flex: 1;
                display: flex;
                min-height: 0;
                position: relative;
            }
            .ghcn-collab-textarea {
                width: 100%;
                height: 100%;
                border: none;
                outline: none;
                resize: none;
                padding: 14px 16px;
                font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
                font-size: 13px;
                line-height: 1.5;
                color: var(--fgColor-default, #1f2328);
                background: var(--bgColor-default, #ffffff);
                box-sizing: border-box;
            }
            .ghcn-collab-textarea::placeholder {
                color: var(--fgColor-muted, #8c959f);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
            }
            .ghcn-collab-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 20px;
                background: var(--bgColor-muted, #f6f8fa);
                border-top: 1px solid var(--borderColor-muted, #d8dee4);
            }
            .ghcn-collab-status {
                font-size: 12px;
                color: var(--fgColor-muted, #656d76);
                display: flex;
                align-items: center;
                gap: 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 50%;
            }
            .ghcn-collab-status.is-error {
                color: #cf222e;
            }
            .ghcn-collab-status.is-success {
                color: #1a7f37;
            }
            .ghcn-collab-spinner {
                display: inline-block;
                width: 12px;
                height: 12px;
                border: 2px solid #5c32a3;
                border-right-color: transparent;
                border-radius: 50%;
                animation: ghcn-collab-spin 0.75s linear infinite;
            }
            @keyframes ghcn-collab-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .ghcn-collab-actions {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .ghcn-collab-action-btn {
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 6px;
                background: var(--button-default-bgColor-rest, #f6f8fa);
                color: var(--fgColor-default, #24292f);
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                line-height: 20px;
                padding: 5px 12px;
                transition: all 0.15s ease;
            }
            .ghcn-collab-action-btn:hover:not(:disabled) {
                background: var(--button-default-bgColor-hover, #f3f4f6);
            }
            .ghcn-collab-action-btn:disabled {
                cursor: not-allowed;
                opacity: 0.6;
            }
            .ghcn-collab-action-btn--primary {
                border-color: #5c32a3;
                background: #5c32a3;
                color: #ffffff;
                font-weight: 600;
            }
            .ghcn-collab-action-btn--primary:hover:not(:disabled) {
                background: #4a228c;
                border-color: #4a228c;
                color: #ffffff;
            }
            .ghcn-collab-action-btn--apply {
                border-color: rgba(31, 136, 61, 0);
                background: #1f883d;
                color: #ffffff;
                font-weight: 600;
            }
            .ghcn-collab-action-btn--apply:hover:not(:disabled) {
                background: #1a7f37;
                color: #ffffff;
            }
        `;
        document.head.appendChild(style);
    }

    /****************** 仓库首页 AI 项目速读胶囊 (TL;DR Capsule) ******************/

    // ==========================================================================
    // [Module] features/tldr-capsule.js
    // ==========================================================================

    const TLDR_SYSTEM_PROMPT = `你是一个资深开源架构师与技术评测专家。请根据输入的开源项目 README 前部内容，用简体中文生成一份极简的「项目速读胶囊」。
严格遵循以下 2 点结构输出纯 Markdown：
- **🎯 核心定位**：一句话直击痛点，说明这个项目解决什么核心问题，属于什么领域。
- **💡 选型考量**：说明同类对比或适用场景（如：“相比 XX 更轻量，适合小型集群”）。
输出纯 Markdown 列表，严格不要包含额外前缀、礼貌客套或总结废话。`;

    function isTldrContextInvalidated(error) {
        if (typeof isExtensionContextInvalidatedError === 'function') {
            return isExtensionContextInvalidatedError(error);
        }
        const message = String(error?.message || error || '');
        return /extension context invalidated|context invalidated|插件上下文已失效/i.test(message);
    }

    function isTldrCapsuleEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_repo_tldr && isReadmePage();
    }

    function scheduleTldrCapsuleControls(reason) {
        if (!FeatureSet.enable_extension) return;

        if (tldrRuntime.timerId) {
            window.clearTimeout(tldrRuntime.timerId);
        }

        tldrRuntime.timerId = window.setTimeout(() => {
            tldrRuntime.timerId = 0;
            setupTldrCapsuleControls(reason);
        }, 160);
    }

    function setupTldrCapsuleControls() {
        if (!isTldrCapsuleEnabled()) {
            restoreTldrCapsuleControls();
            return;
        }

        const readmeRoot = getReadmeRootElement();
        if (!readmeRoot) return;

        const repoInfo = getCurrentRepoInfo();
        if (!repoInfo) return;

        // 若 README 过于简短（不足 80 字符）或仅有一行标题，防范向 AI 发送无效请求造成 Token 浪费与幻觉
        const introText = extractReadmeIntroText(readmeRoot);
        if (!introText || introText.trim().length < 80) {
            restoreTldrCapsuleControls();
            return;
        }

        injectTldrCapsuleStyles();
        mountTldrCapsule(readmeRoot, repoInfo).catch((error) => {
            if (!isTldrContextInvalidated(error)) {
                console.warn('[速读胶囊] 挂载失败:', error);
            }
        });
    }

    function getTldrDocUrl() {
        if (typeof getDocumentUrlWithoutHash === 'function') {
            return getDocumentUrlWithoutHash();
        }
        const href = String(window?.location?.href || '');
        if (!href) return '';
        try {
            const parsed = new URL(href);
            parsed.hash = '';
            return parsed.href;
        } catch {
            return href.split('#')[0];
        }
    }

    function resetTldrRuntimeForNavigation() {
        tldrRuntime.mountSeq = (tldrRuntime.mountSeq || 0) + 1;
        tldrRuntime.genSeq = (tldrRuntime.genSeq || 0) + 1;
        tldrRuntime.isBusy = false;
        tldrRuntime.busyDocUrl = '';
        tldrRuntime.busyCard = null;
        document.querySelectorAll('[data-ghcn-tldr="capsule"]').forEach((el) => el.remove());
    }

    function restoreTldrCapsuleControls() {
        tldrRuntime.mountSeq = (tldrRuntime.mountSeq || 0) + 1;
        tldrRuntime.genSeq = (tldrRuntime.genSeq || 0) + 1;
        tldrRuntime.isBusy = false;
        tldrRuntime.busyDocUrl = '';
        tldrRuntime.busyCard = null;
        tldrRuntime.activeDocUrl = '';
        document.querySelectorAll('[data-ghcn-tldr]').forEach((el) => el.remove());
    }

    function buildTldrCacheKey(repoInfo, sourceHash) {
        if (!repoInfo?.fullName || !sourceHash) return '';
        return `${repoInfo.fullName.toLowerCase()}|tldr|${sourceHash}`;
    }

    function getTldrSourceHash(readmeRoot) {
        if (!readmeRoot) return '';
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(readmeRoot) : null;
        const html = state?.originalHtml || readmeRoot.innerHTML || '';
        return getStableReadmeTextHash(html);
    }

    function extractReadmeIntroText(readmeRoot, maxChars = 2400) {
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(readmeRoot) : null;
        let clone;
        if (state?.originalHtml) {
            clone = typeof parseInertHtmlBody === 'function'
                ? parseInertHtmlBody(state.originalHtml)
                : (() => {
                    const div = document.createElement('div');
                    div.innerHTML = state.originalHtml;
                    return div;
                })();
        } else {
            clone = readmeRoot.cloneNode(true);
        }
        clone.querySelectorAll?.('pre, code, svg, img, table, .notranslate, [translate="no"]').forEach((el) => el.remove());
        const text = normalizeText(clone.textContent || '');
        return text.slice(0, maxChars);
    }

    function findTldrMountPoint(readmeRoot) {
        if (!readmeRoot) return null;

        if (typeof chineseReadme !== 'undefined'
            && chineseReadme?.state?.root === readmeRoot
            && chineseReadme.state.controls?.parentElement) {
            return { parent: chineseReadme.state.controls.parentElement, before: chineseReadme.state.controls };
        }

        // 如果处于 .Box-body 内部，优先挂载在 .Box-body 之前（紧贴 .Box-header 之后，贴紧上边和左右）
        const boxBody = readmeRoot.closest('.Box-body');
        if (boxBody && boxBody.parentElement) {
            return { parent: boxBody.parentElement, before: boxBody };
        }

        // 默认挂载在 README 容器内部顶部（正文 readmeRoot 之前、自述文件标题栏之后）
        if (readmeRoot.parentElement) {
            return { parent: readmeRoot.parentElement, before: readmeRoot };
        }

        return null;
    }

    function findReadmeHeaderActions(readmeRoot) {
        if (!readmeRoot) return null;

        const readmeBox = readmeRoot.closest('#readme, [data-testid="readme"], .Box, div[class*="Box"]')
            || document.querySelector('#readme, [data-testid="readme"]');
        if (!readmeBox) return null;

        // 1. 优先定位 README 头部区域内的 Copilot 图标按钮（放在这个图标左侧）
        const copilotSvg = readmeBox.querySelector('svg.octicon-copilot');
        if (copilotSvg) {
            const copilotBtn = copilotSvg.closest('button, [role="button"]');
            if (copilotBtn && copilotBtn.parentElement) {
                return {
                    container: copilotBtn.parentElement,
                    beforeEl: copilotBtn,
                    copilotBtn,
                };
            }
        }

        // 2. 次优先：定位铅笔编辑按钮或目录大纲按钮（无 Copilot 权限或未开启时的通用动作栏）
        const siblingSvg = readmeBox.querySelector('svg.octicon-pencil, svg.octicon-list-unordered, svg.octicon-kebab-horizontal');
        if (siblingSvg) {
            const siblingBtn = siblingSvg.closest('button, [role="button"]');
            if (siblingBtn && siblingBtn.parentElement) {
                return {
                    container: siblingBtn.parentElement,
                    beforeEl: siblingBtn,
                    copilotBtn: null,
                };
            }
        }

        // 3. 兜底：定位 Box-header 内的右侧操作按钮区
        const header = readmeBox.querySelector('.Box-header, header');
        if (header) {
            const actionsContainer = header.querySelector('.Box-header-actions, [class*="HeaderActions"], div.d-flex:last-child');
            if (actionsContainer) {
                return {
                    container: actionsContainer,
                    beforeEl: actionsContainer.firstElementChild,
                    copilotBtn: null,
                };
            }
        }

        return null;
    }

    function createTldrCardElement(readmeRoot, sourceHash) {
        const mountPoint = findTldrMountPoint(readmeRoot);
        if (!mountPoint) return null;

        const currentPathname = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
        const oldCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (oldCard) {
            if (oldCard.dataset.sourceHash === sourceHash
                && oldCard.dataset.pathname === currentPathname
                && oldCard.parentElement === mountPoint.parent
                && oldCard.nextElementSibling === mountPoint.before) {
                oldCard.style.display = '';
                return oldCard;
            }
            oldCard.remove();
        }

        const card = document.createElement('section');
        card.className = 'ghcn-tldr-card';
        card.dataset.ghcnTldr = 'capsule';
        card.dataset.sourceHash = sourceHash;
        card.dataset.pathname = currentPathname;

        mountPoint.parent.insertBefore(card, mountPoint.before);
        return card;
    }

    function mountTldrHeaderButton(readmeRoot, repoInfo, onToggle) {
        const headerActions = findReadmeHeaderActions(readmeRoot);
        if (!headerActions || !headerActions.container) return null;

        const sourceHash = getTldrSourceHash(readmeRoot);

        let btn = document.querySelector('[data-ghcn-tldr="header-btn"]');
        if (btn) {
            btn.__ghcnTldrOnToggle = onToggle;
            btn.dataset.sourceHash = sourceHash;
            if (btn.parentElement === headerActions.container && btn.nextElementSibling === headerActions.beforeEl) {
                return btn;
            }
            btn.remove();
        }

        btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-component', 'Button');
        btn.setAttribute('data-size', 'small');
        btn.className = 'ghcn-tldr-header-btn btn btn-sm Button--primary Button--small Button tooltipped tooltipped-w';
        btn.setAttribute('aria-label', 'AI 项目速读 (TL;DR)');
        btn.title = 'AI 项目速读 (TL;DR)';
        btn.dataset.ghcnTldr = 'header-btn';
        btn.dataset.sourceHash = sourceHash;
        btn.innerHTML = `<span class="ghcn-tldr-header-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span><span class="ghcn-tldr-header-text">AI 速读</span>`;
        btn.__ghcnTldrOnToggle = onToggle;

        headerActions.container.insertBefore(btn, headerActions.beforeEl);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof btn.__ghcnTldrOnToggle === 'function') {
                Promise.resolve(btn.__ghcnTldrOnToggle(btn)).catch((error) => {
                    if (!isTldrContextInvalidated(error)) {
                        console.warn('[速读胶囊] 交互失败:', error);
                    }
                });
            }
        });

        return btn;
    }

    async function mountTldrCapsule(readmeRoot, repoInfo) {
        const expectedDocUrl = getTldrDocUrl();
        const currentPathname = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
        if (tldrRuntime.activeDocUrl && tldrRuntime.activeDocUrl !== expectedDocUrl) {
            resetTldrRuntimeForNavigation();
        }
        tldrRuntime.activeDocUrl = expectedDocUrl;
        tldrRuntime.mountSeq = (tldrRuntime.mountSeq || 0) + 1;
        const mountSeq = tldrRuntime.mountSeq;
        const isMountValid = () => mountSeq === tldrRuntime.mountSeq
            && getTldrDocUrl() === expectedDocUrl
            && readmeRoot.isConnected
            && isTldrCapsuleEnabled();

        const sourceHash = getTldrSourceHash(readmeRoot);
        const cacheKey = buildTldrCacheKey(repoInfo, sourceHash);

        // 1. 精确匹配当前 hash 缓存
        let cached = null;
        try {
            cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true });
        } catch (error) {
            if (isTldrContextInvalidated(error)) return;
            console.warn('[速读胶囊] 读取缓存失败:', error);
        }
        if (!isMountValid()) {
            return;
        }

        // 2. 兜底匹配该仓库当前路径最新生成的速读缓存（防止 README 翻译后 DOM 变动导致 hash 微小变化）
        if (!cached?.tldrContent && FeatureSet.readme_enable_repo_cache && repoInfo?.fullName) {
            try {
                await ensureRepoCacheLoaded();
            } catch (error) {
                if (isTldrContextInvalidated(error)) return;
                console.warn('[速读胶囊] 加载仓库缓存失败:', error);
            }
            if (!isMountValid()) {
                return;
            }
            const prefix = `${repoInfo.fullName.toLowerCase()}|tldr|`;
            const repoRootPathLower = `/${repoInfo.fullName.toLowerCase()}`;
            const currentPathLower = currentPathname.toLowerCase();
            for (const [key, entry] of readmeRuntime.repoCacheMap.entries()) {
                const entryPathLower = entry?.pathname ? (String(entry.pathname).replace(/\/+$/, '') || '/').toLowerCase() : '';
                const matchesPath = entryPathLower
                    ? entryPathLower === currentPathLower
                    : currentPathLower === repoRootPathLower;
                if (key.startsWith(prefix) && matchesPath
                    && entry.tldrContent && entry.complete === true) {
                    cached = entry;
                    break;
                }
            }
        }

        const headerActions = findReadmeHeaderActions(readmeRoot);
        const isMatchingCard = (targetCard) => Boolean(
            targetCard
            && targetCard.dataset.sourceHash === sourceHash
            && targetCard.dataset.pathname === currentPathname,
        );

        // 挂载或更新头部按钮（位于 Copilot 图标左侧）
        const headerBtn = mountTldrHeaderButton(readmeRoot, repoInfo, async (btn) => {
            let card = document.querySelector('[data-ghcn-tldr="capsule"]');
            if (card && !isMatchingCard(card)) {
                card.remove();
                card = null;
            }

            // 如果卡片已经存在且可见，点击则折叠/收起卡片
            if (card && card.style.display !== 'none') {
                card.style.display = 'none';
                btn.classList.remove('is-active');
                btn.setAttribute('aria-expanded', 'false');
                return;
            }

            // 如果卡片已经存在但处于隐藏状态，切换为展示
            if (card) {
                card.style.display = '';
                btn.classList.add('is-active');
                btn.setAttribute('aria-expanded', 'true');
                return;
            }

            // 卡片尚未创建：点击时按需创建卡片并展示内容
            card = createTldrCardElement(readmeRoot, sourceHash);
            if (!card) return;

            btn.classList.add('is-active', 'is-loading');
            btn.setAttribute('aria-expanded', 'true');

            // 如果已有缓存内容直接秒开渲染，否则调用 AI 提炼
            if (cached?.tldrContent) {
                renderTldrContent(card, cached.tldrContent, repoInfo, readmeRoot, sourceHash, true);
                btn.classList.remove('is-loading');
            } else {
                try {
                    await executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
                } finally {
                    btn.classList.remove('is-loading');
                }
            }
        });

        // 默认不主动展示下方的总结内容卡片，保持 README 清爽，待用户点击头部「AI 速读」按钮后再展开
        let existingCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (existingCard && !isMatchingCard(existingCard)) {
            existingCard.remove();
            existingCard = null;
        }
        const isExistingCardVisible = Boolean(
            existingCard
            && isMatchingCard(existingCard)
            && existingCard.style.display !== 'none',
        );
        if (existingCard && (!isExistingCardVisible || !headerBtn?.classList.contains('is-active'))) {
            existingCard.style.display = 'none';
        }

        if (headerBtn) {
            const keepActive = Boolean(existingCard && isExistingCardVisible && headerBtn.classList.contains('is-active'));
            headerBtn.classList.toggle('is-active', keepActive);
            headerBtn.setAttribute('aria-expanded', keepActive ? 'true' : 'false');
            if (cached?.tldrContent) {
                headerBtn.setAttribute('data-has-cache', 'true');
                headerBtn.title = 'AI 项目速读 (TL;DR) - 点击展开速读卡片';
            } else {
                headerBtn.removeAttribute('data-has-cache');
            }
        } else if (!headerActions) {
            // 极低概率：若找不到任何头部按钮挂载点，降级在 README 顶部展示初始提炼条
            const card = createTldrCardElement(readmeRoot, sourceHash);
            if (card) {
                if (cached?.tldrContent) {
                    renderTldrContent(card, cached.tldrContent, repoInfo, readmeRoot, sourceHash, true);
                } else {
                    renderTldrInitial(card, repoInfo, readmeRoot, sourceHash);
                }
            }
        }
    }

    const TLDR_ICONS = {
        sparkle: '<svg class="octicon octicon-sparkle" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.492 7.492 0 0 0 4.464 4.464l1.306.478a.5.5 0 0 1 0 .94l-1.306.478a7.492 7.492 0 0 0-4.464 4.464l-.478 1.306a.5.5 0 0 1-.94 0l-.478-1.306a7.492 7.492 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.492 7.492 0 0 0 4.464-4.464Z"></path></svg>',
        sync: '<svg class="octicon octicon-sync" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>',
        close: '<svg class="octicon octicon-x" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>',
        chevronUp: '<svg class="octicon octicon-chevron-up" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z"></path></svg>',
        chevronDown: '<svg class="octicon octicon-chevron-down" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12.78 5.47a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0l-4.25-4.25a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path></svg>',
        copy: '<svg class="octicon octicon-copy" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>',
        check: '<svg class="octicon octicon-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>',
        alert: '<svg class="octicon octicon-alert" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
    };

    function renderTldrInitial(card, repoInfo, readmeRoot, sourceHash) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-sparkle-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span>
                    <strong class="Box-title ghcn-tldr-title">AI 项目速读</strong>
                    <span class="Label ghcn-tldr-badge">秒懂项目</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm btn-primary ghcn-tldr-btn ghcn-tldr-btn--primary" data-ghcn-tldr-action="generate">
                        <span class="ghcn-tldr-btn-icon">${TLDR_ICONS.sparkle}</span>
                        <span>提炼项目速读</span>
                    </button>
                </div>
            </div>
        `;

        card.querySelector('[data-ghcn-tldr-action="generate"]')?.addEventListener('click', () => {
            executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
        });
    }

    function renderTldrLoading(card) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-spinner" aria-hidden="true"></span>
                    <strong class="Box-title ghcn-tldr-title">正在通过 AI 提炼项目核心定位与选型考量...</strong>
                </div>
            </div>
        `;
    }

    function renderTldrError(card, message, repoInfo, readmeRoot, sourceHash) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-error-icon" aria-hidden="true">${TLDR_ICONS.alert}</span>
                    <strong class="Box-title ghcn-tldr-title">生成速读失败</strong>
                    <span class="ghcn-tldr-error-msg">${escapeHtml(message || '接口调用异常')}</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm ghcn-tldr-btn" data-ghcn-tldr-action="retry">重试</button>
                </div>
            </div>
        `;

        card.querySelector('[data-ghcn-tldr-action="retry"]')?.addEventListener('click', () => {
            executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
        });
    }

    function extractCommandInfo(text) {
        if (!text) return null;

        const codeMatch = text.match(/`([^`]+)`/);
        let cmd = '';
        let prefixNote = '';

        if (codeMatch) {
            cmd = codeMatch[1].trim();
            prefixNote = text.replace(codeMatch[0], '').replace(/^[:：\s]+/, '').replace(/[:：\s]+$/, '').trim();
        } else {
            const trimmed = text.replace(/^[:：\s]+/, '').trim();
            const isCli = /^(docker|npm|pnpm|yarn|npx|pip|pip3|cargo|brew|git|curl|wget|go|composer|gem|bun|deno)\b/i.test(trimmed);
            if (isCli) {
                cmd = trimmed;
            }
        }

        if (!cmd) return null;
        if (cmd.includes('无需安装')) return null;

        return { cmd, note: prefixNote };
    }

    function formatInlineMarkdown(text) {
        let safe = escapeHtml(text || '');
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/`([^`]+)`/g, '<code class="ghcn-tldr-inline-code">$1</code>');
        return safe;
    }

    function formatTldrMarkdownToHtml(markdownText) {
        if (!markdownText) return '';

        let normalized = String(markdownText).replace(/\r\n/g, '\n');
        normalized = normalized.replace(/```(?:bash|sh|shell|zsh)?\n([\s\S]*?)\n```/g, (match, code) => `\`${code.trim()}\``);

        const rawLines = normalized.split('\n');
        const mergedLines = [];

        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i].trim();
            if (!line) continue;

            const isNewBullet = /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^\*\*[^*]+\*\*/.test(line);

            if ((!isNewBullet || line.startsWith('：') || line.startsWith(':')) && mergedLines.length > 0) {
                const prev = mergedLines[mergedLines.length - 1];
                if (line.startsWith('：') || line.startsWith(':')) {
                    mergedLines[mergedLines.length - 1] = prev + line;
                } else {
                    mergedLines[mergedLines.length - 1] = prev + ' ' + line;
                }
            } else {
                mergedLines.push(line);
            }
        }

        const htmlParts = [];

        mergedLines.forEach((line) => {
            let cleanLine = line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');

            const boldMatch = cleanLine.match(/^\*\*([^*]+)\*\*[:：]?\s*(.*)$/);
            let title = '';
            let rest = cleanLine;

            if (boldMatch) {
                title = boldMatch[1].trim();
                rest = boldMatch[2].trim();
            }

            // 过滤掉 3 秒极简启动等输出，保持速读卡片精炼聚焦
            if (title.includes('启动') || title.includes('3秒') || cleanLine.includes('3秒极简启动')) {
                return;
            }

            rest = rest.replace(/^[:：\s]+/, '').trim();

            const isStartupOrCmd = title.includes('启动') || title.includes('命令') || title.includes('安装') || title.includes('运行');
            const cmdInfo = isStartupOrCmd ? extractCommandInfo(rest) : null;

            if (cmdInfo && cmdInfo.cmd) {
                htmlParts.push(`
                    <div class="ghcn-tldr-row ghcn-tldr-row--cmd">
                        <div class="ghcn-tldr-row-header">
                            ${title ? `<strong class="ghcn-tldr-label">${escapeHtml(title)}</strong>` : ''}
                            ${cmdInfo.note ? `<span class="ghcn-tldr-note">${escapeHtml(cmdInfo.note)}</span>` : ''}
                        </div>
                        <div class="ghcn-tldr-cmd-box">
                            <div class="ghcn-tldr-cmd-inner">
                                <span class="ghcn-tldr-cmd-prompt" aria-hidden="true">$</span>
                                <code class="ghcn-tldr-cmd-code">${escapeHtml(cmdInfo.cmd)}</code>
                            </div>
                            <button type="button" class="ghcn-tldr-copy-cmd" data-cmd="${escapeHtml(cmdInfo.cmd)}" title="复制命令" aria-label="复制命令">
                                <span class="ghcn-tldr-copy-icon-wrap" aria-hidden="true">${TLDR_ICONS.copy}</span>
                                <span class="ghcn-tldr-copy-label">复制</span>
                            </button>
                        </div>
                    </div>
                `);
            } else {
                htmlParts.push(`
                    <div class="ghcn-tldr-row">
                        ${title ? `<strong class="ghcn-tldr-label">${escapeHtml(title)}：</strong>` : ''}
                        <span class="ghcn-tldr-text">${formatInlineMarkdown(rest)}</span>
                    </div>
                `);
            }
        });

        return htmlParts.join('') || escapeHtml(markdownText);
    }

    function renderTldrContent(card, contentText, repoInfo, readmeRoot, sourceHash, isCached = false) {
        card.classList.add('is-completed');
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-sparkle-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span>
                    <strong class="Box-title ghcn-tldr-title">AI 项目速读</strong>
                    <span class="Label ghcn-tldr-badge ${isCached ? 'is-cached' : ''}">${isCached ? '已命中缓存' : '新提炼'}</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm ghcn-tldr-tool-btn" data-ghcn-tldr-action="refresh" title="重新提炼速读" aria-label="重新提炼速读">
                        <span class="ghcn-tldr-tool-icon">${TLDR_ICONS.sync}</span>
                    </button>
                    <button type="button" class="btn btn-sm ghcn-tldr-tool-btn" data-ghcn-tldr-action="close" title="关闭速读卡片" aria-label="关闭速读卡片">
                        <span class="ghcn-tldr-tool-icon">${TLDR_ICONS.close}</span>
                    </button>
                </div>
            </div>
            <div class="Box-body ghcn-tldr-body">
                ${formatTldrMarkdownToHtml(contentText)}
            </div>
        `;

        card.querySelectorAll('.ghcn-tldr-copy-cmd').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cmd = btn.getAttribute('data-cmd') || '';
                if (!cmd) return;
                try {
                    await navigator.clipboard.writeText(cmd);
                    btn.classList.add('is-copied');
                    const label = btn.querySelector('.ghcn-tldr-copy-label');
                    const iconWrap = btn.querySelector('.ghcn-tldr-copy-icon-wrap');
                    if (label) label.textContent = '已复制';
                    if (iconWrap) iconWrap.innerHTML = TLDR_ICONS.check;
                    window.setTimeout(() => {
                        btn.classList.remove('is-copied');
                        if (label) label.textContent = '复制';
                        if (iconWrap) iconWrap.innerHTML = TLDR_ICONS.copy;
                    }, 1600);
                } catch {
                    // Clipboard fallback
                }
            });
        });

        const refreshBtn = card.querySelector('[data-ghcn-tldr-action="refresh"]');
        refreshBtn?.addEventListener('click', async () => {
            const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
            headerBtn?.classList.add('is-loading');
            refreshBtn?.classList.add('is-loading');
            try {
                await executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
            } finally {
                headerBtn?.classList.remove('is-loading');
                refreshBtn?.classList.remove('is-loading');
            }
        });

        card.querySelector('[data-ghcn-tldr-action="close"]')?.addEventListener('click', () => {
            card.style.display = 'none';
            const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
            if (headerBtn) {
                headerBtn.classList.remove('is-active');
                headerBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    async function executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash) {
        const expectedDocUrl = getTldrDocUrl();
        if (tldrRuntime.isBusy && tldrRuntime.busyDocUrl === expectedDocUrl && tldrRuntime.busyCard?.isConnected) return;
        tldrRuntime.isBusy = true;
        tldrRuntime.busyDocUrl = expectedDocUrl;
        tldrRuntime.busyCard = card;
        const currentPathname = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
        tldrRuntime.genSeq = (tldrRuntime.genSeq || 0) + 1;
        const genSeq = tldrRuntime.genSeq;
        const isGenValid = () => genSeq === tldrRuntime.genSeq
            && getTldrDocUrl() === expectedDocUrl
            && card.isConnected
            && FeatureSet.enable_extension
            && FeatureSet.enable_repo_tldr;
        renderTldrLoading(card);

        const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
        if (headerBtn) {
            headerBtn.classList.add('is-active', 'is-loading');
            headerBtn.setAttribute('aria-expanded', 'true');
        }

        const startAt = performance.now();
        const activeSourceHash = sourceHash || getTldrSourceHash(readmeRoot);
        const cacheKey = buildTldrCacheKey(repoInfo, activeSourceHash);

        try {
            const providerConfig = getProviderConfig();
            if (!providerConfig.ok) {
                throw new Error(providerConfig.message);
            }

            const introText = extractReadmeIntroText(readmeRoot, 2400);
            if (!introText || introText.trim().length < 80) {
                throw new Error('README 正文内容过短（不足 80 字符），无法提炼速读胶囊。');
            }

            const userPrompt = `项目：${repoInfo.fullName}\n\nREADME 简介内容：\n${introText}`;
            let summaryText = '';
            let totalTokens = 0;
            const isAiProvider = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'openai_compatible';

            if (!isAiProvider) {
                throw new Error('AI 速读需要配置 OpenAI 兼容的对话模型（推荐 DeepSeek）。');
            }

            if (isAiProvider) {
                const payload = {
                    model: providerConfig.model,
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: TLDR_SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt },
                    ],
                };
                applyOpenAiCompatibleRequestOptions(payload, providerConfig);

                const headers = {
                    'Content-Type': 'application/json',
                };
                if (providerConfig.key) {
                    headers.Authorization = `Bearer ${providerConfig.key}`;
                }

                const data = await proxyFetchJson({
                    url: providerConfig.url,
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                });

                if (!isGenValid()) return;

                const firstChoice = data?.choices?.[0] || {};
                summaryText = stripOpenAiReasoningBlocks(extractChatMessageContent(firstChoice));
                totalTokens = getReadmeUsageTokens(data);
            }

            if (!summaryText) {
                throw new Error('速读胶囊生成结果为空，请重试或检查接口配置。');
            }

            if (!isGenValid()) return;

            const durationMs = performance.now() - startAt;

            // Save to repo cache
            await upsertRepoCachedTranslation(cacheKey, {
                repo: repoInfo.fullName,
                pathname: currentPathname,
                sourceHash: activeSourceHash,
                tldrContent: summaryText,
                complete: true,
            }).catch((err) => {
                if (!isTldrContextInvalidated(err)) {
                    console.warn('[速读胶囊] 写入缓存失败:', err);
                }
            });

            if (!isGenValid()) return;

            // Append record
            await appendReadmeTranslationRecord({
                repo: repoInfo.fullName,
                sourceType: 'tldr',
                status: 'success',
                tokens: totalTokens,
                durationMs,
                sourceHash: activeSourceHash,
                detail: 'tldr_generated',
            }).catch((err) => {
                if (!isTldrContextInvalidated(err)) {
                    console.warn('[速读胶囊] 写入翻译记录失败:', err);
                }
            });

            if (!isGenValid()) return;

            renderTldrContent(card, summaryText, repoInfo, readmeRoot, activeSourceHash, false);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
                headerBtn.classList.add('is-active');
                headerBtn.setAttribute('aria-expanded', 'true');
            }
        } catch (error) {
            if (!isTldrContextInvalidated(error)) {
                console.error('[速读胶囊] 生成失败:', error);
            }
            if (!isGenValid()) return;
            renderTldrError(card, normalizeRuntimeErrorMessage(error), repoInfo, readmeRoot, activeSourceHash);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
            }
        } finally {
            if (genSeq === tldrRuntime.genSeq) {
                tldrRuntime.isBusy = false;
                tldrRuntime.busyDocUrl = '';
                tldrRuntime.busyCard = null;
            }
        }
    }

    function injectTldrCapsuleStyles() {
        if (document.getElementById('ghcn-tldr-style')) return;

        const style = document.createElement('style');
        style.id = 'ghcn-tldr-style';
        style.textContent = `
            .ghcn-tldr-card {
                margin: 0 !important;
                border-top: none !important;
                border-left: none !important;
                border-right: none !important;
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4) !important;
                border-radius: 0 !important;
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                box-shadow: none !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
                box-sizing: border-box;
                overflow: hidden;
            }
            .ghcn-tldr-header {
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                border: none !important;
                border-radius: 0 !important;
                padding: 8px 16px !important;
                min-height: 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex-wrap: wrap;
                box-sizing: border-box;
            }
            .ghcn-tldr-card.is-completed .ghcn-tldr-header {
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4) !important;
            }
            .ghcn-tldr-title-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                min-height: 24px;
            }
            .ghcn-tldr-sparkle-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #8250df;
            }
            .ghcn-tldr-title {
                font-size: 13px !important;
                font-weight: 600 !important;
                color: var(--fgColor-default, #1f2328) !important;
                line-height: 20px;
                margin: 0;
            }
            .ghcn-tldr-badge {
                font-size: 11px !important;
                font-weight: 500 !important;
                line-height: 18px !important;
                padding: 0 7px !important;
                border-radius: 24px !important;
                border: 1px solid var(--borderColor-default, #d0d7de) !important;
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                color: var(--fgColor-muted, #656d76) !important;
                white-space: nowrap;
            }
            .ghcn-tldr-badge.is-cached {
                border-color: rgba(26, 127, 55, 0.4) !important;
                background-color: rgba(46, 160, 67, 0.1) !important;
                color: var(--fgColor-success, #1a7f37) !important;
            }
            .ghcn-tldr-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .ghcn-tldr-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 3px 12px;
                font-size: 12px;
                font-weight: 500;
                line-height: 20px;
                border-radius: 6px;
                border: 1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d0d7de));
                background-color: var(--button-default-bgColor-rest, #ffffff);
                color: var(--fgColor-default, #1f2328);
                cursor: pointer;
                transition: 0.15s ease;
                user-select: none;
                text-decoration: none;
            }
            .ghcn-tldr-btn:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6);
                border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d0d7de));
            }
            .ghcn-tldr-btn--primary {
                background-color: var(--button-primary-bgColor-rest, #1f883d);
                border-color: var(--button-primary-borderColor-rest, rgba(31, 35, 40, 0.15));
                color: #ffffff;
                box-shadow: var(--shadow-resting-xsmall, 0 1px 0 rgba(31, 35, 40, 0.1));
            }
            .ghcn-tldr-btn--primary:hover {
                background-color: var(--button-primary-bgColor-hover, #1a7f37);
                border-color: var(--button-primary-borderColor-hover, rgba(31, 35, 40, 0.15));
                color: #ffffff;
            }
            .ghcn-tldr-btn-icon {
                display: inline-flex;
                align-items: center;
            }
            .ghcn-tldr-tool-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 28px !important;
                height: 28px !important;
                min-width: 28px !important;
                padding: 0 !important;
                border-radius: 6px !important;
                border: 1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d0d7de)) !important;
                background-color: var(--button-default-bgColor-rest, #f6f8fa) !important;
                color: var(--fgColor-muted, #656d76) !important;
                box-shadow: var(--button-default-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.04)) !important;
                cursor: pointer !important;
                transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
                user-select: none !important;
                box-sizing: border-box !important;
            }
            .ghcn-tldr-tool-btn:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6) !important;
                border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d0d7de)) !important;
                color: var(--fgColor-default, #1f2328) !important;
            }
            .ghcn-tldr-tool-btn:active {
                background-color: var(--button-default-bgColor-active, #ebecf0) !important;
            }
            .ghcn-tldr-tool-btn.is-loading .ghcn-tldr-tool-icon {
                animation: ghcn-tldr-spin 0.8s linear infinite !important;
                color: #8250df !important;
            }
            .ghcn-tldr-tool-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 14px !important;
                height: 14px !important;
                color: currentColor;
            }
            .ghcn-tldr-header-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 5px !important;
                height: 28px !important;
                min-height: 28px !important;
                padding: 3px 10px !important;
                margin: 0 4px 0 0 !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                line-height: 20px !important;
                border-radius: 6px !important;
                border: 1px solid var(--button-primary-borderColor-rest, rgba(31, 35, 40, 0.15)) !important;
                background-color: var(--button-primary-bgColor-rest, #1f883d) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
                box-shadow: var(--button-primary-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.1)) !important;
                cursor: pointer !important;
                transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
                user-select: none !important;
                box-sizing: border-box !important;
                vertical-align: middle !important;
                text-decoration: none !important;
                white-space: nowrap !important;
                position: relative !important;
            }
            .ghcn-tldr-header-btn:hover {
                background-color: var(--button-primary-bgColor-hover, #1a7f37) !important;
                border-color: var(--button-primary-borderColor-hover, rgba(31, 35, 40, 0.15)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-btn:active {
                background-color: var(--button-primary-bgColor-active, #1f883d) !important;
            }
            .ghcn-tldr-header-btn.is-active {
                background-color: var(--button-primary-bgColor-active, #1f883d) !important;
                border-color: var(--button-primary-borderColor-active, rgba(31, 35, 40, 0.15)) !important;
                box-shadow: inset 0 1px 0 rgba(31, 35, 40, 0.1) !important;
            }
            .ghcn-tldr-header-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 14px !important;
                height: 14px !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-icon svg,
            .ghcn-tldr-header-icon .octicon {
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
                fill: currentColor !important;
            }
            .ghcn-tldr-header-text {
                display: inline-block !important;
                line-height: 20px !important;
                font-weight: 500 !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-btn.is-loading .ghcn-tldr-header-icon {
                animation: ghcn-tldr-spin 0.8s linear infinite !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-btn {
                background-color: var(--button-primary-bgColor-rest, #238636) !important;
                border-color: var(--button-primary-borderColor-rest, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-btn:hover {
                background-color: var(--button-primary-bgColor-hover, #2ea043) !important;
                border-color: var(--button-primary-borderColor-hover, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn {
                background-color: var(--button-default-bgColor-rest, #21262d) !important;
                border-color: var(--button-default-borderColor-rest, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-default-fgColor-rest, #c9d1d9) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn:hover {
                background-color: var(--button-default-bgColor-hover, #30363d) !important;
                border-color: var(--button-default-borderColor-hover, #8b949e) !important;
                color: var(--button-default-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn:active {
                background-color: var(--button-default-bgColor-active, #282e33) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn.is-loading .ghcn-tldr-tool-icon {
                color: #a371f7 !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-icon,
            [data-color-mode="dark"] .ghcn-tldr-header-text {
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-body {
                padding: 14px 18px !important;
                background-color: #f6faf7 !important;
                display: flex;
                flex-direction: column;
                gap: 12px;
                font-size: 13px;
                line-height: 1.6;
                color: var(--fgColor-default, #1f2328);
                box-sizing: border-box;
            }
            [data-color-mode="dark"] .ghcn-tldr-card {
                background-color: var(--bgColor-muted, #161b22) !important;
                border-bottom-color: var(--borderColor-muted, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header {
                background-color: var(--bgColor-muted, #161b22) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-card.is-completed .ghcn-tldr-header {
                border-bottom-color: var(--borderColor-muted, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-body {
                background-color: rgba(46, 160, 67, 0.08) !important;
                color: var(--fgColor-default, #e6edf3) !important;
            }
            .ghcn-tldr-row {
                font-size: 13px;
                line-height: 1.6;
                color: var(--fgColor-default, #1f2328);
                word-break: break-word;
            }
            .ghcn-tldr-label {
                font-weight: 600;
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-text {
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-note {
                font-size: 12px;
                color: var(--fgColor-muted, #656d76);
                margin-left: 6px;
            }
            .ghcn-tldr-inline-code {
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
                font-size: 12px;
                padding: 2px 6px;
                border-radius: 4px;
                background-color: var(--bgColor-muted, #f6f8fa);
                border: 1px solid var(--borderColor-muted, #d8dee4);
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-row--cmd {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .ghcn-tldr-cmd-box {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                background-color: var(--bgColor-muted, #f6f8fa);
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 6px;
                padding: 6px 10px;
                box-sizing: border-box;
            }
            .ghcn-tldr-cmd-inner {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                flex: 1;
                overflow-x: auto;
                scrollbar-width: thin;
            }
            .ghcn-tldr-cmd-prompt {
                color: var(--fgColor-muted, #656d76);
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
                font-size: 12px;
                font-weight: 600;
                user-select: none;
                flex-shrink: 0;
            }
            .ghcn-tldr-cmd-code {
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
                font-size: 12px;
                color: var(--fgColor-default, #1f2328);
                white-space: nowrap;
                user-select: all;
            }
            .ghcn-tldr-copy-cmd {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 500;
                line-height: 16px;
                color: var(--fgColor-muted, #656d76);
                background-color: var(--button-default-bgColor-rest, #ffffff);
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
                user-select: none;
            }
            .ghcn-tldr-copy-cmd:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6);
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-copy-cmd.is-copied {
                color: var(--fgColor-success, #1a7f37);
                border-color: rgba(26, 127, 55, 0.4);
                background-color: rgba(46, 160, 67, 0.08);
            }
            .ghcn-tldr-copy-icon-wrap {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .ghcn-tldr-spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid var(--borderColor-default, #d0d7de);
                border-top-color: #8250df;
                border-radius: 50%;
                animation: ghcn-tldr-spin 0.75s linear infinite;
                flex-shrink: 0;
            }
            @keyframes ghcn-tldr-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .ghcn-tldr-error-icon {
                display: inline-flex;
                align-items: center;
                color: var(--fgColor-danger, #cf222e);
            }
            .ghcn-tldr-error-msg {
                color: var(--fgColor-danger, #cf222e);
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================================================
    // [Module] entry.js
    // ==========================================================================

    /**
     * init 函数：初始化翻译功能。
     */
    let pageLifecycleStarted = false;

    function startPageLifecycle(reason) {
        if (pageLifecycleStarted || !document.body) return;
        pageLifecycleStarted = true;

        updatePageConfig(reason);
        if (FeatureSet.enable_extension && pageConfig.currentPageType) {
            traverseNode(document.body);
        }

        // 配置读取可能在 DOMContentLoaded 之后完成；此时仍需立即安装观察器并触发 README 扫描。
        watchUpdate();
        watchReactHydration();
        scheduleReadmeTranslation(reason);
        scheduleIssuePrTranslationControls(reason);
        scheduleCollaborationHelperControls(reason);
        scheduleTldrCapsuleControls(reason);
    }

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
            const currentDocUrl = typeof getDocUrlNoHashFallback === 'function'
                ? getDocUrlNoHashFallback()
                : String(window?.location?.href || '').split('#')[0];
            const docUrlChanged = Boolean(typeof lastHistoryDocUrl !== 'undefined' && lastHistoryDocUrl && currentDocUrl && currentDocUrl !== lastHistoryDocUrl);
            if (typeof lastHistoryDocUrl !== 'undefined' && currentDocUrl) {
                lastHistoryDocUrl = currentDocUrl;
            }
            if (docUrlChanged) {
                if (typeof closeCollaborationModal === 'function') {
                    closeCollaborationModal();
                }
                if (typeof resetTldrRuntimeForNavigation === 'function') {
                    resetTldrRuntimeForNavigation();
                }
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
            updatePageConfig('turbo:load', true);
            scheduleIssuePrTranslationControls('turbo:load');
            scheduleCollaborationHelperControls('turbo:load');
            scheduleTldrCapsuleControls('turbo:load');
            scheduleReadmeTranslation('turbo:load');
            if (!pageConfig.currentPageType) return;

            // 软导航后必须全量扫描；仅靠 title/selector 会漏掉仓库顶栏等 React 文案
            scheduleTurboPageTranslation();
        });
        document.addEventListener('turbo:render', () => refreshAfterHistoryNavigation('turbo:render'));
        document.addEventListener('turbo:frame-load', () => {
            scheduleIssuePrTranslationControls('turbo:frame-load');
            scheduleCollaborationHelperControls('turbo:frame-load');
            scheduleTldrCapsuleControls('turbo:frame-load');
            scheduleReadmeTranslation('turbo:frame-load');
        });
        window.addEventListener('popstate', scheduleHistoryRefresh);
        window.addEventListener('pageshow', event => {
            if (event.persisted) scheduleHistoryRefresh(event);
        });

        // 首次页面翻译
        window.addEventListener('DOMContentLoaded', () => {
            startPageLifecycle('DOMContentLoaded');
        });

        // content script 在 document_start 注入后读取 storage 可能错过 DOMContentLoaded，
        // readyState 已经就绪时直接启动一次完整生命周期，避免 README 永久不触发翻译。
        if (document.readyState !== 'loading') {
            startPageLifecycle('init:ready');
        }
    }

})(window, document);
