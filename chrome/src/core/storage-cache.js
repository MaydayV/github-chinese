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

