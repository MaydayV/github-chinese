    let maintenanceData = { entries: [], excluded: [] };
    const uiMisses = new Map();
    let uiMissTimer = 0;
    let uiMissCapturedAt = 0;
    let customWrites = new WeakMap();
    function hasCustomWrite(node, field, text) {
        if (typeof text !== 'string') return false;
        const map = customWrites.get(node);
        if (!map) return false;
        return map.get(field === 'ariaLabel' ? 'aria-label' : field) === text;
    }
    function rememberCustomWrite(node, field, text) {
        const fields = customWrites.get(node) || new Map();
        fields.set(field === 'ariaLabel' ? 'aria-label' : field, text);
        customWrites.set(node, fields);
    }

    function isPageExcluded() {
        return maintenanceData.excluded.some(pattern => GhcnMaintenance.matches(pattern, window.location));
    }

    function applyCustomAttributes(node) {
        if (!maintenanceData.entries.length) return;
        for (const name of ['aria-label', 'placeholder', 'title']) {
            const text = node.getAttribute(name);
            if (!text) continue;
            if (hasCustomWrite(node, name, text)) continue;
            const normalized = GhcnMaintenance.normalize(text);
            const translated = GhcnMaintenance.lookup(maintenanceData.entries, normalized, window.location);
            if (translated && translated !== text) {
                rememberCustomWrite(node, name, translated);
                node.setAttribute(name, translated);
            }
        }
    }

    async function loadMaintenanceSettings() {
        try {
            const raw = await chrome.storage.local.get(GhcnMaintenance.DATA_KEY);
            maintenanceData = GhcnMaintenance.validateData(raw[GhcnMaintenance.DATA_KEY] || {});
        }
        catch (error) {
            const isInvalidated = typeof isExtensionContextInvalidatedError === 'function'
                ? isExtensionContextInvalidatedError(error)
                : /extension context invalidated|context invalidated|插件上下文已失效/i.test(String(error?.message || error || ''));
            if (!isInvalidated) console.warn('[词库维护] 已忽略无效配置', error.message);
        }
    }

    function recordUiMiss(rawText) {
        const publicMeta = typeof document !== 'undefined'
            ? document.querySelector?.('meta[name="octolytics-dimension-repository_public"]')
            : null;
        if (publicMeta && publicMeta.getAttribute('content') !== 'true') return;
        const text = GhcnMaintenance.normalize(rawText);
        if (!FeatureSet.collect_ui_misses || !FeatureSet.enable_extension
            || !GhcnMaintenance.collectable(text, window.location.pathname) || uiMisses.size >= 200) return;
        const page = pageConfig.currentPageType;
        if (!page) return;
        const key = page + '\n' + text;
        const row = uiMisses.get(key) || { page, text, count: 0 };
        row.count++;
        uiMisses.set(key, row);
        uiMissCapturedAt = Date.now();
        if (uiMissTimer) return;
        uiMissTimer = window.setTimeout(() => {
            uiMissTimer = 0;
            const rows = [...uiMisses.values()];
            const capturedAt = uiMissCapturedAt || Date.now();
            uiMissCapturedAt = 0;
            uiMisses.clear();
            try {
                chrome.runtime.sendMessage({ type: 'ghcn-ui-misses', rows, capturedAt }, () => {
                    if (chrome.runtime.lastError) console.info('[词库维护] 日志未保存，请刷新页面。');
                });
            } catch {
                console.info('[词库维护] 日志未保存，请刷新页面。');
            }
        }, 2000);
    }

    const chineseReadme = { state: null, pending: null, cache: new Map(), failures: new Map(), bypass: new WeakMap() };

    function getDocumentUrlWithoutHash() {
        const href = String(window?.location?.href || '');
        if (!href) return '';
        if (typeof URL === 'function') {
            try {
                const parsed = new URL(href);
                parsed.hash = '';
                return parsed.href;
            } catch { /* 忽略非法 URL */ }
        }
        return href.split('#')[0];
    }

    function runWithReadmeMutationGuard(fn) {
        if (typeof withReadmeDomMutationGuard === 'function') {
            return withReadmeDomMutationGuard(fn);
        }
        return fn();
    }

    function restoreChineseReadme() {
        const state = chineseReadme.state;
        if (!state) return;
        runWithReadmeMutationGuard(() => {
            state.root.hidden = state.hidden;
            state.copy.remove();
            state.controls.remove();
            chineseReadme.state = null;
        });
    }

    function isAlreadyChineseReadme(root) {
        if (!root) return false;
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(root) : null;
        const clone = (state?.originalHtml && typeof parseInertHtmlBody === 'function')
            ? parseInertHtmlBody(state.originalHtml)
            : (typeof root.cloneNode === 'function' ? root.cloneNode(true) : root);
        clone.querySelectorAll?.('pre, code, kbd, samp, script, style, svg, math').forEach(node => node.remove());
        const text = String(clone.textContent || '').trim();
        const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjkCount < 20) return false;
        const latinWords = (text.match(/[A-Za-z]{2,}/g) || []).length;
        return cjkCount >= latinWords * 1.5;
    }

    function detectRepoBranchName(repoPrefix) {
        const refNode = document.querySelector?.(
            '#branch-picker-repos-header-ref-selector [data-component="text"], #branch-picker-repos-header-ref-selector .css-truncate-target, [data-hotkey="w"] [data-component="text"]',
        );
        const direct = refNode?.textContent?.trim();
        if (direct && !direct.includes('\n')) return direct;
        const escapedPrefix = repoPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linkRe = new RegExp(`^${escapedPrefix}/(?:edit|blob)/(.+)/readme(?:[._-][^/]+)?$`, 'i');
        for (const link of document.querySelectorAll?.('a[href*="/blob/"], a[href*="/edit/"]') || []) {
            try {
                const url = new URL(link.getAttribute('href') || '', window.location.href);
                const path = decodeURIComponent(url.pathname);
                const match = path.match(linkRe);
                if (match?.[1]) return match[1];
            } catch { /* 忽略非法链接。 */ }
        }
        return '';
    }

    function findChineseReadmeCandidates(root) {
        const repo = getCurrentRepoInfo();
        if (!repo || window.location.hostname !== 'github.com') return [];
        if (isAlreadyChineseReadme(root)) return [];

        let currentPath;
        try {
            currentPath = decodeURIComponent(window.location.pathname);
        } catch {
            currentPath = window.location.pathname;
        }
        currentPath = currentPath.length > 1 ? currentPath.replace(/\/+$/, '') : currentPath;
        const lowerPath = currentPath.toLowerCase();
        const repoPrefix = '/' + repo.fullName;

        let mode = '';
        let blobPrefix = '';
        let detectedBranchLower = '';
        if (lowerPath === repoPrefix) {
            mode = 'repo';
            blobPrefix = repoPrefix + '/blob/';
            detectedBranchLower = detectRepoBranchName(repoPrefix).toLowerCase();
        } else if (lowerPath.startsWith(repoPrefix + '/tree/')) {
            const treeTail = currentPath.slice((repoPrefix + '/tree/').length);
            if (!treeTail) return [];
            mode = 'tree';
            blobPrefix = repoPrefix + '/blob/' + treeTail.toLowerCase() + '/';
        } else if (lowerPath.startsWith(repoPrefix + '/blob/')) {
            const blobTail = currentPath.slice((repoPrefix + '/blob/').length);
            const lastSlash = blobTail.lastIndexOf('/');
            if (lastSlash < 1) return [];
            const blobDir = blobTail.slice(0, lastSlash);
            const filename = blobTail.slice(lastSlash + 1);
            if (!/^readme(?:[._-](?:en(?:[._-]?(?:us|gb))?|english))?(?:\.(?:md|markdown|rst|txt))?$/i.test(filename)) {
                return [];
            }
            if (/(?:^|\/)(?:zh(?:[._-]?(?:cn|hans|tw|hant))?|cn|中文)$/i.test(blobDir)) {
                return [];
            }
            mode = 'blob';
            blobPrefix = currentPath.slice(0, currentPath.lastIndexOf('/') + 1).toLowerCase();
        } else {
            return [];
        }

        const subprojectDirRe = /^(?:packages|examples|apps|crates|plugins|modules|services|demos|samples|templates|tests?|benchmarks?)\//i;
        const chineseReadmeRe = /(?:\/readme[._-](?:zh(?:[._-]?(?:cn|hans|tw|hant))?|cn|中文)\.(?:md|markdown|rst)|\/(?:zh-cn|zh_cn|zh|cn)\/readme\.(?:md|markdown|rst))$/i;
        const rootLinks = [...root.querySelectorAll('a[href]')].map(link => ({ link, fromRoot: true }));
        const rootSet = new Set(rootLinks.map(item => item.link));
        const extraLinks = [...document.querySelectorAll('a[href*="readme" i]')]
            .filter(link => !rootSet.has(link))
            .map(link => ({ link, fromRoot: false }));
        const seen = new Map();

        for (const { link, fromRoot } of [...rootLinks, ...extraLinks]) {
            try {
                const href = link.getAttribute('href');
                if (!href) continue;
                const url = new URL(href, window.location.href);
                const path = decodeURIComponent(url.pathname);
                if (url.origin !== window.location.origin || !path.toLowerCase().startsWith(blobPrefix)) continue;
                if (!chineseReadmeRe.test(path)) continue;
                let rel;
                if (mode === 'repo') {
                    const afterBlob = path.slice(blobPrefix.length);
                    if (detectedBranchLower && afterBlob.toLowerCase().startsWith(detectedBranchLower + '/')) {
                        rel = afterBlob.slice(detectedBranchLower.length + 1);
                    } else {
                        const slashIndex = afterBlob.indexOf('/');
                        if (slashIndex <= 0) continue;
                        rel = afterBlob.slice(slashIndex + 1);
                    }
                } else {
                    rel = path.slice(blobPrefix.length);
                }
                if (!rel || subprojectDirRe.test(rel)) continue;
                if (!fromRoot && rel.includes('/') && !/^(?:zh-cn|zh_cn|zh|cn)\/readme\./i.test(rel)) continue;
                url.search = ''; url.hash = '';
                if (url.pathname === window.location.pathname) continue;
                const existing = seen.get(url.href);
                if (!existing || (fromRoot && !existing.fromRoot)) {
                    seen.set(url.href, { href: url.href, rel, fromRoot });
                }
            } catch { /* 非 URL 链接忽略。 */ }
        }
        return [...seen.values()].sort((a, b) => {
            const tradDiff = Number(/(?:tw|hant)/i.test(a.rel)) - Number(/(?:tw|hant)/i.test(b.rel));
            if (tradDiff !== 0) return tradDiff;
            const depthDiff = a.rel.split('/').length - b.rel.split('/').length;
            if (depthDiff !== 0) return depthDiff;
            return Number(b.fromRoot) - Number(a.fromRoot);
        }).map(item => item.href);
    }

    function findChineseReadme(root) {
        return findChineseReadmeCandidates(root)[0] || null;
    }

    function sanitizeChineseReadme(article, base) {
        const copy = document.importNode(article, true);
        copy.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,button,link,meta,base,svg,math,template,turbo-frame,turbo-stream').forEach(node => node.remove());
        const usedIds = new Set();
        const idMap = new Map();
        const assignSafeId = (rawId) => {
            const trimmed = String(rawId || '').trim();
            if (!trimmed || trimmed.length > 200 || /[\s\u0000-\u001f\u007f"'<>\\#?/]/.test(trimmed)) return '';
            const clean = trimmed.replace(/^user-content-/i, '') || trimmed;
            let candidate = `ghcn-cr-${clean}`;
            let suffix = 2;
            while (usedIds.has(candidate)) {
                candidate = `ghcn-cr-${clean}-${suffix++}`;
            }
            usedIds.add(candidate);
            idMap.set(trimmed, candidate);
            if (!idMap.has(clean)) idMap.set(clean, candidate);
            const lowerClean = clean.toLowerCase();
            if (!idMap.has(lowerClean)) idMap.set(lowerClean, candidate);
            return candidate;
        };
        const nodes = [copy, ...copy.querySelectorAll('*')];
        for (const node of nodes) {
            for (const attribute of [...node.attributes]) {
                const name = attribute.name;
                const lower = name.toLowerCase();
                if (/^on/i.test(name) || name.includes(':') || ['srcdoc', 'style', 'name'].includes(lower)
                    || /^data-(?:turbo(?:$|[-_])|action$|remote$|method$)/i.test(lower)) {
                    node.removeAttribute(name);
                }
            }
            if (node.hasAttribute('id')) {
                const mappedId = assignSafeId(node.getAttribute('id'));
                if (mappedId) node.setAttribute('id', mappedId);
                else node.removeAttribute('id');
            }
        }
        const resolveMappedFragment = (hashText) => {
            const fragment = hashText.startsWith('#') ? hashText.slice(1) : hashText;
            if (!fragment) return '';
            let decoded = fragment;
            try { decoded = decodeURIComponent(fragment); } catch {}
            const stripped = decoded.replace(/^user-content-/i, '');
            return idMap.get(fragment)
                || idMap.get(decoded)
                || idMap.get(stripped)
                || idMap.get(decoded.toLowerCase())
                || idMap.get(stripped.toLowerCase())
                || '';
        };
        const baseUrl = new URL(base);
        for (const node of nodes) {
            if (node.hasAttribute('href')) {
                const rawHref = String(node.getAttribute('href') || '').trim();
                if (rawHref.startsWith('#')) {
                    const mapped = resolveMappedFragment(rawHref);
                    if (mapped) node.setAttribute('href', `#${mapped}`);
                    else node.removeAttribute('href');
                } else {
                    try {
                        const url = new URL(rawHref, base);
                        if (url.origin === baseUrl.origin && url.pathname === baseUrl.pathname && url.hash) {
                            const mapped = resolveMappedFragment(url.hash);
                            if (mapped) {
                                node.setAttribute('href', `#${mapped}`);
                            } else if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
                                node.setAttribute('href', url.href);
                            } else {
                                node.removeAttribute('href');
                            }
                        } else if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
                            node.removeAttribute('href');
                        } else {
                            node.setAttribute('href', url.href);
                        }
                    } catch { node.removeAttribute('href'); }
                }
            }
            for (const attr of ['src', 'poster']) {
                if (!node.hasAttribute(attr)) continue;
                try {
                    const raw = node.getAttribute(attr);
                    const url = new URL(raw, base);
                    if (!['https:', 'http:'].includes(url.protocol)) node.removeAttribute(attr);
                    else node.setAttribute(attr, url.href);
                } catch { node.removeAttribute(attr); }
            }
            if (node.hasAttribute('srcset')) {
                const rawSrcset = String(node.getAttribute('srcset') || '');
                const parts = rawSrcset.split(',').map(part => part.trim()).filter(Boolean);
                const cleanParts = [];
                let validAll = parts.length > 0;
                for (const part of parts) {
                    const tokens = part.split(/\s+/);
                    if (tokens.length > 2 || !tokens[0]) { validAll = false; break; }
                    try {
                        const url = new URL(tokens[0], base);
                        if (!['https:', 'http:'].includes(url.protocol)) { validAll = false; break; }
                        if (tokens[1] && !/^(?:\d+w|\d+(?:\.\d+)?x)$/i.test(tokens[1])) { validAll = false; break; }
                        cleanParts.push(tokens[1] ? `${url.href} ${tokens[1]}` : url.href);
                    } catch {
                        validAll = false;
                        break;
                    }
                }
                if (validAll && cleanParts.length) node.setAttribute('srcset', cleanParts.join(', '));
                else node.removeAttribute('srcset');
            }
        }
        copy.dataset.ghcnChineseReadme = 'true';
        copy.setAttribute('translate', 'no');
        return copy;
    }

    async function preferChineseReadme() {
        const root = getReadmeRootElement();
        const currentDocUrl = getDocumentUrlWithoutHash();
        if (chineseReadme.state && (chineseReadme.state.root !== root || chineseReadme.state.pageUrl !== currentDocUrl || !FeatureSet.prefer_chinese_readme || !FeatureSet.enable_extension)) {
            restoreChineseReadme();
        }
        if (!root || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme || !isReadmePage() || chineseReadme.bypass.get(root) === currentDocUrl) return false;
        // 等 React 完成 hydration 再挂载；返回 true 暂缓 API，避免回退链路提前改 DOM。
        if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) return true;
        if (chineseReadme.state?.root === root && chineseReadme.state?.pageUrl === currentDocUrl) return true;
        const candidates = findChineseReadmeCandidates(root)
            .filter(candidate => Date.now() - (chineseReadme.failures.get(candidate) || 0) >= 300000);
        if (!candidates.length) return false;
        if (chineseReadme.pending) {
            if (chineseReadme.pending.pageUrl === currentDocUrl && chineseReadme.pending.root === root && candidates.includes(chineseReadme.pending.url)) {
                await chineseReadme.pending.promise;
                if (!root.isConnected || currentDocUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                    return false;
                }
                if (chineseReadme.state?.root === root && chineseReadme.state?.pageUrl === currentDocUrl) {
                    return true;
                }
                if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) {
                    return true;
                }
            } else {
                chineseReadme.pending.controller.abort();
            }
        }
        const remainingCandidates = candidates.filter(candidate => Date.now() - (chineseReadme.failures.get(candidate) || 0) >= 300000);
        for (const url of remainingCandidates) {
            const pageUrl = getDocumentUrlWithoutHash();
            if (!root.isConnected || pageUrl !== currentDocUrl || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) return false;
            const controller = new AbortController();
            const task = { url, pageUrl, root, controller, promise: null };
            task.promise = (async () => {
                let timedOut = false;
                try {
                    let cachedEntry = chineseReadme.cache.get(url);
                    if (typeof cachedEntry === 'string') {
                        cachedEntry = { html: cachedEntry, baseUrl: url };
                    }
                    let fetchedEntry = null;
                    if (!cachedEntry) {
                        const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
                        try {
                            const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
                            if (!response.ok || new URL(response.url || url).origin !== window.location.origin) return { ok: false, failed: true, aborted: false };
                            const html = await response.text();
                            if (html.length > 2000000) return { ok: false, failed: true, aborted: false };
                            fetchedEntry = { html, baseUrl: response.url || url };
                        } finally { window.clearTimeout(timeout); }
                    }
                    const entry = cachedEntry || fetchedEntry;
                    if (!root.isConnected || pageUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                        return { ok: false, failed: false, aborted: true };
                    }
                    const parsed = new DOMParser().parseFromString(entry.html, 'text/html');
                    const article = parsed.querySelector('article.markdown-body, [data-testid="readme"] .markdown-body');
                    if (!article || !/[\u4e00-\u9fff]/.test(article.textContent)) return { ok: false, failed: true, aborted: false };
                    if (fetchedEntry) {
                        if (chineseReadme.cache.size >= 10) chineseReadme.cache.delete(chineseReadme.cache.keys().next().value);
                        chineseReadme.cache.set(url, fetchedEntry);
                    }
                    const copy = sanitizeChineseReadme(article, entry.baseUrl || url);
                    if (!root.isConnected || pageUrl !== getDocumentUrlWithoutHash() || !FeatureSet.enable_extension || !FeatureSet.prefer_chinese_readme) {
                        return { ok: false, failed: false, aborted: true };
                    }
                    if (root.closest('react-app:not(.loaded), react-partial:not(.loaded)')) return { ok: true, failed: false, aborted: false };
                    if (typeof getReadmeElementState === 'function' && typeof restoreReadmeTranslation === 'function') {
                        const apiState = getReadmeElementState(root);
                        if (apiState?.translatedHash || (apiState?.originalHtml && root.innerHTML !== apiState.originalHtml)) {
                            restoreReadmeTranslation();
                        }
                    }
                    const controls = document.createElement('div');
                    controls.className = 'ghcn-native-readme mb-2 d-flex flex-items-center';
                    controls.setAttribute('translate', 'no');
                    const label = document.createElement('span'); label.textContent = '仓库已有中文 README · ';
                    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn btn-sm'; toggle.textContent = '查看原文';
                    const hidden = root.hidden;
                    controls.append(label, toggle);
                    toggle.addEventListener('click', () => {
                        runWithReadmeMutationGuard(() => {
                            copy.hidden = !copy.hidden; root.hidden = !copy.hidden;
                            toggle.textContent = copy.hidden ? '查看中文版' : '查看原文';
                        });
                    });
                    if (FeatureSet.enable_readme_translation) {
                        const api = document.createElement('button'); api.type = 'button'; api.className = 'btn btn-sm ml-2'; api.textContent = '改用 API 翻译';
                        api.addEventListener('click', () => { chineseReadme.bypass.set(root, pageUrl); restoreChineseReadme(); scheduleReadmeTranslation('native:api'); });
                        controls.append(api);
                    }
                    runWithReadmeMutationGuard(() => {
                        root.before(controls, copy); root.hidden = true;
                        chineseReadme.state = { root, hidden, copy, controls, pageUrl };
                    });
                    return { ok: true, failed: false, aborted: false };
                } catch (error) {
                    if (controller.signal.aborted && !timedOut) return { ok: false, failed: false, aborted: true };
                    console.info('[中文 README] 获取失败，回退原有流程：', error.message);
                    return { ok: false, failed: true, aborted: false };
                }
            })();
            chineseReadme.pending = task;
            try {
                const result = await task.promise;
                if (result.failed) {
                    if (chineseReadme.failures.size >= 20) chineseReadme.failures.clear();
                    chineseReadme.failures.set(url, Date.now());
                    continue;
                }
                if (result.aborted) return false;
                if (result.ok) return true;
            } finally {
                if (chineseReadme.pending === task) chineseReadme.pending = null;
            }
        }
        return false;
    }
