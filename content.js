(function () {
  'use strict';

  const STORAGE_DEFAULTS = {
    enable_extension: true
  };

  const FeatureSet = { ...STORAGE_DEFAULTS };

  const CONFIG = {
    lang: 'zh-CN',
    observer: {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title', 'value']
    },
    ignoreSelectors: [
      'code',
      'pre',
      'script',
      'style',
      'textarea',
      '[contenteditable="true"]',
      '[translate="no"]',
      '.notranslate'
    ].join(', '),
    dictionaries: [
      'dicts/common/base.json',
      'dicts/pages/cloudkit-console.json',
      'dicts/pages/account-resources-certificates-list.json',
      'dicts/pages/account-resources-identifiers-list.json',
      'dicts/pages/account-resources-devices-list.json',
      'dicts/pages/account-resources-profiles-list.json',
      'dicts/pages/account-resources-keys-list.json',
      'dicts/pages/account-resources-services-list.json'
    ]
  };

  const state = {
    dicts: [],
    activeDicts: [],
    loaded: false,
    page: null,
    routeKey: ''
  };

  function setDebugStatus(status, extra = {}) {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-apple-dev-cn', status);
    if (state.page) root.setAttribute('data-apple-dev-cn-page', state.page);
    if (state.routeKey) root.setAttribute('data-apple-dev-cn-route', state.routeKey);
    if (typeof extra.dictCount === 'number') {
      root.setAttribute('data-apple-dev-cn-dicts', String(extra.dictCount));
    }
    if (extra.reason) {
      root.setAttribute('data-apple-dev-cn-reason', String(extra.reason));
    }
  }

  init().catch((err) => {
    console.error('[apple-dev-cn] init failed', err);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'refresh-page') {
      window.location.reload();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes.enable_extension) return;
    FeatureSet.enable_extension = Boolean(changes.enable_extension.newValue);
    window.location.reload();
  });

  async function init() {
    setDebugStatus('booting');
    await loadFeatureSet();
    if (!FeatureSet.enable_extension) {
      setDebugStatus('disabled', { reason: 'feature-toggle-off' });
      return;
    }
    if (!isSupportedPage()) {
      setDebugStatus('unsupported', { reason: 'not-supported-page' });
      return;
    }
    state.routeKey = getRouteKey();
    state.page = getPageType();
    installRouteWatchers();
    document.documentElement.lang = CONFIG.lang;
    state.dicts = await loadDictionaries();
    refreshActiveDicts();
    state.loaded = true;
    setDebugStatus('active', { dictCount: state.dicts.length });
    translateNode(document.body || document.documentElement);
    watchMutations();
  }

  function installRouteWatchers() {
    let lastPath = getRouteKey();

    const onRouteMaybeChanged = () => {
      const currentPath = getRouteKey();
      if (currentPath === lastPath) return;
      lastPath = currentPath;
      handleRouteChanged();
    };

    // In extension isolated world, overriding history methods is not always reliable
    // for framework route changes in page world; polling route key is the robust fallback.
    setInterval(onRouteMaybeChanged, 300);
    window.addEventListener('popstate', onRouteMaybeChanged);
    window.addEventListener('hashchange', onRouteMaybeChanged);
  }

  function getRouteKey() {
    return location.pathname + location.search + location.hash;
  }

  function syncRouteState() {
    const key = getRouteKey();
    if (key === state.routeKey) return false;
    state.routeKey = key;
    state.page = getPageType();
    return true;
  }

  function handleRouteChanged() {
    const changed = syncRouteState();
    if (changed) refreshActiveDicts();
    setDebugStatus('active', { dictCount: state.dicts.length });

    // Some Apple pages render in async phases; do multiple passes.
    const rerun = () => translateNode(document.body || document.documentElement);
    rerun();
    setTimeout(rerun, 80);
    setTimeout(rerun, 300);
    setTimeout(rerun, 800);
  }

  async function loadFeatureSet() {
    const result = await chrome.storage.sync.get(STORAGE_DEFAULTS);
    Object.assign(FeatureSet, result);
  }

  function isSupportedPage() {
    if (!/\.?developer\.apple\.com$/.test(location.hostname)) return false;
    const path = location.pathname || '/';
    if (path.startsWith('/account/')) return true;
    if (path.startsWith('/cloudkit-console/')) return true;
    if (path.startsWith('/cloudkit/')) return true;
    return location.hostname !== 'developer.apple.com';
  }

  function getPageType() {
    if (location.hostname !== 'developer.apple.com') return 'cloudkit-console';
    const p = location.pathname;
    if (/^\/account\/resources\/certificates(?:\/|$)/.test(p)) return 'account-resources-certificates';
    if (/^\/account\/resources\/identifiers(?:\/|$)/.test(p)) return 'account-resources-identifiers';
    if (/^\/account\/resources\/devices(?:\/|$)/.test(p)) return 'account-resources-devices';
    if (/^\/account\/resources\/profiles(?:\/|$)/.test(p)) return 'account-resources-profiles';
    if (/^\/account\/resources\/keys(?:\/|$)/.test(p)) return 'account-resources-keys';
    if (/^\/account\/resources\/authkeys(?:\/|$)/.test(p)) return 'account-resources-keys';
    if (/^\/account\/resources\/services(?:\/|$)/.test(p)) return 'account-resources-services';
    return 'account-generic';
  }

  async function loadDictionaries() {
    const out = [];
    for (const file of CONFIG.dictionaries) {
      try {
        const url = chrome.runtime.getURL(file);
        const res = await fetch(url);
        if (!res.ok) continue;
        const dict = await res.json();
        prepareDictionary(dict);
        out.push(dict);
      } catch (e) {
        console.warn('[apple-dev-cn] failed to load dict', file, e);
      }
    }
    return out;
  }

  function prepareDictionary(dict) {
    if (!dict || typeof dict !== 'object') return;

    const staticMap = new Map();
    const staticMapLower = new Map();
    if (dict.static && typeof dict.static === 'object') {
      for (const [source, target] of Object.entries(dict.static)) {
        const key = normalize(source);
        if (!key || typeof target !== 'string') continue;
        staticMap.set(key, target);
        staticMapLower.set(key.toLowerCase(), target);
      }
    }
    dict._staticMap = staticMap;
    dict._staticMapLower = staticMapLower;

    if (Array.isArray(dict.regexp)) {
      dict._regexpCompiled = dict.regexp
        .map((rule) => {
          try {
            return {
              ...rule,
              _re: new RegExp(rule.pattern, rule.flags || '')
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } else {
      dict._regexpCompiled = [];
    }
  }

  function refreshActiveDicts() {
    state.activeDicts = state.dicts.filter((dict) => scopeMatch(dict.scope));
  }

  function watchMutations() {
    const observer = new MutationObserver((mutations) => {
      if (!state.loaded) return;
      const changed = syncRouteState();
      if (changed) refreshActiveDicts();
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            translateNode(node);
          }
        } else if (m.type === 'characterData') {
          translateTextNode(m.target);
        } else if (m.type === 'attributes') {
          translateElementAttributes(m.target);
        }
      }
    });

    const root = document.body || document.documentElement;
    observer.observe(root, CONFIG.observer);
  }

  function translateNode(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(CONFIG.ignoreSelectors)) return;

    translateElementAttributes(root);

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(CONFIG.ignoreSelectors)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let current;
    while ((current = walker.nextNode())) {
      if (current.nodeType === Node.TEXT_NODE) {
        translateTextNode(current);
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        translateElementAttributes(current);
      }
    }
  }

  function translateElementAttributes(el) {
    applyTranslation(el, 'placeholder');
    applyTranslation(el, 'ariaLabel');
    applyTranslation(el, 'title');

    if (el.tagName === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') {
        applyTranslation(el, 'value');
      }
    }
  }

  function translateTextNode(node) {
    if (!node || !node.data) return;
    if (node.data.length > 2000) return;

    const translated = translateText(node.data, node.parentElement || null);
    if (translated && translated !== node.data) {
      node.data = translated;
    }
  }

  function applyTranslation(target, field) {
    const source = target[field];
    if (!source || typeof source !== 'string') return;

    const translated = translateText(source, target);
    if (translated && translated !== source) {
      target[field] = translated;
    }
  }

  function translateText(text, contextEl) {
    const normalized = normalize(text);
    if (!normalized) return null;
    if (shouldSkip(normalized)) return null;

    const translated = findTranslation(normalized, contextEl);
    if (!translated || translated === normalized) return null;
    // If original text contains line breaks/indentation, `normalized` may not be
    // a direct substring of `text`; in that case replace the core content safely.
    if (text.includes(normalized)) {
      return text.replace(normalized, translated);
    }
    const m = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m) return translated;
    return `${m[1]}${translated}${m[3]}`;
  }

  function normalize(text) {
    return String(text).replace(/\u00a0|\s+/g, ' ').trim();
  }

  function shouldSkip(text) {
    if (!/[A-Za-z]/.test(text)) return true;
    if (/^[\d\s.,:;()/%+-]+$/.test(text)) return true;
    return false;
  }

  function findTranslation(text, contextEl) {
    for (const dict of state.activeDicts) {
      if (!dict) continue;

      if (dict.selectorRules && Array.isArray(dict.selectorRules)) {
        for (const rule of dict.selectorRules) {
          if (!rule || rule.source !== text || !rule.target) continue;
          if (!rule.selector) return rule.target;
          if (!contextEl) continue;
          if (contextEl.matches?.(rule.selector) || contextEl.closest?.(rule.selector)) {
            return rule.target;
          }
        }
      }

      const staticHit = dict._staticMap?.get(text);
      if (typeof staticHit === 'string') {
        return staticHit;
      }

      const staticHitLower = dict._staticMapLower?.get(text.toLowerCase());
      if (typeof staticHitLower === 'string') {
        return staticHitLower;
      }

      if (Array.isArray(dict._regexpCompiled)) {
        for (const rule of dict._regexpCompiled) {
          const replaced = text.replace(rule._re, rule.replacement);
          if (replaced !== text) return replaced;
        }
      }
    }

    return null;
  }

  function scopeMatch(scope) {
    if (!scope) return true;
    if (scope.page && scope.page !== state.page) return false;
    if (scope.pathPrefix && !location.pathname.startsWith(scope.pathPrefix)) return false;
    return true;
  }
})();
