/**
 * @file chrome/src/providers/dispatcher.js
 * 翻译调度引擎：并发控制、批处理分块、错误重试与降级机制
 */

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

