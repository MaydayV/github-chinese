/**
 * @file chrome/src/features/tldr-capsule.js
 * 仓库首页 AI 速读胶囊 (TL;DR)：3 秒极简启动提取、三要素展示与本地秒开缓存
 */

    const TLDR_SYSTEM_PROMPT = `你是一个资深开源架构师与技术评测专家。请根据输入的开源项目 README 前部内容，用简体中文生成一份极简的「项目速读胶囊」。
严格遵循以下 2 点结构输出纯 Markdown：
- **🎯 核心定位**：一句话直击痛点，说明这个项目解决什么核心问题，属于什么领域。
- **💡 选型考量**：说明同类对比或适用场景（如：“相比 XX 更轻量，适合小型集群”）。
输出纯 Markdown 列表，严格不要包含额外前缀、礼貌客套或总结废话。`;

    function isTldrCapsuleEnabled() {
        return FeatureSet.enable_extension && FeatureSet.enable_repo_tldr && isReadmePage();
    }

    function scheduleTldrCapsuleControls(reason) {
        if (!FeatureSet.enable_extension) return;

        if (tldrRuntime.timerId) {
            window.clearTimeout(tldrRuntime.timerId);
        }

        tldrRuntime.timerId = window.setTimeout(() => {
            tldrRuntime.timerId = 0;
            setupTldrCapsuleControls(reason);
        }, 160);
    }

    function setupTldrCapsuleControls() {
        if (!isTldrCapsuleEnabled()) {
            restoreTldrCapsuleControls();
            return;
        }

        const readmeRoot = getReadmeRootElement();
        if (!readmeRoot) return;

        const repoInfo = getCurrentRepoInfo();
        if (!repoInfo) return;

        // 若 README 过于简短（不足 80 字符）或仅有一行标题，防范向 AI 发送无效请求造成 Token 浪费与幻觉
        const introText = extractReadmeIntroText(readmeRoot);
        if (!introText || introText.trim().length < 80) {
            restoreTldrCapsuleControls();
            return;
        }

        injectTldrCapsuleStyles();
        mountTldrCapsule(readmeRoot, repoInfo);
    }

    function restoreTldrCapsuleControls() {
        document.querySelectorAll('[data-ghcn-tldr]').forEach((el) => el.remove());
    }

    function buildTldrCacheKey(repoInfo, sourceHash) {
        if (!repoInfo?.fullName || !sourceHash) return '';
        return `${repoInfo.fullName.toLowerCase()}|tldr|${sourceHash}`;
    }

    function getTldrSourceHash(readmeRoot) {
        if (!readmeRoot) return '';
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(readmeRoot) : null;
        const html = state?.originalHtml || readmeRoot.innerHTML || '';
        return getStableReadmeTextHash(html);
    }

    function extractReadmeIntroText(readmeRoot, maxChars = 2400) {
        const state = typeof getReadmeElementState === 'function' ? getReadmeElementState(readmeRoot) : null;
        let sourceEl = readmeRoot;
        if (state?.originalHtml) {
            sourceEl = document.createElement('div');
            sourceEl.innerHTML = state.originalHtml;
        }
        const clone = sourceEl.cloneNode(true);
        clone.querySelectorAll('pre, code, svg, img, table, .notranslate, [translate="no"]').forEach((el) => el.remove());
        const text = normalizeText(clone.textContent || '');
        return text.slice(0, maxChars);
    }

    function findTldrMountPoint(readmeRoot) {
        if (!readmeRoot) return null;

        // 如果处于 .Box-body 内部，优先挂载在 .Box-body 之前（紧贴 .Box-header 之后，贴紧上边和左右）
        const boxBody = readmeRoot.closest('.Box-body');
        if (boxBody && boxBody.parentElement) {
            return { parent: boxBody.parentElement, before: boxBody };
        }

        // 默认挂载在 README 容器内部顶部（正文 readmeRoot 之前、自述文件标题栏之后）
        if (readmeRoot.parentElement) {
            return { parent: readmeRoot.parentElement, before: readmeRoot };
        }

        return null;
    }

    function findReadmeHeaderActions(readmeRoot) {
        if (!readmeRoot) return null;

        const readmeBox = readmeRoot.closest('#readme, [data-testid="readme"], .Box, div[class*="Box"]')
            || document.querySelector('#readme, [data-testid="readme"]');
        if (!readmeBox) return null;

        // 1. 优先定位 README 头部区域内的 Copilot 图标按钮（放在这个图标左侧）
        const copilotSvg = readmeBox.querySelector('svg.octicon-copilot');
        if (copilotSvg) {
            const copilotBtn = copilotSvg.closest('button, [role="button"]');
            if (copilotBtn && copilotBtn.parentElement) {
                return {
                    container: copilotBtn.parentElement,
                    beforeEl: copilotBtn,
                    copilotBtn,
                };
            }
        }

        // 2. 次优先：定位铅笔编辑按钮或目录大纲按钮（无 Copilot 权限或未开启时的通用动作栏）
        const siblingSvg = readmeBox.querySelector('svg.octicon-pencil, svg.octicon-list-unordered, svg.octicon-kebab-horizontal');
        if (siblingSvg) {
            const siblingBtn = siblingSvg.closest('button, [role="button"]');
            if (siblingBtn && siblingBtn.parentElement) {
                return {
                    container: siblingBtn.parentElement,
                    beforeEl: siblingBtn,
                    copilotBtn: null,
                };
            }
        }

        // 3. 兜底：定位 Box-header 内的右侧操作按钮区
        const header = readmeBox.querySelector('.Box-header, header');
        if (header) {
            const actionsContainer = header.querySelector('.Box-header-actions, [class*="HeaderActions"], div.d-flex:last-child');
            if (actionsContainer) {
                return {
                    container: actionsContainer,
                    beforeEl: actionsContainer.firstElementChild,
                    copilotBtn: null,
                };
            }
        }

        return null;
    }

    function createTldrCardElement(readmeRoot, sourceHash) {
        const mountPoint = findTldrMountPoint(readmeRoot);
        if (!mountPoint) return null;

        const oldCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (oldCard) {
            if (oldCard.dataset.sourceHash === sourceHash && oldCard.parentElement === mountPoint.parent && oldCard.nextElementSibling === mountPoint.before) {
                oldCard.style.display = '';
                return oldCard;
            }
            oldCard.remove();
        }

        const card = document.createElement('section');
        card.className = 'ghcn-tldr-card';
        card.dataset.ghcnTldr = 'capsule';
        card.dataset.sourceHash = sourceHash;

        mountPoint.parent.insertBefore(card, mountPoint.before);
        return card;
    }

    function mountTldrHeaderButton(readmeRoot, repoInfo, onToggle) {
        const headerActions = findReadmeHeaderActions(readmeRoot);
        if (!headerActions || !headerActions.container) return null;

        const sourceHash = getTldrSourceHash(readmeRoot);

        let btn = document.querySelector('[data-ghcn-tldr="header-btn"]');
        if (btn) {
            if (btn.parentElement === headerActions.container && btn.nextElementSibling === headerActions.beforeEl) {
                return btn;
            }
            btn.remove();
        }

        btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-component', 'Button');
        btn.setAttribute('data-size', 'small');
        btn.className = 'ghcn-tldr-header-btn btn btn-sm Button--primary Button--small Button tooltipped tooltipped-w';
        btn.setAttribute('aria-label', 'AI 项目速读 (TL;DR)');
        btn.title = 'AI 项目速读 (TL;DR)';
        btn.dataset.ghcnTldr = 'header-btn';
        btn.dataset.sourceHash = sourceHash;
        btn.innerHTML = `<span class="ghcn-tldr-header-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span><span class="ghcn-tldr-header-text">AI 速读</span>`;

        headerActions.container.insertBefore(btn, headerActions.beforeEl);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeof onToggle === 'function') {
                onToggle(btn);
            }
        });

        return btn;
    }

    async function mountTldrCapsule(readmeRoot, repoInfo) {
        const sourceHash = getTldrSourceHash(readmeRoot);
        const cacheKey = buildTldrCacheKey(repoInfo, sourceHash);

        // 1. 精确匹配当前 hash 缓存
        let cached = await getRepoCachedTranslation(cacheKey, { requireComplete: true });

        // 2. 兜底匹配该仓库最新生成的速读缓存（防止 README 翻译后 DOM 变动导致 hash 微小变化）
        if (!cached?.tldrContent && FeatureSet.readme_enable_repo_cache && repoInfo?.fullName) {
            await ensureRepoCacheLoaded();
            const prefix = `${repoInfo.fullName.toLowerCase()}|tldr|`;
            for (const [key, entry] of readmeRuntime.repoCacheMap.entries()) {
                if (key.startsWith(prefix) && entry.tldrContent && entry.complete === true) {
                    cached = entry;
                    break;
                }
            }
        }

        const headerActions = findReadmeHeaderActions(readmeRoot);

        // 挂载或更新头部按钮（位于 Copilot 图标左侧）
        const headerBtn = mountTldrHeaderButton(readmeRoot, repoInfo, async (btn) => {
            let card = document.querySelector('[data-ghcn-tldr="capsule"]');

            // 如果卡片已经存在且可见，点击则折叠/收起卡片
            if (card && card.style.display !== 'none') {
                card.style.display = 'none';
                btn.classList.remove('is-active');
                btn.setAttribute('aria-expanded', 'false');
                return;
            }

            // 如果卡片已经存在但处于隐藏状态，切换为展示
            if (card) {
                card.style.display = '';
                btn.classList.add('is-active');
                btn.setAttribute('aria-expanded', 'true');
                return;
            }

            // 卡片尚未创建：点击时按需创建卡片并展示内容
            card = createTldrCardElement(readmeRoot, sourceHash);
            if (!card) return;

            btn.classList.add('is-active', 'is-loading');
            btn.setAttribute('aria-expanded', 'true');

            // 如果已有缓存内容直接秒开渲染，否则调用 AI 提炼
            if (cached?.tldrContent) {
                renderTldrContent(card, cached.tldrContent, repoInfo, readmeRoot, sourceHash, true);
                btn.classList.remove('is-loading');
            } else {
                try {
                    await executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
                } finally {
                    btn.classList.remove('is-loading');
                }
            }
        });

        // 默认不主动展示下方的总结内容卡片，保持 README 清爽，待用户点击头部「AI 速读」按钮后再展开
        const existingCard = document.querySelector('[data-ghcn-tldr="capsule"]');
        if (existingCard && !headerBtn?.classList.contains('is-active')) {
            existingCard.style.display = 'none';
        }

        if (headerBtn) {
            headerBtn.classList.remove('is-active');
            headerBtn.setAttribute('aria-expanded', 'false');
            if (cached?.tldrContent) {
                headerBtn.setAttribute('data-has-cache', 'true');
                headerBtn.title = 'AI 项目速读 (TL;DR) - 点击展开速读卡片';
            }
        } else if (!headerActions) {
            // 极低概率：若找不到任何头部按钮挂载点，降级在 README 顶部展示初始提炼条
            const card = createTldrCardElement(readmeRoot, sourceHash);
            if (card) {
                if (cached?.tldrContent) {
                    renderTldrContent(card, cached.tldrContent, repoInfo, readmeRoot, sourceHash, true);
                } else {
                    renderTldrInitial(card, repoInfo, readmeRoot, sourceHash);
                }
            }
        }
    }

    const TLDR_ICONS = {
        sparkle: '<svg class="octicon octicon-sparkle" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.492 7.492 0 0 0 4.464 4.464l1.306.478a.5.5 0 0 1 0 .94l-1.306.478a7.492 7.492 0 0 0-4.464 4.464l-.478 1.306a.5.5 0 0 1-.94 0l-.478-1.306a7.492 7.492 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.492 7.492 0 0 0 4.464-4.464Z"></path></svg>',
        sync: '<svg class="octicon octicon-sync" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>',
        close: '<svg class="octicon octicon-x" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>',
        chevronUp: '<svg class="octicon octicon-chevron-up" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z"></path></svg>',
        chevronDown: '<svg class="octicon octicon-chevron-down" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12.78 5.47a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0l-4.25-4.25a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path></svg>',
        copy: '<svg class="octicon octicon-copy" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>',
        check: '<svg class="octicon octicon-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>',
        alert: '<svg class="octicon octicon-alert" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
    };

    function renderTldrInitial(card, repoInfo, readmeRoot, sourceHash) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-sparkle-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span>
                    <strong class="Box-title ghcn-tldr-title">AI 项目速读</strong>
                    <span class="Label ghcn-tldr-badge">秒懂项目</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm btn-primary ghcn-tldr-btn ghcn-tldr-btn--primary" data-ghcn-tldr-action="generate">
                        <span class="ghcn-tldr-btn-icon">${TLDR_ICONS.sparkle}</span>
                        <span>提炼项目速读</span>
                    </button>
                </div>
            </div>
        `;

        card.querySelector('[data-ghcn-tldr-action="generate"]')?.addEventListener('click', () => {
            executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
        });
    }

    function renderTldrLoading(card) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-spinner" aria-hidden="true"></span>
                    <strong class="Box-title ghcn-tldr-title">正在通过 AI 提炼项目核心定位与选型考量...</strong>
                </div>
            </div>
        `;
    }

    function renderTldrError(card, message, repoInfo, readmeRoot, sourceHash) {
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-error-icon" aria-hidden="true">${TLDR_ICONS.alert}</span>
                    <strong class="Box-title ghcn-tldr-title">生成速读失败</strong>
                    <span class="ghcn-tldr-error-msg">${decodeHtmlEntities(message || '接口调用异常')}</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm ghcn-tldr-btn" data-ghcn-tldr-action="retry">重试</button>
                </div>
            </div>
        `;

        card.querySelector('[data-ghcn-tldr-action="retry"]')?.addEventListener('click', () => {
            executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
        });
    }

    function extractCommandInfo(text) {
        if (!text) return null;

        const codeMatch = text.match(/`([^`]+)`/);
        let cmd = '';
        let prefixNote = '';

        if (codeMatch) {
            cmd = codeMatch[1].trim();
            prefixNote = text.replace(codeMatch[0], '').replace(/^[:：\s]+/, '').replace(/[:：\s]+$/, '').trim();
        } else {
            const trimmed = text.replace(/^[:：\s]+/, '').trim();
            const isCli = /^(docker|npm|pnpm|yarn|npx|pip|pip3|cargo|brew|git|curl|wget|go|composer|gem|bun|deno)\b/i.test(trimmed);
            if (isCli) {
                cmd = trimmed;
            }
        }

        if (!cmd) return null;
        if (cmd.includes('无需安装')) return null;

        return { cmd, note: prefixNote };
    }

    function formatInlineMarkdown(text) {
        let safe = escapeHtml(text || '');
        safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/`([^`]+)`/g, '<code class="ghcn-tldr-inline-code">$1</code>');
        return safe;
    }

    function formatTldrMarkdownToHtml(markdownText) {
        if (!markdownText) return '';

        let normalized = String(markdownText).replace(/\r\n/g, '\n');
        normalized = normalized.replace(/```(?:bash|sh|shell|zsh)?\n([\s\S]*?)\n```/g, (match, code) => `\`${code.trim()}\``);

        const rawLines = normalized.split('\n');
        const mergedLines = [];

        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i].trim();
            if (!line) continue;

            const isNewBullet = /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^\*\*[^*]+\*\*/.test(line);

            if ((!isNewBullet || line.startsWith('：') || line.startsWith(':')) && mergedLines.length > 0) {
                const prev = mergedLines[mergedLines.length - 1];
                if (line.startsWith('：') || line.startsWith(':')) {
                    mergedLines[mergedLines.length - 1] = prev + line;
                } else {
                    mergedLines[mergedLines.length - 1] = prev + ' ' + line;
                }
            } else {
                mergedLines.push(line);
            }
        }

        const htmlParts = [];

        mergedLines.forEach((line) => {
            let cleanLine = line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '');

            const boldMatch = cleanLine.match(/^\*\*([^*]+)\*\*[:：]?\s*(.*)$/);
            let title = '';
            let rest = cleanLine;

            if (boldMatch) {
                title = boldMatch[1].trim();
                rest = boldMatch[2].trim();
            }

            // 过滤掉 3 秒极简启动等输出，保持速读卡片精炼聚焦
            if (title.includes('启动') || title.includes('3秒') || cleanLine.includes('3秒极简启动')) {
                return;
            }

            rest = rest.replace(/^[:：\s]+/, '').trim();

            const isStartupOrCmd = title.includes('启动') || title.includes('命令') || title.includes('安装') || title.includes('运行');
            const cmdInfo = isStartupOrCmd ? extractCommandInfo(rest) : null;

            if (cmdInfo && cmdInfo.cmd) {
                htmlParts.push(`
                    <div class="ghcn-tldr-row ghcn-tldr-row--cmd">
                        <div class="ghcn-tldr-row-header">
                            ${title ? `<strong class="ghcn-tldr-label">${escapeHtml(title)}</strong>` : ''}
                            ${cmdInfo.note ? `<span class="ghcn-tldr-note">${escapeHtml(cmdInfo.note)}</span>` : ''}
                        </div>
                        <div class="ghcn-tldr-cmd-box">
                            <div class="ghcn-tldr-cmd-inner">
                                <span class="ghcn-tldr-cmd-prompt" aria-hidden="true">$</span>
                                <code class="ghcn-tldr-cmd-code">${escapeHtml(cmdInfo.cmd)}</code>
                            </div>
                            <button type="button" class="ghcn-tldr-copy-cmd" data-cmd="${escapeHtml(cmdInfo.cmd)}" title="复制命令" aria-label="复制命令">
                                <span class="ghcn-tldr-copy-icon-wrap" aria-hidden="true">${TLDR_ICONS.copy}</span>
                                <span class="ghcn-tldr-copy-label">复制</span>
                            </button>
                        </div>
                    </div>
                `);
            } else {
                htmlParts.push(`
                    <div class="ghcn-tldr-row">
                        ${title ? `<strong class="ghcn-tldr-label">${escapeHtml(title)}：</strong>` : ''}
                        <span class="ghcn-tldr-text">${formatInlineMarkdown(rest)}</span>
                    </div>
                `);
            }
        });

        return htmlParts.join('') || escapeHtml(markdownText);
    }

    function renderTldrContent(card, contentText, repoInfo, readmeRoot, sourceHash, isCached = false) {
        card.classList.add('is-completed');
        card.innerHTML = `
            <div class="Box-header ghcn-tldr-header">
                <div class="ghcn-tldr-title-wrap">
                    <span class="ghcn-tldr-sparkle-icon" aria-hidden="true">${TLDR_ICONS.sparkle}</span>
                    <strong class="Box-title ghcn-tldr-title">AI 项目速读</strong>
                    <span class="Label ghcn-tldr-badge ${isCached ? 'is-cached' : ''}">${isCached ? '已命中缓存' : '新提炼'}</span>
                </div>
                <div class="ghcn-tldr-actions">
                    <button type="button" class="btn btn-sm ghcn-tldr-tool-btn" data-ghcn-tldr-action="refresh" title="重新提炼速读" aria-label="重新提炼速读">
                        <span class="ghcn-tldr-tool-icon">${TLDR_ICONS.sync}</span>
                    </button>
                    <button type="button" class="btn btn-sm ghcn-tldr-tool-btn" data-ghcn-tldr-action="close" title="关闭速读卡片" aria-label="关闭速读卡片">
                        <span class="ghcn-tldr-tool-icon">${TLDR_ICONS.close}</span>
                    </button>
                </div>
            </div>
            <div class="Box-body ghcn-tldr-body">
                ${formatTldrMarkdownToHtml(contentText)}
            </div>
        `;

        card.querySelectorAll('.ghcn-tldr-copy-cmd').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cmd = btn.getAttribute('data-cmd') || '';
                if (!cmd) return;
                try {
                    await navigator.clipboard.writeText(cmd);
                    btn.classList.add('is-copied');
                    const label = btn.querySelector('.ghcn-tldr-copy-label');
                    const iconWrap = btn.querySelector('.ghcn-tldr-copy-icon-wrap');
                    if (label) label.textContent = '已复制';
                    if (iconWrap) iconWrap.innerHTML = TLDR_ICONS.check;
                    window.setTimeout(() => {
                        btn.classList.remove('is-copied');
                        if (label) label.textContent = '复制';
                        if (iconWrap) iconWrap.innerHTML = TLDR_ICONS.copy;
                    }, 1600);
                } catch {
                    // Clipboard fallback
                }
            });
        });

        const refreshBtn = card.querySelector('[data-ghcn-tldr-action="refresh"]');
        refreshBtn?.addEventListener('click', async () => {
            const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
            headerBtn?.classList.add('is-loading');
            refreshBtn?.classList.add('is-loading');
            try {
                await executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash);
            } finally {
                headerBtn?.classList.remove('is-loading');
                refreshBtn?.classList.remove('is-loading');
            }
        });

        card.querySelector('[data-ghcn-tldr-action="close"]')?.addEventListener('click', () => {
            card.style.display = 'none';
            const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
            if (headerBtn) {
                headerBtn.classList.remove('is-active');
                headerBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    async function executeTldrGeneration(card, repoInfo, readmeRoot, sourceHash) {
        if (tldrRuntime.isBusy) return;
        tldrRuntime.isBusy = true;
        renderTldrLoading(card);

        const headerBtn = document.querySelector('[data-ghcn-tldr="header-btn"]');
        if (headerBtn) {
            headerBtn.classList.add('is-active', 'is-loading');
            headerBtn.setAttribute('aria-expanded', 'true');
        }

        const startAt = performance.now();
        const activeSourceHash = sourceHash || getTldrSourceHash(readmeRoot);
        const cacheKey = buildTldrCacheKey(repoInfo, activeSourceHash);

        try {
            const providerConfig = getProviderConfig();
            if (!providerConfig.ok) {
                throw new Error(providerConfig.message);
            }

            const introText = extractReadmeIntroText(readmeRoot, 2400);
            if (!introText || introText.trim().length < 80) {
                throw new Error('README 正文内容过短（不足 80 字符），无法提炼速读胶囊。');
            }

            const userPrompt = `项目：${repoInfo.fullName}\n\nREADME 简介内容：\n${introText}`;
            let summaryText = '';
            let totalTokens = 0;
            const isAiProvider = AI_CHAT_PROVIDERS.includes(providerConfig.provider) || providerConfig.provider === 'openai_compatible';

            if (!isAiProvider) {
                throw new Error('AI 速读需要配置 OpenAI 兼容的对话模型（推荐 DeepSeek）。');
            }

            if (isAiProvider) {
                const payload = {
                    model: providerConfig.model,
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: TLDR_SYSTEM_PROMPT },
                        { role: 'user', content: userPrompt },
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
                summaryText = stripOpenAiReasoningBlocks(extractChatMessageContent(firstChoice));
                totalTokens = getReadmeUsageTokens(data);
            }

            if (!summaryText) {
                throw new Error('速读胶囊生成结果为空，请重试或检查接口配置。');
            }

            const durationMs = performance.now() - startAt;

            // Save to repo cache
            await upsertRepoCachedTranslation(cacheKey, {
                repo: repoInfo.fullName,
                sourceHash: activeSourceHash,
                tldrContent: summaryText,
                complete: true,
            }).catch((err) => {
                console.warn('[速读胶囊] 写入缓存失败:', err);
            });

            // Append record
            await appendReadmeTranslationRecord({
                repo: repoInfo.fullName,
                sourceType: 'tldr',
                status: 'success',
                tokens: totalTokens,
                durationMs,
                sourceHash: activeSourceHash,
                detail: 'tldr_generated',
            }).catch((err) => {
                console.warn('[速读胶囊] 写入翻译记录失败:', err);
            });

            renderTldrContent(card, summaryText, repoInfo, readmeRoot, activeSourceHash, false);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
                headerBtn.classList.add('is-active');
                headerBtn.setAttribute('aria-expanded', 'true');
            }
        } catch (error) {
            console.error('[速读胶囊] 生成失败:', error);
            renderTldrError(card, normalizeRuntimeErrorMessage(error), repoInfo, readmeRoot, activeSourceHash);
            if (headerBtn) {
                headerBtn.classList.remove('is-loading');
            }
        } finally {
            tldrRuntime.isBusy = false;
        }
    }

    function injectTldrCapsuleStyles() {
        if (document.getElementById('ghcn-tldr-style')) return;

        const style = document.createElement('style');
        style.id = 'ghcn-tldr-style';
        style.textContent = `
            .ghcn-tldr-card {
                margin: 0 !important;
                border-top: none !important;
                border-left: none !important;
                border-right: none !important;
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4) !important;
                border-radius: 0 !important;
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                box-shadow: none !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
                box-sizing: border-box;
                overflow: hidden;
            }
            .ghcn-tldr-header {
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                border: none !important;
                border-radius: 0 !important;
                padding: 8px 16px !important;
                min-height: 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex-wrap: wrap;
                box-sizing: border-box;
            }
            .ghcn-tldr-card.is-completed .ghcn-tldr-header {
                border-bottom: 1px solid var(--borderColor-muted, #d8dee4) !important;
            }
            .ghcn-tldr-title-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                min-height: 24px;
            }
            .ghcn-tldr-sparkle-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #8250df;
            }
            .ghcn-tldr-title {
                font-size: 13px !important;
                font-weight: 600 !important;
                color: var(--fgColor-default, #1f2328) !important;
                line-height: 20px;
                margin: 0;
            }
            .ghcn-tldr-badge {
                font-size: 11px !important;
                font-weight: 500 !important;
                line-height: 18px !important;
                padding: 0 7px !important;
                border-radius: 24px !important;
                border: 1px solid var(--borderColor-default, #d0d7de) !important;
                background-color: var(--bgColor-muted, #f6f8fa) !important;
                color: var(--fgColor-muted, #656d76) !important;
                white-space: nowrap;
            }
            .ghcn-tldr-badge.is-cached {
                border-color: rgba(26, 127, 55, 0.4) !important;
                background-color: rgba(46, 160, 67, 0.1) !important;
                color: var(--fgColor-success, #1a7f37) !important;
            }
            .ghcn-tldr-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .ghcn-tldr-btn {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 3px 12px;
                font-size: 12px;
                font-weight: 500;
                line-height: 20px;
                border-radius: 6px;
                border: 1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d0d7de));
                background-color: var(--button-default-bgColor-rest, #ffffff);
                color: var(--fgColor-default, #1f2328);
                cursor: pointer;
                transition: 0.15s ease;
                user-select: none;
                text-decoration: none;
            }
            .ghcn-tldr-btn:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6);
                border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d0d7de));
            }
            .ghcn-tldr-btn--primary {
                background-color: var(--button-primary-bgColor-rest, #1f883d);
                border-color: var(--button-primary-borderColor-rest, rgba(31, 35, 40, 0.15));
                color: #ffffff;
                box-shadow: var(--shadow-resting-xsmall, 0 1px 0 rgba(31, 35, 40, 0.1));
            }
            .ghcn-tldr-btn--primary:hover {
                background-color: var(--button-primary-bgColor-hover, #1a7f37);
                border-color: var(--button-primary-borderColor-hover, rgba(31, 35, 40, 0.15));
                color: #ffffff;
            }
            .ghcn-tldr-btn-icon {
                display: inline-flex;
                align-items: center;
            }
            .ghcn-tldr-tool-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 28px !important;
                height: 28px !important;
                min-width: 28px !important;
                padding: 0 !important;
                border-radius: 6px !important;
                border: 1px solid var(--button-default-borderColor-rest, var(--borderColor-default, #d0d7de)) !important;
                background-color: var(--button-default-bgColor-rest, #f6f8fa) !important;
                color: var(--fgColor-muted, #656d76) !important;
                box-shadow: var(--button-default-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.04)) !important;
                cursor: pointer !important;
                transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
                user-select: none !important;
                box-sizing: border-box !important;
            }
            .ghcn-tldr-tool-btn:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6) !important;
                border-color: var(--button-default-borderColor-hover, var(--borderColor-default, #d0d7de)) !important;
                color: var(--fgColor-default, #1f2328) !important;
            }
            .ghcn-tldr-tool-btn:active {
                background-color: var(--button-default-bgColor-active, #ebecf0) !important;
            }
            .ghcn-tldr-tool-btn.is-loading .ghcn-tldr-tool-icon {
                animation: ghcn-tldr-spin 0.8s linear infinite !important;
                color: #8250df !important;
            }
            .ghcn-tldr-tool-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 14px !important;
                height: 14px !important;
                color: currentColor;
            }
            .ghcn-tldr-header-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 5px !important;
                height: 28px !important;
                min-height: 28px !important;
                padding: 3px 10px !important;
                margin: 0 4px 0 0 !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                line-height: 20px !important;
                border-radius: 6px !important;
                border: 1px solid var(--button-primary-borderColor-rest, rgba(31, 35, 40, 0.15)) !important;
                background-color: var(--button-primary-bgColor-rest, #1f883d) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
                box-shadow: var(--button-primary-shadow-resting, 0 1px 0 rgba(31, 35, 40, 0.1)) !important;
                cursor: pointer !important;
                transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease !important;
                user-select: none !important;
                box-sizing: border-box !important;
                vertical-align: middle !important;
                text-decoration: none !important;
                white-space: nowrap !important;
                position: relative !important;
            }
            .ghcn-tldr-header-btn:hover {
                background-color: var(--button-primary-bgColor-hover, #1a7f37) !important;
                border-color: var(--button-primary-borderColor-hover, rgba(31, 35, 40, 0.15)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-btn:active {
                background-color: var(--button-primary-bgColor-active, #1f883d) !important;
            }
            .ghcn-tldr-header-btn.is-active {
                background-color: var(--button-primary-bgColor-active, #1f883d) !important;
                border-color: var(--button-primary-borderColor-active, rgba(31, 35, 40, 0.15)) !important;
                box-shadow: inset 0 1px 0 rgba(31, 35, 40, 0.1) !important;
            }
            .ghcn-tldr-header-icon {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 14px !important;
                height: 14px !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-icon svg,
            .ghcn-tldr-header-icon .octicon {
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
                fill: currentColor !important;
            }
            .ghcn-tldr-header-text {
                display: inline-block !important;
                line-height: 20px !important;
                font-weight: 500 !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-header-btn.is-loading .ghcn-tldr-header-icon {
                animation: ghcn-tldr-spin 0.8s linear infinite !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-btn {
                background-color: var(--button-primary-bgColor-rest, #238636) !important;
                border-color: var(--button-primary-borderColor-rest, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-btn:hover {
                background-color: var(--button-primary-bgColor-hover, #2ea043) !important;
                border-color: var(--button-primary-borderColor-hover, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn {
                background-color: var(--button-default-bgColor-rest, #21262d) !important;
                border-color: var(--button-default-borderColor-rest, rgba(240, 246, 252, 0.1)) !important;
                color: var(--button-default-fgColor-rest, #c9d1d9) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn:hover {
                background-color: var(--button-default-bgColor-hover, #30363d) !important;
                border-color: var(--button-default-borderColor-hover, #8b949e) !important;
                color: var(--button-default-fgColor-rest, #ffffff) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn:active {
                background-color: var(--button-default-bgColor-active, #282e33) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-tool-btn.is-loading .ghcn-tldr-tool-icon {
                color: #a371f7 !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header-icon,
            [data-color-mode="dark"] .ghcn-tldr-header-text {
                color: var(--button-primary-fgColor-rest, #ffffff) !important;
            }
            .ghcn-tldr-body {
                padding: 14px 18px !important;
                background-color: #f6faf7 !important;
                display: flex;
                flex-direction: column;
                gap: 12px;
                font-size: 13px;
                line-height: 1.6;
                color: var(--fgColor-default, #1f2328);
                box-sizing: border-box;
            }
            [data-color-mode="dark"] .ghcn-tldr-card {
                background-color: var(--bgColor-muted, #161b22) !important;
                border-bottom-color: var(--borderColor-muted, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-header {
                background-color: var(--bgColor-muted, #161b22) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-card.is-completed .ghcn-tldr-header {
                border-bottom-color: var(--borderColor-muted, #30363d) !important;
            }
            [data-color-mode="dark"] .ghcn-tldr-body {
                background-color: rgba(46, 160, 67, 0.08) !important;
                color: var(--fgColor-default, #e6edf3) !important;
            }
            .ghcn-tldr-row {
                font-size: 13px;
                line-height: 1.6;
                color: var(--fgColor-default, #1f2328);
                word-break: break-word;
            }
            .ghcn-tldr-label {
                font-weight: 600;
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-text {
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-note {
                font-size: 12px;
                color: var(--fgColor-muted, #656d76);
                margin-left: 6px;
            }
            .ghcn-tldr-inline-code {
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
                font-size: 12px;
                padding: 2px 6px;
                border-radius: 4px;
                background-color: var(--bgColor-muted, #f6f8fa);
                border: 1px solid var(--borderColor-muted, #d8dee4);
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-row--cmd {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .ghcn-tldr-cmd-box {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                background-color: var(--bgColor-muted, #f6f8fa);
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 6px;
                padding: 6px 10px;
                box-sizing: border-box;
            }
            .ghcn-tldr-cmd-inner {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
                flex: 1;
                overflow-x: auto;
                scrollbar-width: thin;
            }
            .ghcn-tldr-cmd-prompt {
                color: var(--fgColor-muted, #656d76);
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
                font-size: 12px;
                font-weight: 600;
                user-select: none;
                flex-shrink: 0;
            }
            .ghcn-tldr-cmd-code {
                font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
                font-size: 12px;
                color: var(--fgColor-default, #1f2328);
                white-space: nowrap;
                user-select: all;
            }
            .ghcn-tldr-copy-cmd {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                flex-shrink: 0;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 500;
                line-height: 16px;
                color: var(--fgColor-muted, #656d76);
                background-color: var(--button-default-bgColor-rest, #ffffff);
                border: 1px solid var(--borderColor-default, #d0d7de);
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
                user-select: none;
            }
            .ghcn-tldr-copy-cmd:hover {
                background-color: var(--button-default-bgColor-hover, #f3f4f6);
                color: var(--fgColor-default, #1f2328);
            }
            .ghcn-tldr-copy-cmd.is-copied {
                color: var(--fgColor-success, #1a7f37);
                border-color: rgba(26, 127, 55, 0.4);
                background-color: rgba(46, 160, 67, 0.08);
            }
            .ghcn-tldr-copy-icon-wrap {
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .ghcn-tldr-spinner {
                display: inline-block;
                width: 14px;
                height: 14px;
                border: 2px solid var(--borderColor-default, #d0d7de);
                border-top-color: #8250df;
                border-radius: 50%;
                animation: ghcn-tldr-spin 0.75s linear infinite;
                flex-shrink: 0;
            }
            @keyframes ghcn-tldr-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .ghcn-tldr-error-icon {
                display: inline-flex;
                align-items: center;
                color: var(--fgColor-danger, #cf222e);
            }
            .ghcn-tldr-error-msg {
                color: var(--fgColor-danger, #cf222e);
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }
