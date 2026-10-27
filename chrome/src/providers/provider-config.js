/**
 * @file chrome/src/providers/provider-config.js
 * 翻译提供商配置校验、签名生成、目标语言映射与 API 路径解析
 */


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
