/**
 * @file chrome/src/providers/cloud-translators.js
 * 云端翻译器协议适配：DeepL、Google、Azure、通义千问 Qwen-MT 与 OpenAI 兼容协议
 */

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

