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
        // 模型通常会原样返回，不能因此把 README 判为部分完成。
        if (/^[a-z][a-z0-9_-]{1,24}$/.test(input) && element?.closest('li, dt, table')) {
            return true;
        }

        // 有些 README 会把命令放在普通 p/div/span 中，不能只依赖 pre/code 标签判断。
        if (/^(?:[$>#]\s*)?(?:npm|pnpm|yarn|bun|node|python(?:3)?|pip(?:3)?|uv|go|cargo|docker(?:\s+compose)?|podman|kubectl|helm|git|gh|curl|wget|make|cmake|brew|apt(?:-get)?|apk|dnf|yum|ssh|chmod|chown|mkdir|cd|export|set)\b(?:\s|$)/i.test(input)
            || /^(?:\.\.?[\\/]|[A-Za-z]:[\\/])/.test(input)) {
            return true;
        }
        if (input.length > 120) return false;
        if (isLikelyOpaqueReadmeLabel(input, node)) return true;

        // 版本号、文件名和纯标识符通常不需要翻译；它们保持原文时不应把整篇 README 判为部分完成。
        if (/^[a-z]+\s+(?:version\s+)?v?\d+(?:\.\d+)+(?:[+._-][A-Za-z0-9]+)?[.!]?$/i.test(input)) {
            return true;
        }
        return false;
    }

    function isLikelyOpaqueReadmeLabel(text, node = null) {
        const input = String(text || '').trim();
        if (!input || input.length > 120 || /[\u3400-\u9FFF]/.test(input)) return false;

        const words = input.split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 8) return false;

        const element = node?.parentElement;
        const isLink = Boolean(element?.closest('a[href]'));
        const isListLabel = Boolean(element?.closest('li, dt, code'));
        const isHeading = Boolean(element?.closest('h1, h2, h3, h4, h5, h6'));
        const isTableLink = isLink && Boolean(element?.closest('table'));
        const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9]*$/.test(word));
        if (isTableLink && titleCaseWords.length === words.length) return true;

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
        if (normalizedWords.some((word) => sentenceWords.has(word))
            && !/\([A-Z0-9]{2,}\)/.test(input)) return false;

        if (isHeading && words.length >= 2 && document.title.includes(input)) {
            return true;
        }
        const hasOpaquePattern = /[0-9_./+#@:-]/.test(input)
            || /[a-z][A-Z]/.test(input)
            || /\([A-Z0-9]{2,}\)/.test(input)
            || words.some((word) => /^[A-Z0-9]{2,}$/.test(word));
        if (hasOpaquePattern) return true;

        if ((isLink || isListLabel)
            && titleCaseWords.length === words.length
            && (words.some((word) => word.length > 2) || (isLink && words.length === 1 && !sentenceWords.has(normalizedWords[0])))) {
            return true;
        }

        // 外部链接中的单一标识通常是包名/库名/平台名（如 boto、X），而不是自然语言句子。
        return isLink && words.length === 1 && !sentenceWords.has(normalizedWords[0]) && /^[A-Za-z0-9-]+$/.test(input);
    }


    function isMostlyCjkText(text) {
        const input = String(text || '');
        const cjkCount = (input.match(/[\u3400-\u9FFF]/g) || []).length;
        if (!cjkCount) return false;

        const latinCount = (input.match(/[A-Za-z]/g) || []).length;
        if (!latinCount) return true;

        const latinWords = (input.match(/[A-Za-z]{2,}/g) || []).length;
        const cjkPunctuation = (input.match(/[\u3000-\u303F\uFF01-\uFF5E]/g) || []).length;

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
