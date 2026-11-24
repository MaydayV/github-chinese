/**
 * @file chrome/src/core/text-filter.js
 * 文本与 CJK 过滤器：技术术语识别、跳过规则、语言判定与空白规范化
 */

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
        if (element?.closest('pre, code, kbd, samp, button, .snippet-clipboard-content')) {
            return true;
        }
        if (!input) return false;

        // 参数说明列表/表格中的单词键名（如 slug、tags、title、content）应保持原文，
        // 模型通常会原样返回，不能因此把 README 判为部分完成；但普通英文虚词仍需正常翻译。
        const commonListGlueWords = new Set([
            'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from', 'as', 'via',
            'into', 'over', 'under', 'between', 'through', 'without', 'using', 'the', 'is', 'are',
            'was', 'were', 'be', 'been', 'have', 'has', 'had', 'can', 'will', 'may', 'not', 'but',
            'if', 'when', 'where', 'that', 'this', 'these', 'those', 'plus', 'see', 'then', 'also',
            'only', 'both', 'either', 'all', 'any', 'each', 'more', 'less', 'than',
        ]);
        if (/^[a-z][a-z0-9_-]{1,24}$/.test(input)
            && !commonListGlueWords.has(input)
            && element?.closest('li, dt, table')) {
            return true;
        }

        // 有些 README 会把命令放在普通 p/div/span 中，不能只依赖 pre/code 标签判断。
        if (/^(?:[$>#]\s*)?(?:npm|pnpm|yarn|bun|node|python(?:3)?|pip(?:3)?|uv|go|cargo|docker(?:\s+compose)?|podman|kubectl|helm|git|gh|curl|wget|make|cmake|brew|apt(?:-get)?|apk|dnf|yum|ssh|chmod|chown|mkdir|cd|export|set)\b(?:\s|$)/i.test(input)
            || /^(?:\.\.?[\\/]|[A-Za-z]:[\\/])/.test(input)) {
            return true;
        }
        if (isLikelyOpaqueReadmeLabel(input, node)) return true;
        if (input.length > 120) return false;

        // 版本号、文件名和纯标识符通常不需要翻译；它们保持原文时不应把整篇 README 判为部分完成。
        if (/^[a-z]+\s+(?:version\s+)?v?\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9]+)?[.!]?$/i.test(input)) {
            return true;
        }
        return false;
    }

    function isLikelyOpaqueReadmeLabel(text, node = null) {
        const input = String(text || '').trim();
        if (!input || /[\u3400-\u9FFF]/.test(input)) return false;

        const element = node?.parentElement;
        if (/[·•]/.test(input) && !/[.!?;:]/.test(input)) {
            const segments = input.split(/\s*[·•]\s*/).filter(Boolean);
            const minSegments = element?.closest('table') ? 3 : 4;
            if (segments.length >= minSegments) {
                const proseSegmentWords = new Set([
                    'fast', 'simple', 'free', 'open', 'source', 'lightweight', 'secure', 'modern',
                    'easy', 'clean', 'powerful', 'flexible', 'reliable', 'private', 'local', 'cloud',
                    'docs', 'guide', 'install', 'features', 'demo', 'pricing', 'blog', 'about',
                    'contact', 'license', 'support', 'changelog', 'roadmap', 'getting', 'started',
                    'and', 'or', 'the', 'for', 'with', 'from', 'to', 'in', 'on', 'of', 'by', 'at',
                ]);
                const isProperToken = (token) => (
                    /^[A-Z][A-Za-z0-9.+-]*$/.test(token)
                    || /^[a-z]{1,4}[A-Z][A-Za-z0-9.+-]*$/.test(token)
                    || /^[A-Z0-9]{2,}[A-Za-z0-9.+-]*$/.test(token)
                    || /^(?:npm|pnpm|yarn|bun|cli|api|sdk|mcp|ide|os|fx|pi|ai|go|js|ts|py|rs)$/i.test(token)
                );
                const allBrandSegments = segments.every((segment) => {
                    const segWords = segment.split(/\s+/).filter(Boolean);
                    if (!segWords.length || segWords.length > 4) return false;
                    return segWords.every((word) => {
                        const cleaned = word.toLowerCase().replace(/^[([{]+|[)\]},.;:!?]+$/g, '');
                        return cleaned && !proseSegmentWords.has(cleaned) && isProperToken(word);
                    });
                });
                if (allBrandSegments) return true;
            }
        }
        if (input.length > 120) return false;

        const words = input.split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 8) return false;

        const isLink = Boolean(element?.closest('a[href]'));
        const isHeading = Boolean(element?.closest('h1, h2, h3, h4, h5, h6'));
        const isTableLink = isLink && Boolean(element?.closest('table'));
        const isTableDataCell = Boolean(element?.closest('td'));
        const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9]*$/.test(word));

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

        const tableProseWords = new Set([
            'yes', 'no', 'none', 'all', 'other', 'others', 'default', 'defaults', 'optional',
            'required', 'supported', 'unsupported', 'available', 'unavailable', 'experimental',
            'stable', 'deprecated', 'recommended', 'legacy', 'manual', 'automatic', 'auto',
            'custom', 'local', 'remote', 'global', 'free', 'paid', 'open', 'closed', 'read',
            'write', 'full', 'partial', 'basic', 'advanced', 'high', 'medium', 'low', 'fast',
            'slow', 'new', 'old', 'active', 'inactive', 'enabled', 'disabled', 'planned',
            'done', 'pending', 'coming', 'soon', 'see', 'more', 'less', 'both', 'either',
            'neither', 'unknown', 'empty', 'any', 'every', 'only', 'always', 'never', 'name',
            'type', 'description', 'status', 'platform', 'platforms', 'method', 'command',
            'commands', 'option', 'options', 'notes', 'note', 'value', 'values', 'version',
            'versions', 'source', 'target', 'language', 'languages', 'summary', 'details',
            'system', 'systems', 'action', 'actions', 'mode', 'modes', 'file', 'files',
            'path', 'paths', 'config', 'setting', 'settings', 'package', 'packages',
            'plugin', 'plugins', 'tool', 'tools', 'client', 'clients', 'server', 'servers',
            'provider', 'providers', 'model', 'models', 'editor', 'editors', 'browser',
            'browsers', 'true', 'false', 'official', 'product', 'page', 'hardware',
            'architecture', 'interfaces', 'downloads', 'changelog', 'support', 'security',
            'board', 'chipset', 'terminal', 'kiosk', 'display', 'module', 'control',
            'power', 'permissions', 'capabilities', 'reports', 'bug', 'releases', 'faq',
        ]);

        if (isHeading && words.length >= 2 && document.title.includes(input)) {
            return true;
        }

        if (words.length === 1) {
            if (/^(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i.test(input)) return true;
            if (/^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(?:md|markdown|rst|txt|json|ya?ml|toml|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ps1|bat|cmd|exe|apk|aar|jar|zip|tar|gz|tgz|dmg|pkg|deb|rpm|appimage|iso|bin|so|dll|dylib|png|jpe?g|gif|svg|webp|ico|pdf|lock|env|ini|cfg|conf|gradle))$/i.test(input)) {
                return true;
            }
            if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.(?:com|org|net|io|ai|dev|app|co|gg|rs|xyz|cloud|tech|site|edu|gov|cn|uk|de|jp|fr|eu|info|biz|tv|cc|fm|ly)$/.test(input)) {
                return true;
            }
            if (isLink && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.(?:me|sh|so|to|tools|run|build|land|im|pro|page|link|work|studio|design)$/i.test(input)) {
                return true;
            }
            if (/^\(?(?:x86(?:_64)?|x64|amd64|arm64|aarch64|armhf|armv7|i386|i686|ppc64le|s390x|riscv64|mips64|wasm(?:32|64)?)\)?$/i.test(input)) return true;
            if (!/^FAQ$/i.test(input) && /^[A-Z0-9][A-Z0-9._+-]{1,24}$/.test(input)) return true;
            if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(input)
                || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(input)
                || /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(input)
                || /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}$/.test(input)) {
                return true;
            }
            if (isLink && /^[A-Z]$/.test(input)) return true;
        }

        if (/^(?:[A-Z][a-z]+ )+\([A-Z0-9]{2,}\)$/.test(input)) {
            return true;
        }

        if (normalizedWords.some((word) => sentenceWords.has(word) || tableProseWords.has(word))
            || /[,.:;!?()&/-]/.test(input)) {
            return false;
        }

        if (isTableLink && titleCaseWords.length === words.length && words.length <= 2) return true;
        if (isTableDataCell && titleCaseWords.length === words.length && words.length <= 2) return true;

        return false;
    }


    function isMostlyCjkText(text) {
        const input = String(text || '');
        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        const lowercaseLatinWords = (input.match(/\b[a-z]{2,}\b/g) || []).length;
        if (/、/.test(input) && lowercaseLatinWords === 0) return true;
        if (!cjkCount) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        const latinWords = (input.match(/[A-Za-z]{2,}/g) || []).length;
        const cjkPunctuation = (input.match(/[\u3000-\u303F\uFF01-\uFF5E]/g) || []).length;

        if (cjkCount >= 2 && lowercaseLatinWords === 0
            && !/^(?:Read|View|See|Open|Click|Switch|Use|Try|Get|Run|Add|Set)\b/i.test(input.trim())) {
            return true;
        }
        if (cjkCount >= 3 && cjkPunctuation > 0 && cjkCount >= lowercaseLatinWords * 2) return true;
        if (cjkCount >= 3 && lowercaseLatinWords <= 1
            && !/^(?:Read|View|See|Open|Click|Switch|Use|Try|Get|Run|Add|Set)\b/i.test(input.trim())) {
            return true;
        }

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
