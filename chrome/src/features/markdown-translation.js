/**
 * @file chrome/src/features/markdown-translation.js
 * README 与 About 描述翻译：DOM 任务提取、渐进式打字机渲染、调试上下文与还原
 */

    function isRepositoryPage() {
        return (typeof pageConfig.currentPageType === 'string' && pageConfig.currentPageType.startsWith('repository'))
            || Boolean(getCurrentRepoInfo());
    }

    function isReadmePage() {
        const pageType = pageConfig.currentPageType;
        if (pageType === 'repository'
            || pageType === 'repository/tree'
            || pageType === 'repository/blob') {
            return true;
        }

        // GitHub Turbo/React 页面类型偶尔会短暂带有未知后缀；只要当前是仓库页
        // 且实际存在 README 根节点，就继续处理，避免 About 能翻译而 README 被跳过。
        return isRepositoryPage() && Boolean(getReadmeRootElement());
    }

    function isReadmeTranslationEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_readme_translation && isReadmePage();
    }

    function isRepoAboutTranslationEnabled() {
        return FeatureSet.enable_extension
            && FeatureSet.enable_readme_translation
            && (isRepositoryPage() || Boolean(getRepoAboutElement()));
    }

    function getReadmeRootElement() {
        for (const selector of README_CONFIG.ROOT_SELECTORS) {
            const elements = typeof document.querySelectorAll === 'function'
                ? document.querySelectorAll(selector)
                : [document.querySelector(selector)].filter(Boolean);
            for (const element of elements) {
                if (!element) continue;
                if (element.closest?.('[data-ghcn-chinese-readme]')) continue;
                // 避免在议题/PR 等页面误选普通 markdown 正文
                if (element.closest?.('.js-comment-body, [data-testid="markdown-body"], .comment-body')) {
                    continue;
                }

                return element;
            }
        }

        return null;
    }

    // 仓库侧栏 About 描述（兼容经典 UI、SidebarAbout CSS-module 和 BorderGrid 哈希类）。
    // 属仓库主自定义的自由文本，静态词库无法收录，故与 README 一样走 AI 内容翻译、就地替换。
    function getRepoAboutElements() {
        const elements = [];
        README_CONFIG.ABOUT_SELECTORS.forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                if (elements.includes(element)) return;
                if (element.closest('.js-comment-body, [data-testid="markdown-body"], .comment-body')) return;
                elements.push(element);
            });
        });
        return elements;
    }

    function getRepoAboutElement() {
        return getRepoAboutElements()[0] || null;
    }

    async function translateRepoAboutDescription(debugContext = null, reason = 'unknown') {
        const providerConfig = getProviderConfig();
        const aboutElements = getRepoAboutElements();
        if (!aboutElements.length) return 0;
        addReadmeDebugEvent(debugContext, 'about_start', { elementCount: aboutElements.length });
        if (!providerConfig.ok) {
            warnReadmeConfig(`About 描述未翻译：${providerConfig.message}`);
            addReadmeDebugEvent(debugContext, 'about_skipped', { reason: providerConfig.message });
            return 0;
        }

        const startAt = performance.now();
        const expectedHref = window.location.href;
        const runEpoch = readmeRuntime.runEpoch || 0;
        const initialAboutEnabled = Boolean(FeatureSet.enable_readme_translation);
        const isAboutRunValid = () => (readmeRuntime.runEpoch || 0) === runEpoch
            && FeatureSet.enable_extension
            && (!initialAboutEnabled || FeatureSet.enable_readme_translation)
            && window.location.href === expectedHref
            && aboutElements.some((el) => el.isConnected);

        const repoInfo = getCurrentRepoInfo();
        const elementsWithTasks = [];

        for (const aboutEl of aboutElements) {
            const tasks = collectReadmeTextTasks(aboutEl)
                .filter((task) => !isLikelyOpaqueReadmeLabel(task.normalizedText, task.node))
                .filter((task) => !isLikelyTechnicalReadmeText(task.normalizedText, task.node));
            if (tasks.length) {
                elementsWithTasks.push({ aboutEl, tasks });
            }
        }

        if (!elementsWithTasks.length) {
            addReadmeDebugEvent(debugContext, 'about_end', { translatedCount: 0, skipped: 'already_translated' });
            return 0;
        }

        const allTasks = elementsWithTasks.flatMap((item) => item.tasks);
        const uniqueTexts = [...new Set(allTasks.map((task) => task.normalizedText))];
        const sourceHash = createHash(uniqueTexts.join('||'));
        const signature = providerConfig.signature;
        const cacheKey = repoInfo && sourceHash && signature
            ? `about:${repoInfo.fullName}|${sourceHash}|${signature}`
            : '';

        let translatedCount = 0;
        let totalTokens = 0;

        if (cacheKey) {
            const cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true }).catch((error) => {
                if (isExtensionContextInvalidatedError(error)) throw error;
                return null;
            });
            if (!isAboutRunValid()) return 0;
            if (cached?.translatedHtml) {
                try {
                    const cachedData = JSON.parse(cached.translatedHtml);
                    if (cachedData?.translations && typeof cachedData.translations === 'object') {
                        hydrateReadmePreservedCache(signature, cached.preservedTexts);
                        const translatedMap = new Map(Object.entries(cachedData.translations));
                        for (const { aboutEl, tasks } of elementsWithTasks) {
                            if (!aboutEl.isConnected) continue;
                            const tasksByText = new Map();
                            tasks.forEach((task) => {
                                if (!tasksByText.has(task.normalizedText)) {
                                    tasksByText.set(task.normalizedText, []);
                                }
                                tasksByText.get(task.normalizedText).push(task);
                            });
                            translatedCount += withReadmeDomMutationGuard(() =>
                                applyTextGroupTranslations(aboutEl, tasksByText, uniqueTexts, translatedMap));
                            aboutEl.setAttribute('data-ghcn-about-translated', 'true');
                        }

                        addReadmeDebugEvent(debugContext, 'about_end', { translatedCount, cacheHit: true });
                        await appendReadmeTranslationRecord({
                            sourceType: 'about',
                            status: 'cache_hit',
                            tokens: 0,
                            durationMs: performance.now() - startAt,
                            sourceHash,
                            detail: 'about_cache_hit',
                        }).catch((error) => {
                            if (!isExtensionContextInvalidatedError(error)) {
                                console.warn('[About翻译] 写入缓存记录失败:', error);
                            }
                        });

                        return translatedCount;
                    }
                } catch {
                    // JSON 解析失败则回退至常规翻译
                }
            }
        }

        if (!isAboutRunValid()) return 0;
        const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig, {
            debugContext,
            debugPhase: 'about',
        });
        totalTokens = tokens;
        if (!isAboutRunValid()) return 0;

        for (const { aboutEl, tasks } of elementsWithTasks) {
            if (!aboutEl.isConnected) continue;
            const tasksByText = new Map();
            tasks.forEach((task) => {
                if (!tasksByText.has(task.normalizedText)) {
                    tasksByText.set(task.normalizedText, []);
                }
                tasksByText.get(task.normalizedText).push(task);
            });
            translatedCount += withReadmeDomMutationGuard(() =>
                applyTextGroupTranslations(aboutEl, tasksByText, uniqueTexts, translatedMap));
            aboutEl.setAttribute('data-ghcn-about-translated', 'true');
        }

        const preservedAboutTexts = [];
        let unresolvedAboutCount = 0;
        allTasks.forEach((task) => {
            if (!task.node?.isConnected) return;
            const liveText = normalizeText(task.node.data || '');
            if (liveText !== task.normalizedText) return;
            if (readmeRuntime.preservedCache?.has(`${signature}|${task.normalizedText}`)) {
                if (!preservedAboutTexts.includes(task.normalizedText)) {
                    preservedAboutTexts.push(task.normalizedText);
                }
                return;
            }
            unresolvedAboutCount += 1;
        });
        const isAboutComplete = unresolvedAboutCount === 0;

        addReadmeDebugEvent(debugContext, 'about_end', { translatedCount });

        if (translatedCount > 0 || totalTokens > 0) {
            if (cacheKey && isAboutComplete) {
                const cachePayload = {
                    translations: Object.fromEntries(translatedMap),
                };
                await upsertRepoCachedTranslation(cacheKey, {
                    repo: repoInfo?.fullName || '',
                    sourceHash,
                    translatedHtml: JSON.stringify(cachePayload),
                    complete: true,
                    preservedTexts: preservedAboutTexts,
                }).catch((error) => {
                    if (!isExtensionContextInvalidatedError(error)) {
                        console.warn('[About翻译] 写入缓存失败:', error);
                    }
                });
            }

            await appendReadmeTranslationRecord({
                sourceType: 'about',
                status: isAboutComplete ? 'success' : 'partial',
                tokens: totalTokens,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: `about_translated_nodes=${translatedCount}`,
            }).catch((error) => {
                if (!isExtensionContextInvalidatedError(error)) {
                    console.warn('[About翻译] 写入翻译记录失败:', error);
                }
            });
        }

        return translatedCount;
    }

    function getReadmeElementState(readmeEl) {
        if (!readmeRuntime.stateByElement.has(readmeEl)) {
            readmeRuntime.stateByElement.set(readmeEl, {
                originalHtml: '',
                translatedHash: '',
                translatedTextHash: '',
                translatedSignature: '',
            });
        }

        return readmeRuntime.stateByElement.get(readmeEl);
    }


    function buildProgressiveGroups(items, groupSize) {
        const values = Array.isArray(items) ? items : [];
        if (!values.length) return [];

        const size = Math.max(1, Number(groupSize) || 1);
        const groups = [];

        for (let index = 0; index < values.length; index += size) {
            groups.push(values.slice(index, index + size));
        }

        return groups;
    }

    function getReadmeTaskBlock(readmeEl, task) {
        const parent = task?.node?.parentElement;
        if (!parent) return readmeEl;

        const block = parent.closest(README_CONFIG.BLOCK_SELECTOR);
        return block && readmeEl.contains(block) ? block : parent;
    }

    function getTranslationTaskBlock(rootEl, task, blockSelector) {
        const parent = task?.node?.parentElement;
        if (!parent) return rootEl;

        const block = parent.closest(blockSelector);
        return block && rootEl.contains(block) ? block : parent;
    }

    function buildProgressiveTaskGroups(readmeEl, tasks, groupSize) {
        const blockMap = new Map();
        tasks.forEach((task) => {
            const block = getTranslationTaskBlock(readmeEl, task, README_CONFIG.BLOCK_SELECTOR);
            if (!blockMap.has(block)) {
                blockMap.set(block, []);
            }
            blockMap.get(block).push(task);
        });

        return buildProgressiveGroups([...blockMap.values()], groupSize)
            .map(group => group.flat());
    }

    function buildProgressiveTaskGroupsByBlock(rootEl, tasks, groupSize, blockSelector) {
        const blockMap = new Map();
        tasks.forEach((task) => {
            const block = getTranslationTaskBlock(rootEl, task, blockSelector);
            if (!blockMap.has(block)) {
                blockMap.set(block, []);
            }
            blockMap.get(block).push(task);
        });

        return buildProgressiveGroups([...blockMap.values()], groupSize)
            .map(group => group.flat());
    }


    function createReadmeDebugContext(reason) {
        if (!FeatureSet.readme_enable_debug) return null;

        return {
            runId: generateRecordId(),
            repo: getCurrentRepoInfo()?.fullName || 'unknown/unknown',
            reason: reason || 'unknown',
            provider: (FeatureSet.readme_provider || '').trim().toLowerCase(),
            createdAt: Date.now(),
            events: [],
        };
    }

    function sanitizeReadmeDebugText(text) {
        return truncateText(String(text || '')
            .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
            .replace(/(?:sk|gh[opsu]|xox[baprs])-?[A-Za-z0-9_-]{8,}/g, '[redacted]')
            .replace(/https?:\/\/[^\s)]+/gi, '[url]')
            .replace(/[\r\n\t]+/g, ' ')
            .trim(), README_CONFIG.DEBUG_TEXT_MAX_CHARS);
    }

    function describeReadmeDebugTask(task, rootEl) {
        const node = task?.node;
        const parent = node?.parentElement;
        const path = [];
        let current = parent;
        while (current && current !== rootEl && path.length < 5) {
            const tag = current.tagName?.toLowerCase() || 'element';
            const className = typeof current.className === 'string'
                ? current.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            path.unshift(className ? `${tag}.${className}` : tag);
            current = current.parentElement;
        }

        return {
            textHash: createHash(task?.normalizedText || ''),
            textPreview: sanitizeReadmeDebugText(task?.normalizedText),
            element: path.join(' > ') || 'unknown',
        };
    }

    function addReadmeDebugEvent(context, phase, detail = {}) {
        if (!context) return;

        const event = {
            at: Date.now(),
            ...detail,
            phase,
        };
        if (detail.status) context.status = detail.status;
        context.events.push(event);
        if (context.events.length > README_CONFIG.DEBUG_EVENT_MAX_ENTRIES) {
            context.events.splice(0, context.events.length - README_CONFIG.DEBUG_EVENT_MAX_ENTRIES);
        }
        console.debug('[README翻译调试]', context.runId, event);
    }

    async function flushReadmeDebugContext(context, status, summary = {}) {
        if (!context) return;

        const entry = {
            runId: context.runId,
            repo: context.repo,
            reason: context.reason,
            provider: context.provider,
            status: context.status || status,
            createdAt: context.createdAt,
            finishedAt: Date.now(),
            durationMs: Math.max(0, Date.now() - context.createdAt),
            summary,
            events: context.events,
        };

        try {
            const writeLogs = async () => {
                const existing = await getLocalValue(README_LOCAL_STORAGE_KEYS.DEBUG_LOGS, []);
                const logs = Array.isArray(existing) ? [...existing] : [];
                logs.push(entry);
                const sliced = logs.slice(-README_CONFIG.DEBUG_LOG_MAX_ENTRIES);
                const budgeted = typeof trimEntriesToByteBudget === 'function'
                    ? (() => {
                        const copy = [...sliced];
                        while (copy.length > 1 && estimateJsonUtf8Bytes(copy) > DEBUG_LOGS_MAX_BYTES) {
                            copy.shift();
                        }
                        return copy;
                    })()
                    : sliced;
                if (typeof setLocalValueWithQuotaRetry === 'function') {
                    await setLocalValueWithQuotaRetry(
                        README_LOCAL_STORAGE_KEYS.DEBUG_LOGS,
                        budgeted,
                        (list) => list.slice(-Math.max(1, Math.floor(list.length / 2))),
                    );
                } else {
                    await setLocalValue(README_LOCAL_STORAGE_KEYS.DEBUG_LOGS, budgeted);
                }
            };
            if (typeof enqueueLocalStorageWrite === 'function') {
                await enqueueLocalStorageWrite(writeLogs);
            } else {
                await writeLogs();
            }
        } catch (error) {
            if (!isExtensionContextInvalidatedError(error)) {
                console.warn('[README翻译调试] 保存调试日志失败:', error);
            }
        }
    }

    function pushReadmeDomMutationGuard() {
        readmeRuntime.domMutationGuardDepth += 1;
        readmeRuntime.isApplyingTranslation = true;
    }

    function popReadmeDomMutationGuard() {
        readmeRuntime.domMutationGuardDepth = Math.max(0, readmeRuntime.domMutationGuardDepth - 1);
        if (readmeRuntime.domMutationGuardDepth === 0) {
            window.setTimeout(() => {
                if (readmeRuntime.domMutationGuardDepth === 0) {
                    readmeRuntime.isApplyingTranslation = false;
                }
            }, 0);
        }
    }

    function withReadmeDomMutationGuard(callback) {
        pushReadmeDomMutationGuard();
        try {
            return callback();
        } finally {
            popReadmeDomMutationGuard();
        }
    }

    function refreshReadmeTextTaskNodes(rootEl, tasks) {
        if (!rootEl || !tasks.length) return tasks;

        const usedNodes = new Set();
        const resolved = tasks.map((task) => {
            const node = task?.node;
            const inRoot = typeof rootEl.contains !== 'function' || rootEl.contains(node);
            const matchesText = node && normalizeText(node.data || '') === task.normalizedText;
            if (node?.isConnected && inRoot && matchesText && !usedNodes.has(node)) {
                usedNodes.add(node);
                return task;
            }
            return null;
        });

        if (resolved.every(Boolean)) {
            return resolved;
        }

        const liveByText = new Map();
        collectReadmeTextTasks(rootEl)
            .filter((liveTask) => !isLikelyTechnicalReadmeText(liveTask.normalizedText, liveTask.node))
            .forEach((liveTask) => {
                if (!liveByText.has(liveTask.normalizedText)) {
                    liveByText.set(liveTask.normalizedText, []);
                }
                liveByText.get(liveTask.normalizedText).push(liveTask);
            });

        const refreshed = [];
        tasks.forEach((task, index) => {
            const existing = resolved[index];
            if (existing) {
                refreshed.push(existing);
                return;
            }

            const candidates = liveByText.get(task.normalizedText) || [];
            const replacement = candidates.find((candidate) => !usedNodes.has(candidate.node));
            if (replacement?.node) {
                usedNodes.add(replacement.node);
                refreshed.push(replacement);
            }
        });

        return refreshed;
    }

    function needsReadmeTranslation(text) {
        return !shouldSkipReadmeText(text);
    }

    function isUsableTranslation(sourceText, translatedText) {
        const translated = normalizeTranslationText(translatedText);
        return !!translated
            && !isObjectObjectArtifact(translated)
            && translated !== sourceText
            && needsReadmeTranslation(sourceText);
    }

    function applyTextGroupTranslations(rootEl, tasksByText, texts, translatedMap) {
        let translatedCount = 0;
        const translatableTasks = [];

        texts.forEach((text) => {
            const translated = normalizeTranslationText(translatedMap.get(text));
            if (!isUsableTranslation(text, translated)) return;
            (tasksByText.get(text) || []).forEach((task) => translatableTasks.push(task));
        });
        if (!translatableTasks.length) return 0;

        refreshReadmeTextTaskNodes(rootEl, translatableTasks).forEach((task) => {
            const translated = normalizeTranslationText(translatedMap.get(task.normalizedText));
            if (!isUsableTranslation(task.normalizedText, translated)) return;
            if (!task.node?.isConnected) return;
            task.node.data = task.rawText.replace(task.trimmedText, () => translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function sanitizeCachedHtmlTree(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;

        root.querySelectorAll('script, style, iframe, object, embed, form, base, meta, link, template, turbo-frame, turbo-stream')
            .forEach((node) => node.remove());

        const baseHref = typeof window !== 'undefined' && window.location?.href
            ? window.location.href
            : 'https://github.com/';
        const elements = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
        for (const el of elements) {
            if (el.attributes && typeof el.attributes[Symbol.iterator] === 'function') {
                for (const attr of [...el.attributes]) {
                    const attrName = String(attr.name || '').toLowerCase();
                    if (/^on/i.test(attrName)
                        || attrName === 'srcdoc'
                        || attrName === 'formaction'
                        || attrName.startsWith('data-turbo-')
                        || attrName === 'data-action'
                        || attrName === 'data-remote'
                        || attrName === 'data-method') {
                        el.removeAttribute(attr.name);
                    }
                }
            }

            for (const urlAttr of ['href', 'src', 'xlink:href', 'poster']) {
                if (!el.hasAttribute?.(urlAttr)) continue;
                const raw = String(el.getAttribute(urlAttr) || '').trim();
                if (!raw) {
                    el.removeAttribute(urlAttr);
                    continue;
                }
                if (raw.startsWith('#') && urlAttr === 'href') continue;
                try {
                    const resolved = new URL(raw, baseHref);
                    const allowedProtocols = urlAttr === 'href'
                        ? ['https:', 'http:', 'mailto:']
                        : ['https:', 'http:'];
                    if (!allowedProtocols.includes(resolved.protocol.toLowerCase())) {
                        el.removeAttribute(urlAttr);
                    }
                } catch {
                    el.removeAttribute(urlAttr);
                }
            }

            if (el.hasAttribute?.('srcset')) {
                const rawSrcset = String(el.getAttribute('srcset') || '');
                const parts = rawSrcset.split(',').map((part) => part.trim()).filter(Boolean);
                let validAll = parts.length > 0;
                for (const part of parts) {
                    const tokens = part.split(/\s+/);
                    if (tokens.length > 2 || !tokens[0]) {
                        validAll = false;
                        break;
                    }
                    try {
                        const resolved = new URL(tokens[0], baseHref);
                        if (!['https:', 'http:'].includes(resolved.protocol.toLowerCase())) {
                            validAll = false;
                            break;
                        }
                        if (tokens[1] && !/^(?:\d+w|\d+(?:\.\d+)?x)$/i.test(tokens[1])) {
                            validAll = false;
                            break;
                        }
                    } catch {
                        validAll = false;
                        break;
                    }
                }
                if (!validAll) {
                    el.removeAttribute('srcset');
                }
            }
        }
    }

    function replaceElementChildrenFromHtml(element, html) {
        const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
        sanitizeCachedHtmlTree(parsed.body);
        const nodes = Array.from(parsed.body.childNodes, node => document.importNode(node, true));
        element.replaceChildren(...nodes);
    }

    function applyReadmeHtml(readmeEl, html) {
        return withReadmeDomMutationGuard(() => {
            replaceElementChildrenFromHtml(readmeEl, html);
        });
    }

    function applyReadmeTextGroupTranslations(rootEl, tasksByText, texts, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTextGroupTranslations(rootEl, tasksByText, texts, translatedMap));
    }

    function applyTaskTranslations(rootEl, tasks, translatedMap) {
        let translatedCount = 0;

        refreshReadmeTextTaskNodes(rootEl, tasks).forEach((task) => {
            const translated = normalizeTranslationText(translatedMap.get(task.normalizedText));
            if (!isUsableTranslation(task.normalizedText, translated)) return;
            if (!task.node?.isConnected) return;

            task.node.data = task.rawText.replace(task.trimmedText, () => translated);
            translatedCount += 1;
        });

        return translatedCount;
    }

    function applyReadmeTaskTranslations(rootEl, tasks, translatedMap) {
        return withReadmeDomMutationGuard(() => applyTaskTranslations(rootEl, tasks, translatedMap));
    }

    async function waitForNextPaint() {
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
    }

    function restoreReadmeTranslation() {
        readmeRuntime.runEpoch = (readmeRuntime.runEpoch || 0) + 1;
        const readmeEl = getReadmeRootElement();
        if (!readmeEl) return;

        const state = getReadmeElementState(readmeEl);
        if (state.originalHtml && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        state.translatedHash = '';
        state.translatedTextHash = '';
        state.translatedSignature = '';
    }

    function scheduleReadmeTranslation(reason) {
        if (!FeatureSet.enable_extension) return;

        if (readmeRuntime.timerId) {
            window.clearTimeout(readmeRuntime.timerId);
        }

        readmeRuntime.timerId = window.setTimeout(() => {
            readmeRuntime.timerId = 0;
            runReadmeTranslation(reason).catch(err => {
                if (isExtensionContextInvalidatedError(err)) {
                    console.info('[README翻译] 插件上下文已失效（插件已更新或重载），请刷新当前 GitHub 页面后继续使用。');
                    return;
                }
                console.error('[README翻译] 执行失败:', err);
            });
        }, README_CONFIG.DEBOUNCE_MS);
    }

    async function runReadmeTranslation(reason) {
        const shouldTranslateReadme = isReadmeTranslationEnabled();
        const shouldPreferChinese = FeatureSet.enable_extension && FeatureSet.prefer_chinese_readme && isReadmePage();
        const shouldTranslateAbout = isRepoAboutTranslationEnabled();
        if (!shouldTranslateReadme && !shouldTranslateAbout && !shouldPreferChinese) {
            restoreChineseReadme();
            restoreReadmeTranslation();
            return;
        }

        if (readmeRuntime.inFlight) {
            readmeRuntime.rerunRequested = true;
            return;
        }

        const readmeEl = getReadmeRootElement();
        if (!readmeEl) restoreChineseReadme();
        if (!readmeEl && !getRepoAboutElement()) return;

        readmeRuntime.inFlight = true;
        const startAt = performance.now();
        const debugContext = createReadmeDebugContext(reason);
        let debugStatus = 'success';

        try {
            addReadmeDebugEvent(debugContext, 'run_start', {
                readmeEnabled: shouldTranslateReadme,
                aboutEnabled: shouldTranslateAbout,
            });
            // About 与 README 没有内容依赖，分别发起翻译请求；任一请求失败只告警，不影响另一部分。
            const translationTasks = [];
            if (shouldTranslateAbout) {
                translationTasks.push(translateRepoAboutDescription(debugContext, reason).catch((error) => {
                    if (isExtensionContextInvalidatedError(error)) {
                        readmeRuntime.rerunRequested = false;
                        return;
                    }
                    addReadmeDebugEvent(debugContext, 'about_failed', {
                        message: normalizeRuntimeErrorMessage(error),
                    });
                    console.warn('[About翻译] 执行失败:', error);
                }));
            }

            if ((shouldTranslateReadme || shouldPreferChinese) && readmeEl) {
                translationTasks.push((async () => {
                    if (await preferChineseReadme()) {
                        addReadmeDebugEvent(debugContext, 'readme_skipped', {
                            reason: (typeof chineseReadme !== 'undefined' && chineseReadme?.state?.root === readmeEl)
                                ? 'native_chinese_readme'
                                : 'waiting_react_hydration',
                        });
                        return;
                    }
                    if (shouldTranslateReadme && FeatureSet.enable_extension && readmeEl.isConnected
                        && readmeEl === getReadmeRootElement() && isReadmePage()) await translateReadmeElement(readmeEl, reason, debugContext);
                })());
            }

            await Promise.all(translationTasks);
        } catch (error) {
            debugStatus = 'failed';
            if (isExtensionContextInvalidatedError(error)) {
                readmeRuntime.rerunRequested = false;
                throw error;
            }
            addReadmeDebugEvent(debugContext, 'run_failed', {
                message: normalizeRuntimeErrorMessage(error),
            });
            const sourceHash = readmeEl
                ? getStableReadmeTextHash(getReadmeElementState(readmeEl).originalHtml || readmeEl.innerHTML || '')
                : '';
            await appendReadmeTranslationRecord({
                sourceType: 'readme',
                status: 'failed',
                tokens: 0,
                durationMs: performance.now() - startAt,
                sourceHash,
                detail: normalizeRuntimeErrorMessage(error),
            }).catch((recordError) => {
                if (!isExtensionContextInvalidatedError(recordError)) {
                    console.warn('[README翻译] 记录失败日志时出错:', recordError);
                }
            });
            throw error;
        } finally {
            addReadmeDebugEvent(debugContext, 'run_end', {
                durationMs: Math.max(0, performance.now() - startAt),
            });
            await flushReadmeDebugContext(debugContext, debugStatus, {
                durationMs: Math.max(0, performance.now() - startAt),
            });
            readmeRuntime.inFlight = false;
            if (readmeRuntime.rerunRequested) {
                readmeRuntime.rerunRequested = false;
                scheduleReadmeTranslation('rerun');
            }
        }
    }

    async function translateReadmeElement(readmeEl, reason, debugContext = null) {
        const startAt = performance.now();
        const expectedHref = window.location.href;
        const initialReadmeEnabled = Boolean(FeatureSet.enable_readme_translation);
        const runEpoch = readmeRuntime.runEpoch || 0;
        const isRunValid = () => (readmeRuntime.runEpoch || 0) === runEpoch
            && (typeof isPageExcluded !== 'function' || FeatureSet.enable_extension)
            && (!initialReadmeEnabled || FeatureSet.enable_readme_translation)
            && readmeEl.isConnected
            && window.location.href === expectedHref;
        const state = getReadmeElementState(readmeEl);
        const currentHash = createHash(readmeEl.innerHTML);
        const currentTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

        if (state.translatedHash && currentHash !== state.translatedHash) {
            if (state.translatedTextHash && currentTextHash === state.translatedTextHash) {
                // GitHub/React 只重建了等价 HTML（属性、节点包装或空白变化），保留翻译基线，
                // 避免把稳定的本地翻译误判成新内容并再次请求接口。
                state.translatedHash = currentHash;
            } else {
                // README 被重新渲染为新的文本内容时，才重置翻译状态。
                state.originalHtml = readmeEl.innerHTML;
                state.translatedHash = '';
                state.translatedTextHash = '';
                state.translatedSignature = '';
            }
        } else if (!state.originalHtml) {
            state.originalHtml = readmeEl.innerHTML;
        }

        const providerConfig = getProviderConfig();
        if (!providerConfig.ok) {
            warnReadmeConfig(providerConfig.message);
            restoreReadmeTranslation();
            return;
        }

        const repoInfo = getCurrentRepoInfo();
        // 只根据 README 的可见文本生成内容指纹，忽略 GitHub React 动态属性和节点包装变化。
        // 这样刷新/软导航时可以命中本地仓库缓存，不会因 HTML 外壳变化重复调用接口。
        const sourceHash = getStableReadmeTextHash(state.originalHtml);
        const signature = createHash(`${providerConfig.signature}\n${sourceHash}`);
        addReadmeDebugEvent(debugContext, 'readme_start', {
            reason: reason || 'unknown',
            sourceHash,
            htmlLength: state.originalHtml.length,
        });
        if (state.translatedSignature === signature && currentHash === state.translatedHash) {
            addReadmeDebugEvent(debugContext, 'readme_skipped', { reason: 'already_translated' });
            return;
        }

        const sourceBody = typeof parseInertHtmlBody === 'function'
            ? parseInertHtmlBody(state.originalHtml)
            : readmeEl;
        const sourceText = normalizeText(sourceBody.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            if (readmeEl.innerHTML !== state.originalHtml) {
                applyReadmeHtml(readmeEl, state.originalHtml);
            }

            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
            return;
        }

        const repoCacheKey = buildRepoCacheKey(repoInfo, sourceHash, providerConfig.signature);
        // 兼容 2.5.9 之前按原始 HTML 建立的缓存；命中后会在下方迁移为稳定文本指纹。
        const legacyRepoCacheKey = buildRepoCacheKey(
            repoInfo,
            createHash(state.originalHtml),
            providerConfig.signature,
        );
        let cacheKeyUsed = repoCacheKey;
        let cacheHit = await getRepoCachedTranslation(repoCacheKey).catch((error) => {
            if (isExtensionContextInvalidatedError(error)) throw error;
            console.warn('[README翻译] 读取仓库缓存失败:', error);
            return null;
        });
        if (!isRunValid()) return;
        if (!cacheHit && legacyRepoCacheKey && legacyRepoCacheKey !== repoCacheKey) {
            cacheHit = await getRepoCachedTranslation(legacyRepoCacheKey).catch((error) => {
                if (isExtensionContextInvalidatedError(error)) throw error;
                console.warn('[README翻译] 读取旧版仓库缓存失败:', error);
                return null;
            });
            if (!isRunValid()) return;
            if (cacheHit) cacheKeyUsed = legacyRepoCacheKey;
        }

        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[README翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                applyReadmeHtml(readmeEl, cacheHit.translatedHtml);
                hydrateReadmePreservedCache(providerConfig.signature, cacheHit.preservedTexts);
                const cachedRemaining = cacheHit.complete === true
                    ? []
                    : collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                        .filter((task) => task.node?.isConnected);
                if (!cachedRemaining.length) {
                    state.translatedSignature = signature;
                    state.translatedHash = createHash(readmeEl.innerHTML);
                    state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

                    await appendReadmeTranslationRecord({
                        sourceType: 'readme',
                        status: 'cache_hit',
                        tokens: 0,
                        durationMs: performance.now() - startAt,
                        sourceHash,
                        detail: `cache_reason=${reason || 'unknown'}`,
                    }).catch((error) => {
                        if (!isExtensionContextInvalidatedError(error)) {
                            console.warn('[README翻译] 写入缓存命中记录失败:', error);
                        }
                    });
                    addReadmeDebugEvent(debugContext, 'cache_hit', {
                        cacheKey: cacheKeyUsed,
                        stableCacheKey: repoCacheKey,
                        migrated: cacheKeyUsed !== repoCacheKey,
                        htmlLength: cacheHit.translatedHtml.length,
                        complete: true,
                    });
                    if (cacheKeyUsed !== repoCacheKey || cacheHit.complete !== true) {
                        const preservedTexts = collectReadmePreservedTexts(readmeEl, providerConfig.signature);
                        await upsertRepoCachedTranslation(repoCacheKey, {
                            repo: repoInfo?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                            preservedTexts: preservedTexts.length ? preservedTexts : cacheHit.preservedTexts,
                        }).catch((error) => {
                            if (!isExtensionContextInvalidatedError(error)) {
                                console.warn('[README翻译] 迁移/补全仓库缓存失败:', error);
                            }
                        });
                    }
                    return;
                }

                partialCacheApplied = true;
                addReadmeDebugEvent(debugContext, 'partial_cache_hit', {
                    cacheKey: cacheKeyUsed,
                    stableCacheKey: repoCacheKey,
                    migrated: cacheKeyUsed !== repoCacheKey,
                    remaining: cachedRemaining.length,
                    htmlLength: cacheHit.translatedHtml.length,
                });
            }
        }

        let translatedCount = 0;
        let totalTokens = 0;
        let retryMissedCount = 0;

        if (!partialCacheApplied && readmeEl.innerHTML !== state.originalHtml) {
            applyReadmeHtml(readmeEl, state.originalHtml);
        }

        const runTranslationPass = async (passName) => {
            if (!isRunValid()) return { translatedCount: 0, totalTokens: 0 };
            const tasks = (partialCacheApplied
                ? collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                : collectReadmeTextTasks(readmeEl))
                .filter((task) => !isLikelyOpaqueReadmeLabel(task.normalizedText, task.node))
                .filter((task) => !isLikelyTechnicalReadmeText(task.normalizedText, task.node));
            addReadmeDebugEvent(debugContext, 'pass_start', {
                pass: passName,
                taskCount: tasks.length,
                concurrency: README_CONFIG.TRANSLATION_CONCURRENCY,
                progressive: Boolean(FeatureSet.readme_enable_progressive),
                tasks: tasks.slice(0, 24).map((task) => describeReadmeDebugTask(task, readmeEl)),
            });
            if (!tasks.length) return { translatedCount: 0, totalTokens: 0 };

            const uniqueTexts = [...new Set(tasks.map(task => task.normalizedText))];
            const tasksByText = new Map();
            tasks.forEach((task) => {
                if (!tasksByText.has(task.normalizedText)) {
                    tasksByText.set(task.normalizedText, []);
                }
                tasksByText.get(task.normalizedText).push(task);
            });

            let passTranslatedCount = 0;
            let passTokens = 0;

            if (FeatureSet.readme_enable_progressive) {
                const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
                const groupSize = usesAiBatchLimits
                    ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                    : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
                const groups = buildProgressiveTaskGroups(readmeEl, tasks, groupSize);

                const groupResults = await mapWithConcurrency(
                    groups,
                    README_CONFIG.TRANSLATION_CONCURRENCY,
                    async (group, index) => {
                        if (!isRunValid()) {
                            return { applied: 0, tokens: 0 };
                        }
                        const groupTexts = [...new Set(group.map(task => task.normalizedText))];
                        const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(
                            groupTexts,
                            providerConfig,
                            { debugContext, debugPhase: passName, debugBatchIndex: index, concurrency: 1 },
                        );

                        // 软导航与开关防重入校验：若网络请求期间用户已跳转、关闭开关或节点已卸载，安全放弃本次 DOM 回填
                        if (!readmeEl.isConnected || window.location.href !== expectedHref || !isRunValid()) {
                            return { applied: 0, tokens: groupTokens };
                        }

                        const applied = applyReadmeTaskTranslations(readmeEl, group, translatedMap);
                        addReadmeDebugEvent(debugContext, 'group_applied', {
                            pass: passName,
                            batch: index,
                            requested: groupTexts.length,
                            applied,
                            tokens: groupTokens,
                        });
                        if (index < groups.length - 1 && isRunValid()) await waitForNextPaint();
                        return { applied, tokens: groupTokens };
                    },
                );
                groupResults.forEach(({ applied, tokens }) => {
                    passTokens += tokens;
                    passTranslatedCount += applied;
                });
            } else {
                const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(
                    uniqueTexts,
                    providerConfig,
                    { debugContext, debugPhase: passName, debugBatchIndex: 0 },
                );
                passTokens += tokens;

                if (!isRunValid()) {
                    return { translatedCount: 0, totalTokens: passTokens };
                }

                passTranslatedCount += applyReadmeTextGroupTranslations(readmeEl, tasksByText, uniqueTexts, translatedMap);
            }

            addReadmeDebugEvent(debugContext, 'pass_end', {
                pass: passName,
                translatedCount: passTranslatedCount,
                totalTokens: passTokens,
            });
            return { translatedCount: passTranslatedCount, totalTokens: passTokens };
        };

        const firstPass = await runTranslationPass('initial');
        translatedCount += firstPass.translatedCount;
        totalTokens += firstPass.totalTokens;

        if (!isRunValid()) {
            return;
        }

        // 补翻译：首轮后仍有未翻句子（渐进翻译期间 DOM 被 React 重渲染、或个别条目内容降级为原文），
        // 逐条重试收尾。以“无进展即停止 + 最多 maxRetryPasses 轮”双重保险避免空转。
        const maxRetryPasses = 2;
        for (let attempt = 0; attempt < maxRetryPasses; attempt += 1) {
            if (!isRunValid()) break;

            const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                .filter((task) => task.node?.isConnected);
            addReadmeDebugEvent(debugContext, 'retry_scan', {
                attempt,
                remaining: remainingTasks.length,
                tasks: remainingTasks.slice(0, 24).map((task) => describeReadmeDebugTask(task, readmeEl)),
            });
            if (!remainingTasks.length) break;
            if (attempt === 0) retryMissedCount = remainingTasks.length;

            const retryTexts = [...new Set(remainingTasks.map((task) => task.normalizedText))];
            const retryTasksByText = new Map();
            remainingTasks.forEach((task) => {
                if (!retryTasksByText.has(task.normalizedText)) {
                    retryTasksByText.set(task.normalizedText, []);
                }
                retryTasksByText.get(task.normalizedText).push(task);
            });

            if (!isRunValid()) break;
            const { translatedMap, totalTokens: retryTokens } = await translateTextsWithProvider(
                retryTexts,
                providerConfig,
                { preferSingleItem: true, debugContext, debugPhase: `retry_${attempt + 1}` },
            );
            totalTokens += retryTokens;

            if (!isRunValid()) break;

            const applied = applyReadmeTextGroupTranslations(readmeEl, retryTasksByText, retryTexts, translatedMap);
            translatedCount += applied;
            addReadmeDebugEvent(debugContext, 'retry_applied', {
                attempt,
                requested: retryTexts.length,
                applied,
                tokens: retryTokens,
            });
            if (!applied) break;
        }

        if (!isRunValid()) {
            return;
        }

        if (!translatedCount && !totalTokens && !partialCacheApplied
            && !collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
                .some((task) => task.node?.isConnected)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(readmeEl.innerHTML);
            state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);
            return;
        }

        const remainingTasks = collectReadmeUntranslatedTasks(readmeEl, state.originalHtml, providerConfig.signature)
            .filter((task) => task.node?.isConnected);
        const stillMissed = remainingTasks.length;
        addReadmeDebugEvent(debugContext, 'readme_end', {
            status: stillMissed ? 'partial' : 'success',
            translatedCount,
            retryMissedCount,
            remaining: stillMissed,
            remainingTasks: remainingTasks.slice(0, 24)
                .map((task) => describeReadmeDebugTask(task, readmeEl)),
        });
        state.translatedSignature = signature;
        state.translatedHash = createHash(readmeEl.innerHTML);
        state.translatedTextHash = getStableReadmeTextHash(readmeEl.innerHTML);

        if (!stillMissed || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(repoCacheKey, {
                repo: repoInfo?.fullName || '',
                sourceHash,
                translatedHtml: readmeEl.innerHTML,
                complete: !stillMissed,
                preservedTexts: collectReadmePreservedTexts(readmeEl, providerConfig.signature),
            }).catch((error) => {
                if (!isExtensionContextInvalidatedError(error)) {
                    console.warn('[README翻译] 写入仓库缓存失败:', error);
                }
            });
        }

        await appendReadmeTranslationRecord({
            sourceType: 'readme',
            status: stillMissed ? 'partial' : 'success',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `translated_nodes=${translatedCount};retry_missed=${retryMissedCount};remaining=${stillMissed}`,
        }).catch((error) => {
            if (!isExtensionContextInvalidatedError(error)) {
                console.warn('[README翻译] 写入翻译记录失败:', error);
            }
        });
    }

    function warnReadmeConfig(message) {
        const warnKey = `${FeatureSet.readme_provider}:${message}`;
        if (readmeRuntime.lastWarnKey === warnKey) return;

        readmeRuntime.lastWarnKey = warnKey;
        console.warn(`[README翻译] ${message}`);
    }

    function collectReadmeTextTasks(readmeEl) {
        const tasks = [];
        const showMask = (NodeFilter.SHOW_ELEMENT || 1) | NodeFilter.SHOW_TEXT;
        const walker = document.createTreeWalker(readmeEl, showMask, {
            acceptNode(node) {
                if (node.nodeType === 1) {
                    return node.matches?.(README_CONFIG.SKIP_PARENT_SELECTOR)
                        ? (NodeFilter.FILTER_REJECT || 2)
                        : (NodeFilter.FILTER_ACCEPT || 1);
                }
                return (NodeFilter.FILTER_ACCEPT || 1);
            },
        });

        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType !== 3) continue;
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest?.(README_CONFIG.SKIP_PARENT_SELECTOR)) continue;

            const rawText = node.data;
            const trimmedText = rawText.trim();
            const normalizedText = normalizeText(trimmedText);

            if (shouldSkipReadmeText(normalizedText)) continue;

            tasks.push({ node, rawText, trimmedText, normalizedText });
        }

        return tasks;
    }


    function collectReadmeOriginalTextCounts(originalHtml) {
        const container = typeof parseInertHtmlBody === 'function'
            ? parseInertHtmlBody(originalHtml)
            : (() => {
                const div = document.createElement('div');
                div.innerHTML = String(originalHtml || '');
                return div;
            })();
        const counts = new Map();

        collectReadmeTextTasks(container).forEach((task) => {
            if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return;
            counts.set(task.normalizedText, (counts.get(task.normalizedText) || 0) + 1);
        });
        return counts;
    }

    function hydrateReadmePreservedCache(providerSignature, preservedTexts) {
        if (!providerSignature || !Array.isArray(preservedTexts) || !readmeRuntime.preservedCache) return;

        preservedTexts.forEach((item) => {
            if (typeof item !== 'string') return;
            const normalized = normalizeText(item);
            if (!normalized) return;
            readmeRuntime.preservedCache.add(`${providerSignature}|${normalized}`);
        });
    }

    function collectReadmePreservedTexts(readmeEl, providerSignature) {
        if (!readmeEl || !providerSignature || !readmeRuntime.preservedCache?.size) return [];

        const seen = new Set();
        const preservedTexts = [];
        collectReadmeTextTasks(readmeEl).forEach((task) => {
            if (!readmeRuntime.preservedCache.has(`${providerSignature}|${task.normalizedText}`)) return;
            if (seen.has(task.normalizedText)) return;
            seen.add(task.normalizedText);
            preservedTexts.push(task.normalizedText);
        });
        return preservedTexts;
    }

    function collectReadmeUntranslatedTasks(readmeEl, originalHtml, providerSignature = '') {
        const originalCounts = collectReadmeOriginalTextCounts(originalHtml);
        return collectReadmeTextTasks(readmeEl)
            .filter((task) => {
                if (isLikelyTechnicalReadmeText(task.normalizedText, task.node)) return false;
                if (providerSignature && readmeRuntime.preservedCache?.has(`${providerSignature}|${task.normalizedText}`)) {
                    return false;
                }
                const remaining = originalCounts.get(task.normalizedText) || 0;
                if (!remaining) return false;

                originalCounts.set(task.normalizedText, remaining - 1);
                return true;
            });
    }

