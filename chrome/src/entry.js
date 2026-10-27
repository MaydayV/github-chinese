/**
 * @file chrome/src/entry.js
 * 插件生命周期入口：环境嗅探、语言属性监听与首次启动初始化
 */

    /**
     * init 函数：初始化翻译功能。
     */
    async function init() {
        if (typeof I18N === 'undefined') {
            throw new Error('词库文件 locals.js 未加载，脚本无法运行');
        }

        await loadFeatureSet();
        watchFeatureChanges();
        setupReactGlobalNavTranslation();

        // 设置中文环境
        if (FeatureSet.enable_extension) {
            document.documentElement.lang = CONFIG.LANG;
        }

        // 监测 HTML Lang 值, 设置中文环境
        new MutationObserver(() => {
            if (FeatureSet.enable_extension && document.documentElement.lang === 'en') {
                document.documentElement.lang = CONFIG.LANG;
            }
        }).observe(document.documentElement, { attributeFilter: ['lang'] });

        // 监听 Turbo 完成事件（延迟翻译）
        document.addEventListener('turbo:load', () => {
            updatePageConfig('turbo:load');
            scheduleIssuePrTranslationControls('turbo:load');
            scheduleCollaborationHelperControls('turbo:load');
            scheduleTldrCapsuleControls('turbo:load');
            scheduleReadmeTranslation('turbo:load');
            if (!FeatureSet.enable_extension || !pageConfig.currentPageType) return;

            // 软导航后必须全量扫描；仅靠 title/selector 会漏掉仓库顶栏等 React 文案
            scheduleTurboPageTranslation();
        });
        document.addEventListener('turbo:render', () => refreshAfterHistoryNavigation('turbo:render'));
        document.addEventListener('turbo:frame-load', () => {
            scheduleIssuePrTranslationControls('turbo:frame-load');
            scheduleCollaborationHelperControls('turbo:frame-load');
            scheduleTldrCapsuleControls('turbo:frame-load');
            scheduleReadmeTranslation('turbo:frame-load');
        });
        window.addEventListener('popstate', scheduleHistoryRefresh);
        window.addEventListener('pageshow', event => {
            if (event.persisted) scheduleHistoryRefresh(event);
        });

        // 首次页面翻译
        window.addEventListener('DOMContentLoaded', () => {
            // 获取当前页面的翻译规则
            updatePageConfig('首次载入');
            if (FeatureSet.enable_extension && pageConfig.currentPageType) {
                traverseNode(document.body);
            }

            // 监视页面变化
            watchUpdate();
            watchReactHydration();
            scheduleReadmeTranslation('DOMContentLoaded');
            scheduleIssuePrTranslationControls('DOMContentLoaded');
            scheduleCollaborationHelperControls('DOMContentLoaded');
            scheduleTldrCapsuleControls('DOMContentLoaded');
        });
    }

