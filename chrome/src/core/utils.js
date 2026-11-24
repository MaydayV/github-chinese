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

