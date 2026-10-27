/**
 * @file chrome/src/core/utils.js
 * 通用工具函数：URL 规整、HTML 实体转义、哈希计算与字符串截断
 */

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

