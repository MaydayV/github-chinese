/**
 * @file chrome/src/features/discussion-translation.js
 * Issue / PR / Release 讨论区双向翻译：工具条注入、双栏对照与 DOM 克隆
 */

    function isIssueOrPrDiscussionPage() {
        if (window.location.hostname !== 'github.com') return false;
        return /^\/[^/]+\/[^/]+\/(?:issues|pull|discussions)\/\d+(?:\/|$)/.test(window.location.pathname);
    }

    function isReleaseNotesPage() {
        if (window.location.hostname !== 'github.com') return false;

        const pathname = String(window.location.pathname || '');
        if (/^\/[^/]+\/[^/]+\/releases\/(?:new|edit)(?:\/|$)/.test(pathname)) return false;
        return /^\/[^/]+\/[^/]+\/releases(?:\/(?:tag\/[^/]+|latest))?(?:\/|$)/.test(pathname);
    }

    function isDiscussionTranslationTargetPage() {
        return isIssueOrPrDiscussionPage() || isReleaseNotesPage();
    }

    function isIssuePrTranslationEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_issue_pr_translation && isDiscussionTranslationTargetPage();
    }

    function getIssuePrRecordSourceType() {
        if (isReleaseNotesPage()) return 'release';

        const match = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\//);
        if (match?.[1] === 'issues') return 'issue';
        if (match?.[1] === 'pull') return 'pull';
        if (match?.[1] === 'discussions') return 'discussion';
        return 'issue';
    }

    function getDiscussionRecordSourceType(item) {
        return item?.sourceType || getIssuePrRecordSourceType();
    }

    function getIssuePrDiscussionState(item) {
        const keyEl = item?.markdownEl || item;
        if (!issuePrRuntime.stateByElement.has(keyEl)) {
            issuePrRuntime.stateByElement.set(keyEl, {
                originalHtml: '',
                translatedHash: '',
                translatedSignature: '',
                isBusy: false,
                translatedEl: null,
                toolbarEl: null,
                mode: 'original',
                errorMessage: '',
            });
        }

        return issuePrRuntime.stateByElement.get(keyEl);
    }

    function findDiscussionItems() {
        const seen = new Set();
        const isReleaseNotes = isReleaseNotesPage();
        const selectors = isReleaseNotes
            ? ISSUE_PR_CONFIG.RELEASE_BODY_SELECTORS
            : ISSUE_PR_CONFIG.COMMENT_BODY_SELECTORS;

        return [...document.querySelectorAll(selectors)]
            .map((markdownEl) => {
                if (!markdownEl || seen.has(markdownEl)) return null;
                seen.add(markdownEl);
                if (markdownEl.closest('.ghcn-discussion-translation-panel')) return null;

                if (!isReleaseNotes && markdownEl.parentElement?.closest('[data-testid="markdown-body"]')) {
                    return null;
                }

                const rootEl = isReleaseNotes
                    ? markdownEl.closest([
                        '[data-test-selector="release-card"]',
                        '[data-testid="release-card"]',
                        '.Box',
                        'section',
                        'article',
                    ].join(', '))
                    : markdownEl.closest([
                    '[data-testid="issue-body"]',
                    '[data-testid="comment-body"]',
                    '[data-testid^="comment-viewer-outer-box"]',
                    '.react-issue-comment',
                    '.timeline-comment-group',
                    '.timeline-comment',
                    '.js-comment',
                    '.js-timeline-item',
                    '.TimelineItem',
                    '.js-discussion',
                    '.js-quote-selection-container',
                ].join(', '));
                if (!rootEl) return null;

                const viewerEl = isReleaseNotes
                    ? (markdownEl.parentElement || markdownEl)
                    : markdownEl.closest([
                    '[data-testid="issue-body-viewer"]',
                    '[data-testid="comment-body-viewer"]',
                    '[class*="IssueCommentBody"]',
                    '.comment-body',
                    '.js-comment-body',
                ].join(', ')) || markdownEl.parentElement;
                if (!viewerEl) return null;

                const text = normalizeText(markdownEl.textContent || '');
                if (!text) return null;

                return {
                    rootEl,
                    viewerEl,
                    markdownEl,
                    text,
                    sourceType: isReleaseNotes ? 'release' : getIssuePrRecordSourceType(),
                };
            })
            .filter(Boolean);
    }

    function getIssuePrCommentBodies() {
        return findDiscussionItems()
            .map(item => item.markdownEl)
            .filter((bodyEl) => {
                return normalizeText(bodyEl.textContent || '').length > 0;
            });
    }

    function findDiscussionActionsSlot(item) {
        if (item?.sourceType === 'release') return null;

        const rootEl = item?.rootEl;
        if (!rootEl) return null;

        const findMenuButton = (scope) => {
            if (!scope?.querySelector) return null;

            const menuSelectors = [
                '[data-testid="comment-header-hamburger"]',
                'svg.octicon-kebab-horizontal',
                'button[aria-label*="More" i]',
                'button[aria-label*="Actions" i]',
            ];
            for (const selector of menuSelectors) {
                const menuNode = scope.querySelector(selector);
                const menuButton = menuNode?.closest('button, [role="button"]');
                if (menuButton) return menuButton;
            }
            return null;
        };

        // 回复评论可能嵌套在同一个 timeline-comment-group 中；从正文向上查找，
        // 优先使用当前评论自己的操作菜单，避免误用父评论或标题区域的 flex 容器。
        let menuButton = null;
        let scope = item.markdownEl?.parentElement;
        while (scope && rootEl.contains(scope)) {
            menuButton = findMenuButton(scope);
            if (menuButton) break;
            if (scope === rootEl) break;
            scope = scope.parentElement;
        }
        menuButton ||= findMenuButton(rootEl);

        // 新版 GitHub 把三个点放在 .timeline-comment-actions 内层的 flex 行中；
        // 优先使用该行，避免插入块级外层后被换到上一行。
        const actionRow = menuButton?.closest('comment-actions-container')?.parentElement;
        if (actionRow) return actionRow;

        // 兼容旧版直接把菜单放在 .timeline-comment-actions 下的结构。
        const actionGroup = menuButton?.closest('.timeline-comment-actions');
        if (actionGroup) return actionGroup;

        // 当前 React 评论头部会把三点按钮包在 ActionsButtonsContainer 中；
        // 直接挂到该容器，才能让翻译按钮紧挨三点左侧，而不是排在贡献者标签之前。
        const menuButtonsContainer = menuButton?.closest('[class*="ActionsButtonsContainer"]');
        if (menuButtonsContainer) return menuButtonsContainer;

        const menuRow = menuButton?.closest('[data-testid="comment-header-right-side-items"], .timeline-comment-actions > .d-flex');
        if (menuRow) return menuRow;

        const commentActionsRow = rootEl.querySelector('comment-actions-container')?.parentElement;
        if (commentActionsRow) return commentActionsRow;

        return rootEl.querySelector('[data-testid="comment-header-right-side-items"] [class*="ActionsButtonsContainer"]')
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"] [data-testid="comment-header-hamburger"]')?.parentElement
            || rootEl.querySelector('[data-testid="comment-header-right-side-items"]')
            || rootEl.querySelector('.timeline-comment-actions')
            || rootEl.querySelector('.timeline-comment-header .timeline-comment-actions')
            || rootEl.querySelector('[class*="actionsSection"]')
            || rootEl.querySelector('[class*="actionsWrapper"]')
            || rootEl.querySelector('[aria-label="Discussion actions"]')?.parentElement
            || rootEl.querySelector('[aria-label="Discussion comment actions"]')?.parentElement
            || rootEl.querySelector('[data-testid="discussion-comment-actions"]')
            || rootEl.querySelector('[aria-label="Issue body actions"]')?.parentElement
            || rootEl.querySelector('[aria-label="Comment actions"]')?.parentElement
            || rootEl.querySelector('[data-testid="issue-body-header-author"]')?.closest('[class*="activityHeader"]');
    }

    function buildDiscussionCacheKey(item, sourceHash, signature) {
        const repoInfo = getCurrentRepoInfo();
        if (!repoInfo?.fullName || !sourceHash || !signature) return '';

        const sourceType = getDiscussionRecordSourceType(item);
        const discussionMatch = String(window.location.pathname || '').match(/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\/(\d+)/);
        const discussionType = discussionMatch?.[1] || sourceType;
        const discussionNumber = discussionMatch?.[2] || getReleaseIdentifier(item) || 'unknown';
        const commentId = item?.rootEl?.id
            || item?.rootEl?.querySelector('a[href*="#issue-"], a[href*="#issuecomment-"], a[href*="#discussion_r"], a[href*="#discussioncomment-"]')?.hash?.slice(1)
            || item?.rootEl?.querySelector('a[href*="/releases/tag/"]')?.getAttribute('href')?.split('/releases/tag/')[1]
            || createHash(item?.markdownEl?.textContent || '');

        return `${repoInfo.fullName}|${discussionType}|${discussionNumber}|${commentId}|${sourceHash}|${signature}`;
    }

    function getReleaseIdentifier(item) {
        const pathname = String(window.location.pathname || '');
        const pathTag = pathname.match(/^\/[^/]+\/[^/]+\/releases\/tag\/(.+)$/)?.[1];
        if (pathTag) return `tag:${pathTag}`;

        const href = item?.rootEl?.querySelector('a[href*="/releases/tag/"]')?.getAttribute('href') || '';
        const hrefTag = href.match(/\/releases\/tag\/([^?#]+)/)?.[1];
        if (hrefTag) return `tag:${hrefTag}`;

        return pathname.replace(/^\/[^/]+\/[^/]+\/releases\/?/, '') || 'releases';
    }

    function injectIssuePrControlStyles() {
        if (document.getElementById('ghcn-discussion-translate-style')) return;

        const style = document.createElement('style');
        style.id = 'ghcn-discussion-translate-style';
        style.textContent = `
            .ghcn-discussion-translate-toolbar {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin-right: 6px;
            }
            .ghcn-discussion-translate-toolbar--release {
                display: flex;
                margin: 0 0 8px;
            }
            .ghcn-discussion-translate-btn {
                border: 1px solid var(--borderColor-muted, #d0d7de);
                border-radius: 6px;
                background: var(--button-default-bgColor-rest, #f6f8fa);
                color: var(--fgColor-default, #24292f);
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                line-height: 20px;
                padding: 2px 8px;
            }
            .ghcn-discussion-translate-btn--primary {
                border-color: var(--button-primary-borderColor-rest, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-rest, #1f883d);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn.is-active {
                border-color: var(--button-primary-borderColor-rest, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-rest, #1f883d);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn:hover {
                background: var(--button-default-bgColor-hover, #f3f4f6);
            }
            .ghcn-discussion-translate-btn--primary:hover,
            .ghcn-discussion-translate-btn--primary:focus-visible,
            .ghcn-discussion-translate-btn.is-active:hover,
            .ghcn-discussion-translate-btn.is-active:focus-visible {
                border-color: var(--button-primary-borderColor-hover, rgba(31, 136, 61, 0));
                background: var(--button-primary-bgColor-hover, #1a7f37);
                color: var(--button-primary-fgColor-rest, #ffffff);
            }
            .ghcn-discussion-translate-btn:disabled {
                cursor: not-allowed;
                opacity: 0.6;
            }
            .ghcn-discussion-translate-error {
                color: var(--fgColor-danger, #cf222e);
                font-size: 12px;
                line-height: 18px;
            }
            .ghcn-discussion-translation-panel {
                border: 1px solid var(--borderColor-muted, #d8dee4);
                border-left: 3px solid var(--borderColor-accent-emphasis, #0969da);
                margin: 12px 0 0;
                padding: 12px 16px;
                background: var(--bgColor-muted, #f6f8fa);
                border-radius: 6px;
                line-height: 1.6;
            }
            .ghcn-discussion-translation-panel blockquote {
                margin: 8px 0;
                padding: 0 1em;
                color: var(--fgColor-muted, #656d76);
                border-left: 0.25em solid var(--borderColor-default, #d0d7de);
            }
            [data-color-mode="dark"] .ghcn-discussion-translate-btn {
                background-color: var(--button-default-bgColor-rest, #21262d);
                border-color: var(--button-default-borderColor-rest, rgba(240, 246, 252, 0.1));
                color: var(--button-default-fgColor-rest, #c9d1d9);
            }
            [data-color-mode="dark"] .ghcn-discussion-translate-btn:hover {
                background-color: var(--button-default-bgColor-hover, #30363d);
                border-color: var(--button-default-borderColor-hover, #8b949e);
                color: var(--button-default-fgColor-rest, #ffffff);
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel {
                background: var(--bgColor-muted, #161b22) !important;
                border: 1px solid var(--borderColor-default, #30363d) !important;
                border-left: 3px solid var(--borderColor-accent-emphasis, #1f6feb) !important;
                color: var(--fgColor-default, #e6edf3) !important;
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel blockquote {
                color: var(--fgColor-muted, #848d97) !important;
                border-left-color: var(--borderColor-default, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-discussion-translation-panel hr {
                background-color: var(--borderColor-default, #30363d) !important;
            }
            .ghcn-discussion-translation-panel[hidden],
            [data-ghcn-discussion-hidden="true"] {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    function scheduleIssuePrTranslationControls(reason) {
        if (!FeatureSet.enable_extension) return;

        if (issuePrRuntime.timerId) {
            window.clearTimeout(issuePrRuntime.timerId);
        }

        issuePrRuntime.timerId = window.setTimeout(() => {
            issuePrRuntime.timerId = 0;
            setupIssuePrTranslationControls(reason);
        }, ISSUE_PR_CONFIG.DEBOUNCE_MS);
    }

    function setupIssuePrTranslationControls() {
        if (!isIssuePrTranslationEnabled()) {
            restoreIssuePrTranslations();
            return;
        }

        injectIssuePrControlStyles();

        findDiscussionItems().forEach((item) => {
            mountDiscussionToolbar(item);
        });
    }

    function mountDiscussionToolbar(item) {
        const state = getIssuePrDiscussionState(item);
        const slotEl = findDiscussionActionsSlot(item);
        if (state.toolbarEl?.isConnected) {
            // GitHub 的 Turbo/React 重绘可能保留旧工具条节点；每次扫描都把它
            // 重新归位到三个点所在的操作行，避免遗留在 header 顶部。
            if (slotEl && state.toolbarEl.parentElement !== slotEl) {
                slotEl.insertBefore(state.toolbarEl, slotEl.firstChild);
            }
            return;
        }

        if (!slotEl && item.sourceType !== 'release') return;

        const toolbar = document.createElement('div');
        toolbar.className = 'ghcn-discussion-translate-toolbar';
        if (item.sourceType === 'release') {
            toolbar.classList.add('ghcn-discussion-translate-toolbar--release');
        }
        toolbar.dataset.ghcnDiscussionTranslate = 'toolbar';

        state.toolbarEl = toolbar;
        renderDiscussionToolbar(item);
        if (slotEl) {
            slotEl.insertBefore(toolbar, slotEl.firstChild);
        } else if (item.sourceType === 'release') {
            item.viewerEl.insertBefore(toolbar, item.markdownEl);
        } else {
            return;
        }
        item.markdownEl.dataset.ghcnDiscussionTranslate = 'ready';
    }

    function renderDiscussionToolbar(item) {
        const state = getIssuePrDiscussionState(item);
        const toolbar = state.toolbarEl;
        if (!toolbar) return;

        toolbar.textContent = '';

        if (!state.translatedEl) {
            const button = createDiscussionToolbarButton(
                state.isBusy ? '翻译中...' : (state.errorMessage ? '重试' : '翻译'),
                '翻译当前讨论内容',
            );
            button.classList.add('ghcn-discussion-translate-btn--primary');
            button.disabled = state.isBusy;
            button.addEventListener('click', () => {
                handleIssuePrTranslateButton(item).catch((error) => {
                    console.error('[Issue/PR翻译] 执行失败:', error);
                    state.errorMessage = normalizeRuntimeErrorMessage(error);
                    state.isBusy = false;
                    renderDiscussionToolbar(item);
                });
            });
            toolbar.appendChild(button);
            if (state.errorMessage) {
                renderIssuePrError(toolbar, state.errorMessage);
            }
            return;
        }

        ['original', 'translated', 'bilingual'].forEach((mode) => {
            const labels = {
                original: '原文',
                translated: '译文',
                bilingual: '双语',
            };
            const button = createDiscussionToolbarButton(labels[mode], `切换到${labels[mode]}视图`);
            button.classList.toggle('is-active', state.mode === mode);
            button.addEventListener('click', () => {
                setDiscussionViewMode(item, mode);
            });
            toolbar.appendChild(button);
        });

        if (state.errorMessage) {
            renderIssuePrError(toolbar, state.errorMessage);
        }
    }

    function createDiscussionToolbarButton(label, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghcn-discussion-translate-btn';
        button.dataset.ghcnDiscussionTranslate = 'button';
        button.textContent = label;
        button.title = title;
        button.setAttribute('aria-label', title);
        return button;
    }

    async function handleIssuePrTranslateButton(item) {
        const state = getIssuePrDiscussionState(item);
        if (state.isBusy) return;

        clearIssuePrError(state.toolbarEl);
        state.errorMessage = '';

        state.isBusy = true;
        renderDiscussionToolbar(item);

        try {
            await translateIssuePrBody(item);
            setDiscussionViewMode(item, 'translated');
        } catch (error) {
            state.errorMessage = normalizeRuntimeErrorMessage(error);
            throw error;
        } finally {
            state.isBusy = false;
            renderDiscussionToolbar(item);
        }
    }

    function renderIssuePrError(toolbar, message) {
        clearIssuePrError(toolbar);

        const errorEl = document.createElement('span');
        errorEl.className = 'ghcn-discussion-translate-error';
        errorEl.dataset.ghcnDiscussionTranslate = 'error';
        errorEl.textContent = truncateText(message || '翻译失败', 90);
        toolbar.appendChild(errorEl);
    }

    function clearIssuePrError(toolbar) {
        toolbar?.querySelectorAll('[data-ghcn-discussion-translate="error"]').forEach((el) => el.remove());
    }

    function restoreIssuePrBody(itemOrBodyEl) {
        const item = itemOrBodyEl?.markdownEl ? itemOrBodyEl : { markdownEl: itemOrBodyEl };
        const state = getIssuePrDiscussionState(item);
        state.translatedEl?.remove();
        state.translatedEl = null;
        state.mode = 'original';
        state.translatedHash = '';
        item.markdownEl?.removeAttribute('data-ghcn-discussion-hidden');
        item.markdownEl?.removeAttribute('data-ghcn-discussion-view-mode');
        renderDiscussionToolbar(item);
    }

    function restoreIssuePrTranslations() {
        document.querySelectorAll('[data-ghcn-discussion-translate="toolbar"]').forEach((toolbar) => toolbar.remove());
        findDiscussionItems().forEach((item) => {
            restoreIssuePrBody(item);
            delete item.markdownEl.dataset.ghcnDiscussionTranslate;
        });
    }

    async function translateIssuePrBody(item) {
        const startAt = performance.now();
        const state = getIssuePrDiscussionState(item);
        const markdownEl = item.markdownEl;

        if (!state.originalHtml || (state.translatedHash && createHash(markdownEl.innerHTML) !== state.translatedHash)) {
            state.originalHtml = markdownEl.innerHTML;
            state.translatedHash = '';
            state.translatedSignature = '';
            state.translatedEl?.remove();
            state.translatedEl = null;
            state.mode = 'original';
        }

        const providerConfig = getProviderConfig();
        if (!providerConfig.ok) {
            warnIssuePrConfig(providerConfig.message);
            throw new Error(providerConfig.message);
        }

        const sourceHash = createHash(state.originalHtml);
        const signature = createHash(`${providerConfig.signature}\n${state.originalHtml}`);
        if (state.translatedSignature === signature && state.translatedEl?.isConnected) {
            return;
        }

        const sourceText = normalizeText(markdownEl.textContent || '');
        if (shouldSkipReadmeByLanguage(sourceText, providerConfig.targetLang)) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            return;
        }

        const cacheKey = buildDiscussionCacheKey(item, sourceHash, providerConfig.signature);
        const cacheHit = await getRepoCachedTranslation(cacheKey).catch((error) => {
            console.warn('[Issue/PR翻译] 读取讨论缓存失败:', error);
            return null;
        });

        let translatedEl = createTranslatedClone(markdownEl);
        let partialCacheApplied = false;
        if (cacheHit?.translatedHtml) {
            if (containsObjectObjectArtifact(cacheHit.translatedHtml)) {
                console.warn('[Issue/PR翻译] 忽略含有 [object Object] 的损坏仓库缓存');
            } else {
                replaceElementChildrenFromHtml(translatedEl, cacheHit.translatedHtml);
                const cachedRemaining = collectIssuePrTextTasks(translatedEl);
                if (!cachedRemaining.length) {
                    state.translatedEl?.remove();
                    state.translatedEl = translatedEl;
                    markdownEl.insertAdjacentElement('afterend', translatedEl);
                    state.translatedSignature = signature;
                    state.translatedHash = createHash(markdownEl.innerHTML);
                    state.sourceHash = sourceHash;
                    state.errorMessage = '';

                    await appendReadmeTranslationRecord({
                        sourceType: getDiscussionRecordSourceType(item),
                        status: 'cache_hit',
                        tokens: 0,
                        durationMs: performance.now() - startAt,
                        sourceHash,
                        detail: `${getDiscussionRecordSourceType(item)}_cache_hit`,
                    }).catch((error) => {
                        console.warn('[Issue/PR翻译] 写入缓存命中记录失败:', error);
                    });
                    if (cacheHit.complete !== true) {
                        await upsertRepoCachedTranslation(cacheKey, {
                            repo: getCurrentRepoInfo()?.fullName || '',
                            sourceHash,
                            translatedHtml: cacheHit.translatedHtml,
                            complete: true,
                        }).catch((error) => {
                            console.warn('[Issue/PR翻译] 补全讨论缓存状态失败:', error);
                        });
                    }
                    return;
                }

                partialCacheApplied = true;
            }
        }

        const tasks = collectIssuePrTextTasks(translatedEl);
        if (!tasks.length) {
            state.translatedSignature = signature;
            state.translatedHash = createHash(markdownEl.innerHTML);
            throw new Error('当前讨论内容没有可翻译的文本。');
        }

        const uniqueTexts = [...new Set(tasks.map(task => task.normalizedText))];
        const tasksByText = new Map();
        tasks.forEach((task) => {
            if (!tasksByText.has(task.normalizedText)) {
                tasksByText.set(task.normalizedText, []);
            }
            tasksByText.get(task.normalizedText).push(task);
        });

        let translatedCount = 0;
        let totalTokens = 0;

        state.translatedEl?.remove();
        state.translatedEl = translatedEl;
        markdownEl.insertAdjacentElement('afterend', translatedEl);
        setDiscussionViewMode(item, 'translated');

        if (FeatureSet.readme_enable_progressive) {
            const usesAiBatchLimits = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'qwen_mt';
            const groupSize = usesAiBatchLimits
                ? README_CONFIG.OPENAI_PROGRESSIVE_GROUP_SIZE
                : README_CONFIG.PROGRESSIVE_GROUP_SIZE;
            const groups = buildProgressiveTaskGroupsByBlock(translatedEl, tasks, groupSize, ISSUE_PR_CONFIG.BLOCK_SELECTOR);

            for (let index = 0; index < groups.length; index += 1) {
                const groupTexts = [...new Set(groups[index].map(task => task.normalizedText))];
                const { translatedMap, totalTokens: groupTokens } = await translateTextsWithProvider(groupTexts, providerConfig);
                totalTokens += groupTokens;
                translatedCount += applyTaskTranslations(translatedEl, groups[index], translatedMap);

                if (index < groups.length - 1) {
                    await waitForNextPaint();
                }
            }
        } else {
            const { translatedMap, totalTokens: tokens } = await translateTextsWithProvider(uniqueTexts, providerConfig);
            totalTokens += tokens;
            translatedCount += applyTextGroupTranslations(translatedEl, tasksByText, uniqueTexts, translatedMap);
        }

        const complete = translatedCount >= tasks.length;
        state.translatedSignature = complete ? signature : '';
        state.translatedHash = complete ? createHash(markdownEl.innerHTML) : '';
        state.sourceHash = sourceHash;
        state.errorMessage = '';

        if (complete || translatedCount > 0 || partialCacheApplied) {
            await upsertRepoCachedTranslation(cacheKey, {
                repo: getCurrentRepoInfo()?.fullName || '',
                sourceHash,
                translatedHtml: translatedEl.innerHTML,
                complete,
            }).catch((error) => {
                console.warn('[Issue/PR翻译] 写入讨论缓存失败:', error);
            });
        }

        await appendReadmeTranslationRecord({
            sourceType: getDiscussionRecordSourceType(item),
            status: complete ? 'success' : 'partial',
            tokens: totalTokens,
            durationMs: performance.now() - startAt,
            sourceHash,
            detail: `${getDiscussionRecordSourceType(item)}_translated_nodes=${translatedCount}`,
        }).catch((error) => {
            console.warn('[Issue/PR翻译] 写入翻译记录失败:', error);
        });
    }

    function createTranslatedClone(markdownEl) {
        const translatedEl = markdownEl.cloneNode(true);
        translatedEl.classList.add('ghcn-discussion-translation-panel');
        translatedEl.removeAttribute('data-ghcn-discussion-translate');
        translatedEl.setAttribute('data-ghcn-discussion-view-mode', 'translated');
        translatedEl.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        translatedEl.querySelectorAll('[data-ghcn-discussion-translate]').forEach((el) => el.remove());
        translatedEl.hidden = true;
        return translatedEl;
    }

    function setDiscussionViewMode(item, mode) {
        const state = getIssuePrDiscussionState(item);
        const nextMode = ['original', 'translated', 'bilingual'].includes(mode) ? mode : 'original';
        state.mode = nextMode;

        if (!state.translatedEl) {
            item.markdownEl.removeAttribute('data-ghcn-discussion-hidden');
            item.markdownEl.setAttribute('data-ghcn-discussion-view-mode', 'original');
            renderDiscussionToolbar(item);
            return;
        }

        item.markdownEl.setAttribute('data-ghcn-discussion-view-mode', nextMode);
        state.translatedEl.setAttribute('data-ghcn-discussion-view-mode', nextMode);

        const hideOriginal = nextMode === 'translated';
        const hideTranslated = nextMode === 'original';
        item.markdownEl.dataset.ghcnDiscussionHidden = hideOriginal ? 'true' : 'false';
        state.translatedEl.hidden = hideTranslated;

        renderDiscussionToolbar(item);
    }

    function collectIssuePrTextTasks(bodyEl) {
        const tasks = [];
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);

        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest(ISSUE_PR_CONFIG.SKIP_PARENT_SELECTOR)) continue;

            const rawText = node.data;
            const trimmedText = rawText.trim();
            const normalizedText = normalizeText(trimmedText);

            if (shouldSkipReadmeText(normalizedText)) continue;

            tasks.push({ node, rawText, trimmedText, normalizedText });
        }

        return tasks;
    }

    function warnIssuePrConfig(message) {
        const warnKey = `${FeatureSet.readme_provider}:${message}`;
        if (issuePrRuntime.lastWarnKey === warnKey) return;

        issuePrRuntime.lastWarnKey = warnKey;
        console.warn(`[Issue/PR翻译] ${message}`);
    }

