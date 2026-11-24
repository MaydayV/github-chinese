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
