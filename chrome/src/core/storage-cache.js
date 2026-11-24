/**
 * @file chrome/src/core/storage-cache.js
 * 多级缓存、仓库信息抽取、本地存储读写与 Token 消耗统计
 */

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

