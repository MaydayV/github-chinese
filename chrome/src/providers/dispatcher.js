/**
 * @file chrome/src/providers/dispatcher.js
 * 翻译调度引擎：并发控制、批处理分块、错误重试与降级机制
 */

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

