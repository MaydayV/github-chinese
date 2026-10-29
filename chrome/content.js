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
        enable_readme_translation: false,
        enable_issue_pr_translation: false,
        enable_collaboration_helper: false,
        enable_repo_tldr: false,
        readme_enable_token_record: false,
        readme_enable_repo_cache: false,
        readme_enable_progressive: false,
        readme_enable_debug: false,
        readme_provider: 'deepseek',
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
            '[class*="DirectoryRichtextContent"] article.markdown-body',
            'article.markdown-body.entry-content.container-lg[itemprop="text"]',
            'article.markdown-body.entry-content.container-lg',
            'article.markdown-body[itemprop="text"]'
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
            '.js-snippet-clipboard-copy-unpositioned',
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
        stateByElement: new WeakMap(),
        isApplyingTranslation: false,
        domMutationGuardDepth: 0,
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

    const collabRuntime = {
        timerId: 0,
        modalEl: null,
    };

    const tldrRuntime = {
        timerId: 0,
        isBusy: false,
    };

    const FIXED_TARGET_LANG = 'zh-CN';
    const AI_CHAT_PROVIDERS = ['openai', 'openai_compatible', 'deepseek', 'qwen', 'minimax', 'kimi', 'zhipu', 'volcengine'];

    let pageConfig = {};
    let scheduleReactGlobalNavRefresh = () => {};
    let refreshPageObserver = () => {};
    let historyRefreshTimer = null;

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

    function createHash(input) {
        let hash = 0;
        for (let i = 0; i < input.length; i += 1) {
            hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
        }
        return (hash >>> 0).toString(16);
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

    function getStableReadmeTextHash(html) {
        const container = document.createElement('div');
        container.innerHTML = String(html || '');
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

    function normalizeRepoCacheEntries(entries) {
        const list = Array.isArray(entries) ? entries : [];

        return list
            .filter((item) => item
                && typeof item.key === 'string'
                && ((typeof item.translatedHtml === 'string' && !containsObjectObjectArtifact(item.translatedHtml))
                    || (typeof item.tldrContent === 'string' && !containsObjectObjectArtifact(item.tldrContent))))
            .map((item) => ({
                key: item.key,
                repo: item.repo || '',
                sourceHash: item.sourceHash || '',
                translatedHtml: item.translatedHtml || '',
                tldrContent: item.tldrContent || '',
                complete: item.complete === true,
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
        const hasHtml = typeof value?.translatedHtml === 'string' && value.translatedHtml.length <= README_CONFIG.MAX_CACHE_HTML_CHARS && !containsObjectObjectArtifact(value.translatedHtml);
        const hasTldr = typeof value?.tldrContent === 'string' && value.tldrContent.length <= README_CONFIG.MAX_CACHE_HTML_CHARS && !containsObjectObjectArtifact(value.tldrContent);

        if (!hasHtml && !hasTldr) return;

        await ensureRepoCacheLoaded();

        const existing = readmeRuntime.repoCacheMap.get(cacheKey) || {};

        readmeRuntime.repoCacheMap.set(cacheKey, {
            ...existing,
            key: cacheKey,
            repo: value.repo || existing.repo || '',
            sourceHash: value.sourceHash || existing.sourceHash || '',
            translatedHtml: value.translatedHtml ?? existing.translatedHtml ?? '',
            tldrContent: value.tldrContent ?? existing.tldrContent ?? '',
            complete: value.complete ?? existing.complete ?? false,
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
        if (element?.closest('pre, code, kbd, samp, button, .js-snippet-clipboard-copy-unpositioned, .snippet-clipboard-content')) {
            return true;
        }
        if (!input) return false;

        // 有些 README 会把命令放在普通 p/div/span 中，不能只依赖 pre/code 标签判断。
        if (/^(?:[$>#]\s*)?(?:npm|pnpm|yarn|bun|node|python(?:3)?|pip(?:3)?|uv|go|cargo|docker(?:\s+compose)?|podman|kubectl|helm|git|gh|curl|wget|make|cmake|brew|apt(?:-get)?|apk|dnf|yum|ssh|chmod|chown|mkdir|cd|export|set)\b(?:\s|$)/i.test(input)
            || /^(?:\.\.?[\\/]|[A-Za-z]:[\\/])/.test(input)) {
            return true;
        }
        if (input.length > 120) return false;
        if (isLikelyOpaqueReadmeLabel(input, node)) return true;

        // 版本号、文件名和纯标识符通常不需要翻译；它们保持原文时不应把整篇 README 判为部分完成。
        if (/^[a-z]+\s+(?:version\s+)?v?\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9]+)?[.!]?$/i.test(input)) {
            return true;
        }
        return false;
    }

    function isLikelyOpaqueReadmeLabel(text, node = null) {
        const input = String(text || '').trim();
        if (!input || input.length > 120 || /[\u3400-\u9FFF]/.test(input)) return false;

        const words = input.split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 8) return false;

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
        if (normalizedWords.some((word) => sentenceWords.has(word))
            && !/\([A-Z0-9]{2,}\)/.test(input)) return false;

        const element = node?.parentElement;
        const isLink = Boolean(element?.closest('a[href]'));
        const isListLabel = Boolean(element?.closest('li, dt, code'));
        const hasOpaquePattern = /[0-9_./+#@:-]/.test(input)
            || /[a-z][A-Z]/.test(input)
            || /\([A-Z0-9]{2,}\)/.test(input)
            || words.some((word) => /^[A-Z0-9]{2,}$/.test(word));
        if (hasOpaquePattern) return true;

        const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9]*$/.test(word));
        if ((isLink || isListLabel)
            && titleCaseWords.length === words.length
            && (words.some((word) => word.length > 2) || (isLink && words.length === 1 && !sentenceWords.has(normalizedWords[0])))) {
            return true;
        }

        // 外部链接中的单一标识通常是包名/库名/平台名（如 boto、X），而不是自然语言句子。
        return isLink && words.length === 1 && !sentenceWords.has(normalizedWords[0]) && /^[A-Za-z0-9-]+$/.test(input);
    }


    function isMostlyCjkText(text) {
        const input = String(text || '');
        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        if (!cjkCount) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        const latinWords = (input.match(/[A-Za-z]{2,}/g) || []).length;
        const cjkPunctuation = (input.match(/[\u3000-\u303F\uFF01-\uFF5E]/g) || []).length;

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

    // ==========================================================================
    // [Module] features/ui-localization.js
    // ==========================================================================

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
            translations: (data?.data?.translations || []).map(item => decodeHtmlEntities(normalizeTranslationText(item?.translatedText ?? item))),
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
        const raw = extractChatMessageContent(firstChoice);

        return {
            translations: parseOpenAiArray(raw, texts.length),
            tokens: getReadmeUsageTokens(data),
        };
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

        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
            text = text.slice(start, end + 1);
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw createRecoverableTranslationError('OpenAI 兼容接口返回内容不是合法 JSON 数组。');
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
        return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
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
        let response;
        for (let attempt = 1; ; attempt += 1) {
            try {
                response = await sendProxyMessageOnce(request);
                break;
            } catch (error) {
                if (isExtensionContextInvalidatedError(error) || attempt >= maxAttempts) {
                    throw error;
                }
                await new Promise((resolve) => window.setTimeout(resolve, 150 * attempt));
            }
        }

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

    // ==========================================================================
    // [Module] providers/dispatcher.js
    // ==========================================================================

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
        const batches = buildBatches(uncached, maxBatchItems, maxBatchChars);
        addReadmeDebugEvent(debugContext, 'batches_created', {
            batchPhase: debugPhase,
            inputCount: texts.length,
            uncachedCount: uncached.length,
            batchCount: batches.length,
            concurrency: preferSingleItem ? 2 : README_CONFIG.TRANSLATION_CONCURRENCY,
            batchSizes: batches.map((batch) => batch.length),
        });
        const batchResults = await mapWithConcurrency(
            batches,
            preferSingleItem ? 2 : README_CONFIG.TRANSLATION_CONCURRENCY,
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
                    let translatedItems = 0;
                    const missedItems = [];

                    for (let index = 0; index < batch.length; index += 1) {
                        const text = batch[index];
                        let translated = normalizeTranslationText(batchTranslations[index]);

                        if (!isUsableTranslation(text, translated)) {
                            try {
                                const retry = await translateBatchWithFallback([text], providerConfig);
                                translated = normalizeTranslationText(retry.translations[0]);
                            } catch (error) {
                                if (isExtensionContextInvalidatedError(error)) {
                                    throw error;
                                }
                                console.warn('[README翻译] 单条重试失败:', error);
                            }
                        }

                        const cacheKey = `${providerConfig.signature}|${text}`;
                        if (isUsableTranslation(text, translated)) {
                            readmeRuntime.translationCache.set(cacheKey, translated);
                            translatedMap.set(text, translated);
                            translatedItems += 1;
                        } else {
                            translatedMap.set(text, text);
                            missedItems.push({
                                textHash: createHash(text),
                                textPreview: sanitizeReadmeDebugText(text),
                            });
                        }
                    }

                    addReadmeDebugEvent(debugContext, 'batch_end', {
                        batchPhase: debugPhase,
                        batch: batchIndex,
                        itemCount: batch.length,
                        translatedItems,
                        missedItems,
                        tokens: batchResult.tokens,
                        durationMs: Math.max(0, Date.now() - startedAt),
                    });
                    return batchResult.tokens;
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
        const workerCount = Math.min(values.length, Math.max(1, Number(concurrency) || 1));

        const runWorker = async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= values.length) return;
                results[index] = await worker(values[index], index);
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

    async function translateBatchWithFallback(batch, providerConfig) {
        try {
            const result = await translateBatch(batch, providerConfig);
            const translations = result?.translations;
            const tokens = Math.max(0, Number(result?.tokens) || 0);

            if (!Array.isArray(translations) || translations.length !== batch.length) {
                throw createRecoverableTranslationError('翻译结果数量与请求数量不一致，请检查接口配置。');
            }
            return {
                translations,
                tokens,
            };
        } catch (error) {
            const isAiProvider = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';

            // 仅对 AI 接口的“内容/解析类”错误做降级；网络/鉴权/配置等错误继续上抛，
            // 避免把整篇静默留成英文、且能向用户报错。
            if (!isAiProvider || !error?.recoverable) {
                throw error;
            }

            // 单条仍失败：降级为原文占位（交由上层单条重试与补翻译 pass 处理），
            // 关键是让二分中已翻好的兄弟条目不再被一条坏内容连坐丢失。
            if (batch.length <= 1) {
                return { translations: batch.slice(), tokens: 0 };
            }

            // OpenAI 兼容接口在部分平台上会因 JSON 输出不稳定导致整批失败，二分缩小坏条目的影响范围。
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
            const element = document.querySelector(selector);
            if (!element) continue;
            // 避免在议题/PR 等页面误选普通 markdown 正文
            if (element.closest('.js-comment-body, [data-testid="markdown-body"], .comment-body')) {
                continue;
            }

            return element;
        }

        return null;
    }

    // 仓库侧栏 About 描述（React 组件，CSS-module 哈希类，用模块名和 description 子串匹配
    // 同时兼容 SidebarAbout-module__description 与 SidebarAbout-module_<hash>_description）。
    // 属仓库主自定义的自由文本，静态词库无法收录，故与 README 一样走 AI 内容翻译、就地替换。
    function getRepoAboutElements() {
        return [...document.querySelectorAll('p[class*="SidebarAbout-module"][class*="description"]')]
            .filter(element => !element.closest('.js-comment-body, [data-testid="markdown-body"], .comment-body'));
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
        const repoInfo = getCurrentRepoInfo();
        const elementsWithTasks = [];

        for (const aboutEl of aboutElements) {
            const tasks = collectReadmeTextTasks(aboutEl);
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
            const cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true }).catch(() => null);
            if (cached?.translatedHtml) {
                try {
                    const cachedData = JSON.parse(cached.translatedHtml);
                    if (cachedData?.translations && typeof cachedData.translations === 'object') {
                        const translatedMap = new Map(Object.entries(cachedData.translations));
                        for (const { aboutEl, tasks } of elementsWithTasks) {
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
                            console.warn('[About翻译] 写入缓存记录失败:', error);
                        });

                        return translatedCount;
                    }
                } catch {
                    // JSON 解析失败则回退至常规翻译
                }
            }
        }

        const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig, {
            debugContext,
            debugPhase: 'about',
        });
        totalTokens = tokens;

        for (const { aboutEl, tasks } of elementsWithTasks) {
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

        addReadmeDebugEvent(debugContext, 'about_end', { translatedCount });

        if (translatedCount > 0) {
            if (cacheKey) {
                const cachePayload = {
                    translations: Object.fromEntries(translatedMap),
                };
                await upsertRepoCachedTranslation(cacheKey, {
                    repo: repoInfo?.fullName || '',
                    sourceHash,
                    translatedHtml: JSON.stringify(cachePayload),
                    complete: translatedCount >= allTasks.length,
                }).catch((error) => {
                    console.warn('[About翻译] 写入缓存失败:', error);
                });
            }

            await appendReadmeTranslationRecord({
                sourceType: 'about',
                status: 'success',
                tokens: totalTokens,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: `about_translated_nodes=${translatedCount}`,
            }).catch((error) => {
                console.warn('[About翻译] 写入翻译记录失败:', error);
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
            const existing = await getLocalValue(README_LOCAL_STORAGE_KEYS.DEBUG_LOGS, []);
            const logs = Array.isArray(existing) ? existing : [];
            logs.push(entry);
            await setLocalValue(
                README_LOCAL_STORAGE_KEYS.DEBUG_LOGS,
                logs.slice(-README_CONFIG.DEBUG_LOG_MAX_ENTRIES),
            );
        } catch (error) {
            console.warn('[README翻译调试] 保存调试日志失败:', error);
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

        const liveTasks = collectReadmeTextTasks(rootEl);
        const liveByText = new Map();
        liveTasks.forEach((task) => {
            if (!liveByText.has(task.normalizedText)) {
                liveByText.set(task.normalizedText, []);
            }
            liveByText.get(task.normalizedText).push(task);
        });

        const usedNodes = new Set();
        const refreshed = [];

        tasks.forEach((task) => {
            const candidates = liveByText.get(task.normalizedText) || [];
            const replacement = candidates.find((candidate) => !usedNodes.has(candidate.node))
                || (task.node?.isConnected ? task : null);

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

        texts.forEach((text) => {
            const translated = normalizeTranslationText(translatedMap.get(text));
            if (!isUsableTranslation(text, translated)) return;

            const tasks = refreshReadmeTextTaskNodes(rootEl, tasksByText.get(text) || []);
            tasks.forEach((task) => {
                if (!task.node?.isConnected) return;
                task.node.data = task.rawText.replace(task.trimmedText, translated);
                translatedCount += 1;
            });
        });

        return translatedCount;
    }

    function replaceElementChildrenFromHtml(element, html) {
        const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const nodes = Array.from(parsed.body.childNodes, node => document.importNode(node, true));
        element.replaceChildren(...nodes);
    }

    function applyReadmeHtml(readmeEl, html) {
        return withReadmeDomMutationGuard(() => {
            replaceElementChildrenFromHtml(readmeEl, html);
        });
    }

    function applyReadmeTextGroupTranslations(rootEl, tasksByText, texts, translatedMap) {
        return applyTextGroupTranslations(rootEl, tasksByText, texts, translatedMap);
    }

    function applyTaskTranslations(rootEl, tasks, translatedMap) {
        let translatedCount = 0;

        refreshReadmeTextTaskNodes(rootEl, tasks).forEach((task) => {
            const translated = normalizeTranslationText(translatedMap.get(task.normalizedText));
            if (!isUsableTranslation(task.normalizedText, translated)) return;
            if (!task.node?.isConnected) return;

            task.node.data = task.rawText.replace(task.trimmedText, translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function applyReadmeTaskTranslations(rootEl, tasks, translatedMap) {
        return applyTaskTranslations(rootEl, tasks, translatedMap);
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
        const shouldTranslateAbout = isRepoAboutTranslationEnabled();
        if (!shouldTranslateReadme && !shouldTranslateAbout) {
            restoreReadmeTranslation();
            return;
        }

        if (readmeRuntime.inFlight) {
            readmeRuntime.rerunRequested = true;
            return;
        }

        const readmeEl = getReadmeRootElement();
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
                    addReadmeDebugEvent(debugContext, 'about_failed', {
                        message: normalizeRuntimeErrorMessage(error),
                    });
                    console.warn('[About翻译] 执行失败:', error);
                }));
            }

            if (shouldTranslateReadme && readmeEl) {
                translationTasks.push(translateReadmeElement(readmeEl, reason, debugContext));
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
                console.warn('[README翻译] 记录失败日志时出错:', recordError);
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

        const sourceText = normalizeText(readmeEl.textContent || '');
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
            console.warn('[README翻译] 读取仓库缓存失败:', error);
            return null;
        });
        if (!cacheHit && legacyRepoCacheKey && legacyRepoCacheKey !== repoCacheKey) {
            cacheHit = await getRepoCachedTranslation(legacyRepoCacheKey).catch((error) => {
                console.warn('[README翻译] 读取旧版仓库缓存失败:', error);
                return null;
            });
            if (cacheHit) cacheKeyUsed = legacyRepoCacheKey;
        }

        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[README翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                applyReadmeHtml(readmeEl, cacheHit.translatedHtml);
                const cachedRemaining = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml)
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
                        console.warn('[README翻译] 写入缓存命中记录失败:', error);
                    });
                    addReadmeDebugEvent(debugContext, 'cache_hit', {
                        cacheKey: cacheKeyUsed,
                        stableCacheKey: repoCacheKey,
                        migrated: cacheKeyUsed !== repoCacheKey,
                        htmlLength: cacheHit.translatedHtml.length,
                        complete: true,
                    });
                    if (cacheKeyUsed !== repoCacheKey || cacheHit.complete !== true) {
                        await upsertRepoCachedTranslation(repoCacheKey, {
                            repo: repoInfo?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                        }).catch((error) => {
                            console.warn('[README翻译] 迁移/补全仓库缓存失败:', error);
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

        // 这三个计数在 finally 之后写翻译记录时仍要用，必须声明在 try 块外的函数作用域。
        let translatedCount = 0;
        let totalTokens = 0;
        let retryMissedCount = 0;

        pushReadmeDomMutationGuard();
        try {
        if (!partialCacheApplied && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        const runTranslationPass = async (passName) => {
            const tasks = collectReadmeTextTasks(readmeEl)
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
                        const groupTexts = [...new Set(group.map(task => task.normalizedText))];
                        const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(
                            groupTexts,
                            providerConfig,
                            { debugContext, debugPhase: passName, debugBatchIndex: index },
                        );

                        // 软导航防重入校验：若网络请求期间用户已跳转或节点已卸载，安全放弃本次 DOM 回填
                        if (!readmeEl.isConnected || window.location.href !== expectedHref) {
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
                        if (index < groups.length - 1) await waitForNextPaint();
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

                if (!readmeEl.isConnected || window.location.href !== expectedHref) {
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

        if (!readmeEl.isConnected || window.location.href !== expectedHref) {
            return;
        }

        // 补翻译：首轮后仍有未翻句子（渐进翻译期间 DOM 被 React 重渲染、或个别条目内容降级为原文），
        // 逐条重试收尾。以“无进展即停止 + 最多 maxRetryPasses 轮”双重保险避免空转。
        const maxRetryPasses = 2;
        for (let attempt = 0; attempt < maxRetryPasses; attempt += 1) {
            if (!readmeEl.isConnected || window.location.href !== expectedHref) break;

            const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml)
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

            const { translatedMap, totalTokens: retryTokens } = await translateTextsWithProvider(
                retryTexts,
                providerConfig,
                { preferSingleItem: true, debugContext, debugPhase: `retry_${attempt + 1}` },
            );
            totalTokens += retryTokens;

            if (!readmeEl.isConnected || window.location.href !== expectedHref) break;

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

        if (!readmeEl.isConnected || window.location.href !== expectedHref) {
            return;
        }

        if (!translatedCount && !collectReadmeUntranslatedTasks(readmeEl, state.originalHtml)
            .some((task) => task.node?.isConnected)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
            return;
        }
        } finally {
            popReadmeDomMutationGuard();
        }

        if (!readmeEl.isConnected || window.location.href !== expectedHref) {
            return;
        }

        const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml)
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
        if (!stillMissed) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
        } else {
            // 部分结果也要持久化；刷新时先恢复已成功节点，再只补翻译剩余节点。
            state.translatedSignature = '';
            state.translatedHash = '';
            state.translatedTextHash = '';
        }

        if (!stillMissed || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(repoCacheKey, {
                repo: repoInfo?.fullName || '',
                sourceHash,
                translatedHtml: readmeEl.innerHTML,
                complete: !stillMissed,
            }).catch((error) => {
                console.warn('[README翻译] 写入仓库缓存失败:', error);
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


    function collectReadmeOriginalTextCounts(originalHtml) {
        const container = document.createElement('div');
        container.innerHTML = String(originalHtml || '');
        const counts = new Map();

        collectReadmeTextTasks(container).forEach((task) => {
            if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return;
            counts.set(task.normalizedText, (counts.get(task.normalizedText) || 0) + 1);
        });
        return counts;
    }

    function collectReadmeUntranslatedTasks(readmeEl, originalHtml) {
        const originalCounts = collectReadmeOriginalTextCounts(originalHtml);
        return collectReadmeTextTasks(readmeEl)
            .filter((task) => {
                if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return false;
                const remaining = originalCounts.get(task.normalizedText) || 0;
                if (!remaining) return false;

                originalCounts.set(task.normalizedText, remaining - 1);
                return !isLikelyTechnicalReadmeText(task.normalizedText, task.node);
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

        const findMenuButton = (scope) => {
            if (!scope?.querySelector) return null;

            const menuSelectors = [
                '[data-testid="comment-header-hamburger"]',
                'svg.octicon-kebab-horizontal',
                'button[aria-label*="More" i]',
                'button[aria-label*="Actions" i]',
            ];
            for (const selector of menuSelectors) {
                const menuNode = scope.querySelector(selector);
                const menuButton = menuNode?.closest('button, [role="button"]');
                if (menuButton) return menuButton;
            }
            return null;
        };

        // 回复评论可能嵌套在同一个 timeline-comment-group 中；从正文向上查找，
        // 优先使用当前评论自己的操作菜单，避免误用父评论或标题区域的 flex 容器。
        let menuButton = null;
        let scope = item.markdownEl?.parentElement;
        while (scope && rootEl.contains(scope)) {
            menuButton = findMenuButton(scope);
            if (menuButton) break;
            if (scope === rootEl) break;
            scope = scope.parentElement;
        }
        menuButton ||= findMenuButton(rootEl);

        // 新版 GitHub 把三个点放在 .timeline-comment-actions 内层的 flex 行中；
        // 优先使用该行，避免插入块级外层后被换到上一行。
        const actionRow = menuButton?.closest('comment-actions-container')?.parentElement;
        if (actionRow) return actionRow;

        // 兼容旧版直接把菜单放在 .timeline-comment-actions 下的结构。
        const actionGroup = menuButton?.closest('.timeline-comment-actions');
        if (actionGroup) return actionGroup;

        // 当前 React 评论头部会把三点按钮包在 ActionsButtonsContainer 中；
        // 直接挂到该容器，才能让翻译按钮紧挨三点左侧，而不是排在贡献者标签之前。
        const menuButtonsContainer = menuButton?.closest('[class*="ActionsButtonsContainer"]');
        if (menuButtonsContainer) return menuButtonsContainer;

        const menuRow = menuButton?.closest('[data-testid="comment-header-right-side-items"], .timeline-comment-actions > .d-flex');
        if (menuRow) return menuRow;

        const commentActionsRow = rootEl.querySelector('comment-actions-container')?.parentElement;
        if (commentActionsRow) return commentActionsRow;

        return rootEl.querySelector('[data-testid="comment-header-right-side-items"] [class*="ActionsButtonsContainer"]')
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"] [data-testid="comment-header-hamburger"]')?.parentElement
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"]')
            || rootEl.querySelector('.timeline-comment-actions')
            || rootEl.querySelector('.timeline-comment-header .timeline-comment-actions')
            || rootEl.querySelector('[class*="actionsSection"]')
            || rootEl.querySelector('[class*="actionsWrapper"]')
            || rootEl.querySelector('[aria-label="Discussion actions"]')?.parentElement
            || rootEl.querySelector('[aria-label="Discussion comment actions"]')?.parentElement
            || rootEl.querySelector('[data-testid="discussion-comment-actions"]')
            || rootEl.querySelector('[aria-label="Issue body actions"]')?.parentElement
            || rootEl.querySelector('[aria-label="Comment actions"]')?.parentElement
            || rootEl.querySelector('[data-testid="issue-body-header-author"]')?.closest('[class*="activityHeader"]');
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
        if (state.toolbarEl?.isConnected) {
            // GitHub 的 Turbo/React 重绘可能保留旧工具条节点；每次扫描都把它
            // 重新归位到三个点所在的操作行，避免遗留在 header 顶部。
            if (slotEl && state.toolbarEl.parentElement !== slotEl) {
                slotEl.insertBefore(state.toolbarEl, slotEl.firstChild);
            }
            return;
        }

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

        let translatedEl = createTranslatedClone(markdownEl);
        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[Issue/PR翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                replaceElementChildrenFromHtml(translatedEl, cacheHit.translatedHtml);
                const cachedRemaining = collectIssuePrTextTasks(translatedEl);
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
                        console.warn('[Issue/PR翻译] 写入缓存命中记录失败:', error);
                    });
                    if (cacheHit.complete !== true) {
                        await upsertRepoCachedTranslation(cacheKey, {
                            repo: getCurrentRepoInfo()?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                        }).catch((error) => {
                            console.warn('[Issue/PR翻译] 补全讨论缓存状态失败:', error);
                        });
                    }
                    return;
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
                translatedCount += applyTaskTranslations(translatedEl, groups[index], translatedMap);

                if (index < groups.length - 1) {
                    await waitForNextPaint();
                }
            }
        } else {
            const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig);
            totalTokens += tokens;
            translatedCount += applyTextGroupTranslations(translatedEl, tasksByText, uniqueTexts, translatedMap);
        }

        const complete = translatedCount >= tasks.length;
        state.translatedSignature = complete ? signature : '';
        state.translatedHash = complete ? createHash(markdownEl.innerHTML) : '';
        state.sourceHash = sourceHash;
        state.errorMessage = '';

        if (complete || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(cacheKey, {
                repo: getCurrentRepoInfo()?.fullName || '',
                sourceHash,
                translatedHtml: translatedEl.innerHTML,
                complete,
            }).catch((error) => {
                console.warn('[Issue/PR翻译] 写入讨论缓存失败:', error);
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
        closeCollaborationModal();
    }

    function isValidCollaborationTextarea(el) {
        if (!el || !el.isConnected) return false;
        if (el.tagName !== 'TEXTAREA') return false;
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
        document.querySelectorAll('markdown-toolbar[for], [data-for]').forEach((toolbar) => {
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

        let toolbar = null;

        // 1. 优先通过 textarea.id 与 markdown-toolbar[for] 进行精确 1:1 匹配
        if (textarea.id) {
            try {
                toolbar = document.querySelector(`markdown-toolbar[for="${CSS.escape(textarea.id)}"]`)
                       || document.querySelector(`[data-for="${CSS.escape(textarea.id)}"]`);
            } catch {
                toolbar = document.querySelector(`markdown-toolbar[for="${textarea.id}"]`);
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
                    if (el) {
                        toolbar = el;
                        break;
                    }
                }
            }
        }

        // 3. 兜底在所属表单范围查找
        if (!toolbar) {
            const formScope = textarea.closest('form') || textarea.parentElement;
            if (formScope) {
                for (const selector of toolbarSelectors) {
                    const el = formScope.querySelector(selector);
                    if (el) {
                        toolbar = el;
                        break;
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
            const tabList = editorContainer.querySelector('[role="tablist"], [data-testid="markdown-editor-tab-bar"], [data-testid="markdown-editor-tabs"], ul.tabnav-tabs');
            if (tabList && tabList.parentElement) {
                const nextSibling = tabList.nextElementSibling;
                if (nextSibling) {
                    return {
                        container: nextSibling,
                        beforeEl: nextSibling.firstElementChild,
                    };
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
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openCollaborationModal(textarea);
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

        copyBtn.addEventListener('click', async () => {
            const text = previewArea.value;
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '已复制';
                window.setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 1500);
            } catch {
                previewArea.select();
                document.execCommand('copy');
            }
        });

        applyBtn.addEventListener('click', () => {
            const text = previewArea.value;
            if (!text) return;
            applyPolishedTextToTextarea(textarea, text);
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
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCollaborationModal();
            }
        };
        window.addEventListener('keydown', keyHandler);

        const originalRemove = overlay.remove.bind(overlay);
        overlay.remove = () => {
            window.removeEventListener('keydown', keyHandler);
            originalRemove();
        };

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
            console.warn('[协作润色助手] 记录写入失败:', err);
        });

        return {
            text: polishedText,
            tokens: totalTokens,
            durationMs,
        };
    }

    function applyPolishedTextToTextarea(textarea, text) {
        if (!textarea) return;
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
        mountTldrCapsule(readmeRoot, repoInfo);
    }

    function restoreTldrCapsuleControls() {
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
        let sourceEl = readmeRoot;
        if (state?.originalHtml) {
            sourceEl = document.createElement('div');
            sourceEl.innerHTML = state.originalHtml;
        }
        const clone = sourceEl.cloneNode(true);
        clone.querySelectorAll('pre, code, svg, img, table, .notranslate, [translate="no"]').forEach((el) => el.remove());
        const text = normalizeText(clone.textContent || '');
        return text.slice(0, maxChars);
    }

    function findTldrMountPoint(readmeRoot) {
        if (!readmeRoot) return null;

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

        const oldCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (oldCard) {
            if (oldCard.dataset.sourceHash === sourceHash && oldCard.parentElement === mountPoint.parent && oldCard.nextElementSibling === mountPoint.before) {
                oldCard.style.display = '';
                return oldCard;
            }
            oldCard.remove();
        }

        const card = document.createElement('section');
        card.className = 'ghcn-tldr-card';
        card.dataset.ghcnTldr = 'capsule';
        card.dataset.sourceHash = sourceHash;

        mountPoint.parent.insertBefore(card, mountPoint.before);
        return card;
    }

    function mountTldrHeaderButton(readmeRoot, repoInfo, onToggle) {
        const headerActions = findReadmeHeaderActions(readmeRoot);
        if (!headerActions || !headerActions.container) return null;

        const sourceHash = getTldrSourceHash(readmeRoot);

        let btn = document.querySelector('[data-ghcn-tldr="header-btn"]');
        if (btn) {
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

        headerActions.container.insertBefore(btn, headerActions.beforeEl);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof onToggle === 'function') {
                onToggle(btn);
            }
        });

        return btn;
    }

    async function mountTldrCapsule(readmeRoot, repoInfo) {
        const sourceHash = getTldrSourceHash(readmeRoot);
        const cacheKey = buildTldrCacheKey(repoInfo, sourceHash);

        // 1. 精确匹配当前 hash 缓存
        let cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true });

        // 2. 兜底匹配该仓库最新生成的速读缓存（防止 README 翻译后 DOM 变动导致 hash 微小变化）
        if (!cached?.tldrContent && FeatureSet.readme_enable_repo_cache && repoInfo?.fullName) {
            await ensureRepoCacheLoaded();
            const prefix = `${repoInfo.fullName.toLowerCase()}|tldr|`;
            for (const [key, entry] of readmeRuntime.repoCacheMap.entries()) {
                if (key.startsWith(prefix) && entry.tldrContent && entry.complete === true) {
                    cached = entry;
                    break;
                }
            }
        }

        const headerActions = findReadmeHeaderActions(readmeRoot);

        // 挂载或更新头部按钮（位于 Copilot 图标左侧）
        const headerBtn = mountTldrHeaderButton(readmeRoot, repoInfo, async (btn) => {
            let card = document.querySelector('[data-ghcn-tldr="capsule"]');

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
        const existingCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (existingCard && !headerBtn?.classList.contains('is-active')) {
            existingCard.style.display = 'none';
        }

        if (headerBtn) {
            headerBtn.classList.remove('is-active');
            headerBtn.setAttribute('aria-expanded', 'false');
            if (cached?.tldrContent) {
                headerBtn.setAttribute('data-has-cache', 'true');
                headerBtn.title = 'AI 项目速读 (TL;DR) - 点击展开速读卡片';
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
                    <span class="ghcn-tldr-error-msg">${decodeHtmlEntities(message || '接口调用异常')}</span>
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
        if (tldrRuntime.isBusy) return;
        tldrRuntime.isBusy = true;
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
                summaryText = stripOpenAiReasoningBlocks(extractChatMessageContent(firstChoice));
                totalTokens = getReadmeUsageTokens(data);
            }

            if (!summaryText) {
                throw new Error('速读胶囊生成结果为空，请重试或检查接口配置。');
            }

            const durationMs = performance.now() - startAt;

            // Save to repo cache
            await upsertRepoCachedTranslation(cacheKey, {
                repo: repoInfo.fullName,
                sourceHash: activeSourceHash,
                tldrContent: summaryText,
                complete: true,
            }).catch((err) => {
                console.warn('[速读胶囊] 写入缓存失败:', err);
            });

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
                console.warn('[速读胶囊] 写入翻译记录失败:', err);
            });

            renderTldrContent(card, summaryText, repoInfo, readmeRoot, activeSourceHash, false);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
                headerBtn.classList.add('is-active');
                headerBtn.setAttribute('aria-expanded', 'true');
            }
        } catch (error) {
            console.error('[速读胶囊] 生成失败:', error);
            renderTldrError(card, normalizeRuntimeErrorMessage(error), repoInfo, readmeRoot, activeSourceHash);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
            }
        } finally {
            tldrRuntime.isBusy = false;
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
            updatePageConfig('turbo:load');
            scheduleIssuePrTranslationControls('turbo:load');
            scheduleCollaborationHelperControls('turbo:load');
            scheduleTldrCapsuleControls('turbo:load');
            scheduleReadmeTranslation('turbo:load');
            if (!FeatureSet.enable_extension || !pageConfig.currentPageType) return;

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
