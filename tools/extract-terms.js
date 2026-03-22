/*
  在目标页面 DevTools Console 执行：
  copy(JSON.stringify(window.__APPLE_DEV_CN_EXTRACT_TERMS__(), null, 2))
*/
(function () {
  const OPT = {
    minLength: 2,
    maxLength: 500,
    maxSamples: 3
  };
  const IGNORE_SELECTOR = [
    'script',
    'style',
    'code',
    'pre',
    'textarea',
    '[contenteditable="true"]',
    'noscript',
    '.team-name',
    '.user-name',
    '[class*="team-name"]',
    '[class*="user-name"]'
  ].join(',');

  function normalize(text) {
    return String(text || '').replace(/\u00a0|\s+/g, ' ').trim();
  }

  function looksLikeBundleId(text) {
    return /^(?:[A-Za-z0-9-]+\.){1,}[A-Za-z0-9._-]+$/.test(text);
  }

  function looksLikeEntitlementKey(text) {
    return /^(?:com|aps|inter)-[A-Za-z0-9._-]+$/.test(text) || /^com\.[A-Za-z0-9._-]+$/.test(text);
  }

  function looksLikeContainerId(text) {
    return /^(?:iCloud|group)\.[A-Za-z0-9._-]+$/i.test(text);
  }

  function looksLikeUdid(text) {
    return /^[A-Fa-f0-9-]{16,}$/.test(text);
  }

  function looksLikeTeamSuffix(text) {
    return /^\-\s*[A-Z0-9]{6,}$/.test(text);
  }

  function isLikelyPersonalName(text) {
    return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(text);
  }

  function shouldSkip(text) {
    if (!text) return true;
    if (text.length < OPT.minLength || text.length > OPT.maxLength) return true;
    if (!/[A-Za-z]/.test(text)) return true;
    if (/^[\d\s.,:;()/%+-]+$/.test(text)) return true;
    if (looksLikeBundleId(text)) return true;
    if (looksLikeEntitlementKey(text)) return true;
    if (looksLikeContainerId(text)) return true;
    if (looksLikeUdid(text)) return true;
    if (looksLikeTeamSuffix(text)) return true;
    if (isLikelyPersonalName(text)) return true;
    if (text === 'You need to enable JavaScript to run this app.') return true;
    return false;
  }

  function collect() {
    const map = new Map();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const parent = n.parentElement;
      if (!parent) continue;
      if (parent.closest(IGNORE_SELECTOR)) continue;

      const t = normalize(n.data);
      if (shouldSkip(t)) continue;

      const c = map.get(t) || { text: t, count: 0, samples: [] };
      c.count += 1;
      if (c.samples.length < OPT.maxSamples) {
        c.samples.push(parent.tagName.toLowerCase() + (parent.className ? '.' + String(parent.className).split(' ').slice(0, 2).join('.') : ''));
      }
      map.set(t, c);
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  function collectAttrs() {
    const out = new Map();
    const attrNames = ['placeholder', 'title', 'aria-label'];
    const nodes = document.querySelectorAll('[placeholder],[title],[aria-label]');

    for (const el of nodes) {
      for (const attr of attrNames) {
        const raw = el.getAttribute(attr);
        const t = normalize(raw);
        if (shouldSkip(t)) continue;

        const key = `${attr}::${t}`;
        const c = out.get(key) || { attr, text: t, count: 0, samples: [] };
        c.count += 1;
        if (c.samples.length < OPT.maxSamples) {
          c.samples.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''));
        }
        out.set(key, c);
      }
    }

    return Array.from(out.values()).sort((a, b) => b.count - a.count);
  }

  function collectFull() {
    return {
      textNodes: collect(),
      attrs: collectAttrs()
    };
  }

  window.__APPLE_DEV_CN_EXTRACT_TERMS__ = collect;
  window.__APPLE_DEV_CN_EXTRACT_TERMS_FULL__ = collectFull;
})();
