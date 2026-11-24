'use strict';
if (typeof importScripts === 'function') importScripts('maintenance-tools.js');
let uiMissWriteQueue = Promise.resolve();
let lastUiMissClearedAt = 0;

const HOMEPAGE_URL = 'https://maydayv.github.io/github-chinese/';
const ALLOWED_GITHUB_HOSTS = new Set([
  'github.com',
  'gist.github.com',
  'skills.github.com',
  'education.github.com',
  'www.githubstatus.com',
]);
const ALLOWED_PROXY_HEADERS = new Set([
  'content-type',
  'authorization',
  'ocp-apim-subscription-key',
  'ocp-apim-subscription-region',
  'x-clienttraceid',
  'accept',
]);
const PROXY_TIMEOUT_MS = 45000;
const PROXY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SYNC_URL_SETTINGS = {
  readme_provider: 'index_translate',
  readme_deepl_api_url: 'https://api-free.deepl.com/v2/translate',
  readme_google_api_url: 'https://translation.googleapis.com/language/translate/v2',
  readme_azure_api_url: 'https://api.cognitive.microsofttranslator.com/translate',
  readme_qwen_mt_api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
  readme_openai_api_url: 'https://api.deepseek.com',
};

function isAllowedSender(sender, { optionsOnly = false } = {}) {
  const runtimeId = chrome?.runtime?.id;
  if (!runtimeId) return true;
  if (!sender || sender.id !== runtimeId) return false;

  const senderUrl = typeof sender.url === 'string'
    ? sender.url
    : (typeof sender.origin === 'string' ? `${sender.origin}/` : '');
  const optionsPrefix = typeof chrome?.runtime?.getURL === 'function' ? chrome.runtime.getURL('options/') : '';
  const extensionPrefix = typeof chrome?.runtime?.getURL === 'function' ? chrome.runtime.getURL('') : '';

  if (optionsOnly) {
    return optionsPrefix ? senderUrl.startsWith(optionsPrefix) : true;
  }

  if (extensionPrefix && senderUrl.startsWith(extensionPrefix)) {
    return true;
  }

  try {
    const parsed = new URL(senderUrl);
    return parsed.protocol === 'https:' && ALLOWED_GITHUB_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isTrustedOptionsSender(sender) {
  const runtimeId = chrome?.runtime?.id;
  if (!runtimeId) return true;
  if (!sender || sender.id !== runtimeId) return false;

  const senderUrl = typeof sender.url === 'string'
    ? sender.url
    : (typeof sender.origin === 'string' ? `${sender.origin}/` : '');
  const optionsPrefix = typeof chrome?.runtime?.getURL === 'function' ? chrome.runtime.getURL('options/') : '';
  if (optionsPrefix && senderUrl.startsWith(optionsPrefix)) {
    return true;
  }
  return !sender?.tab && !senderUrl;
}

function getSenderPathname(sender) {
  try {
    const parsed = new URL(String(sender?.url || ''));
    return parsed.protocol === 'https:' ? parsed.pathname : '';
  } catch {
    return '';
  }
}

function validateProxyUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('接口地址格式无效。');
  }
  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const isLocalHttp = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');
  if (protocol !== 'https:' && !isLocalHttp) {
    throw new Error('仅允许请求 HTTPS 或 localhost/127.0.0.1 HTTP 接口地址。');
  }
  return {
    parsed,
    originPattern: `${protocol}//${hostname}/*`,
  };
}

function sanitizeProxyHeaders(rawHeaders) {
  const clean = {};
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    return clean;
  }
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value !== 'string') continue;
    if (!ALLOWED_PROXY_HEADERS.has(key.toLowerCase())) continue;
    clean[key] = value;
  }
  return clean;
}

function getActiveSyncProviderUrl(syncValues) {
  const provider = String(syncValues?.readme_provider || 'index_translate').trim().toLowerCase();
  if (provider === 'deepl') return syncValues?.readme_deepl_api_url || '';
  if (provider === 'google') return syncValues?.readme_google_api_url || '';
  if (provider === 'azure') return syncValues?.readme_azure_api_url || '';
  if (provider === 'qwen_mt') return syncValues?.readme_qwen_mt_api_url || '';
  if (provider === 'index_translate') return syncValues?.readme_index_translate_api_url || '';
  return syncValues?.readme_openai_api_url || '';
}

function checkHostPermission(originPattern) {
  if (typeof chrome?.permissions?.contains !== 'function') {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: [originPattern] }, (granted) => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(granted));
      });
    } catch {
      resolve(false);
    }
  });
}

async function isOriginConfiguredInSync(targetOrigin) {
  if (!chrome?.storage?.sync?.get) return true;
  const syncValues = await chrome.storage.sync.get(DEFAULT_SYNC_URL_SETTINGS);
  const activeUrl = String(getActiveSyncProviderUrl(syncValues) || '').trim().replace(/\s+/g, '');
  try {
    return new URL(activeUrl).origin === targetOrigin;
  } catch {
    return false;
  }
}

async function readResponseTextWithLimit(response, maxBytes = PROXY_MAX_RESPONSE_BYTES) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('接口响应体积过大，已中止读取。');
  }

  if (response?.body && typeof response.body.getReader === 'function' && typeof TextDecoder === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          try { await reader.cancel(); } catch { /* 忽略取消错误 */ }
          throw new Error('接口响应体积过大，已中止读取。');
        }
        chunks.push(decoder.decode(chunk, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } finally {
      try { reader.releaseLock?.(); } catch { /* 忽略锁释放错误 */ }
    }
  }

  const text = await response.text();
  const byteLength = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : text.length;
  if (byteLength > maxBytes) {
    throw new Error('接口响应体积过大，已中止读取。');
  }
  return text;
}

function getProxyHtmlErrorMessage({ url, status, body, contentType }) {
  const text = String(body || '').trimStart();
  const isHtml = /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text)
    || (/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType || '') && text.startsWith('<'));
  if (!isHtml) return '';

  const reason = status === 412
    ? '上游服务拒绝了请求，返回 HTML 页面而非翻译 API 数据。'
    : '接口返回 HTML 页面而非翻译 API 数据，请检查 API 地址及网络状态。';
  let hint = '';
  try {
    if (new URL(url).hostname === 'index-translate.bilibili.com') {
      hint = '请先启动本地托盘代理（或运行 python call_api.py --serve），并将 API 地址填为 http://127.0.0.1:8080/v1。';
    }
  } catch {
    // 无效 URL 由原有请求错误路径处理。
  }
  return `HTTP ${status}：${reason}${hint}`;
}

function changelogUrl(version) {
  return `${HOMEPAGE_URL}#v${version.replace(/\./g, '-')}`;
}

async function showUpdateBadge() {
  await chrome.action.setBadgeBackgroundColor({ color: '#1f883d' });
  await chrome.action.setBadgeText({ text: '新' });
}

// 商店安装的插件由浏览器自动更新，这里只在更新装好之后留一条「看看改了什么」的提示，
// 不主动抢标签页。提示状态由 popup 消费并清除。
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason !== 'update') return;

  const version = chrome.runtime.getManifest().version;
  if (!version || version === previousVersion) return;

  await chrome.storage.local.set({
    update_notice: { version, previousVersion, url: changelogUrl(version) },
  });
  await showUpdateBadge();
});

// 角标不跨浏览器重启保留，重启后按未读状态补回
chrome.runtime.onStartup.addListener(async () => {
  const { update_notice: notice } = await chrome.storage.local.get('update_notice');
  if (notice?.version) await showUpdateBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ghcn-ui-misses') {
    if (!isAllowedSender(sender, { optionsOnly: Boolean(message.clear) })) {
      sendResponse({ ok: false, error: 'FORBIDDEN' });
      return true;
    }
    const capturedAt = Number(message.capturedAt) || 0;
    const senderPathname = getSenderPathname(sender);
    uiMissWriteQueue = uiMissWriteQueue.catch(() => {}).then(async () => {
      if (message.clear) {
        lastUiMissClearedAt = Date.now();
        await chrome.storage.local.set({ [GhcnMaintenance.MISS_KEY]: [] });
      } else {
        if (capturedAt > 0 && capturedAt < lastUiMissClearedAt) return;
        const enabled = await chrome.storage.sync.get({ collect_ui_misses: false });
        if (!enabled.collect_ui_misses) return;
        const stored = await chrome.storage.local.get(GhcnMaintenance.MISS_KEY);
        const map = new Map();
        const mergeRow = (row, isExisting) => {
          if (!row || !/^[a-z0-9/_-]{1,100}$/i.test(row.page || '') || typeof row.text !== 'string') return;
          if (!GhcnMaintenance.collectable(row.text, isExisting ? '' : senderPathname)) return;
          const text = GhcnMaintenance.normalize(row.text);
          if (!text) return;
          const key = row.page + '\n' + text;
          if (map.size >= 2000 && !map.has(key)) return;
          const old = map.get(key);
          const countDelta = isExisting
            ? Math.min(1000000, Math.max(1, Math.floor(Number(row.count) || 1)))
            : Math.min(1000, Math.max(1, Math.floor(Number(row.count) || 1)));
          map.set(key, {
            page: row.page,
            text,
            count: Math.min(1000000, (old?.count || 0) + countDelta),
          });
        };
        for (const existing of (Array.isArray(stored[GhcnMaintenance.MISS_KEY]) ? stored[GhcnMaintenance.MISS_KEY] : [])) mergeRow(existing, true);
        for (const row of (Array.isArray(message.rows) ? message.rows : []).slice(0, 200)) mergeRow(row, false);
        await chrome.storage.local.set({ [GhcnMaintenance.MISS_KEY]: [...map.values()] });
      }
    });
    uiMissWriteQueue.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type !== 'ghcn-proxy-fetch') return false;

  (async () => {
    if (!isAllowedSender(sender)) {
      sendResponse({
        ok: false,
        status: 403,
        statusText: 'FORBIDDEN',
        body: '',
        error: '拒绝来自未受信任来源的代理请求。',
      });
      return;
    }

    let timeoutId = 0;
    let parsedUrl = null;
    try {
      const payload = message.payload || {};
      const method = String(payload.method || 'POST').trim().toUpperCase();
      if (method !== 'POST') {
        sendResponse({
          ok: false,
          status: 405,
          statusText: 'METHOD_NOT_ALLOWED',
          body: '',
          error: '代理仅支持 POST 请求。',
        });
        return;
      }

      const { parsed, originPattern } = validateProxyUrl(payload.url);
      parsedUrl = parsed;
      if (!(await checkHostPermission(originPattern))) {
        sendResponse({
          ok: false,
          status: 403,
          statusText: 'PERMISSION_DENIED',
          body: '',
          error: '未授予该接口域名权限，请先在插件设置页保存并授权。',
        });
        return;
      }

      if (!isTrustedOptionsSender(sender) && !(await isOriginConfiguredInSync(parsed.origin))) {
        sendResponse({
          ok: false,
          status: 403,
          statusText: 'ORIGIN_NOT_CONFIGURED',
          body: '',
          error: '目标域名与当前保存的翻译服务配置不一致。',
        });
        return;
      }

      const headers = sanitizeProxyHeaders(payload.headers);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller && typeof setTimeout === 'function') {
        timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
      }

      const fetchOptions = {
        method: 'POST',
        headers,
        body: typeof payload.body === 'string' ? payload.body : undefined,
        credentials: 'omit',
        redirect: 'error',
      };
      if (controller) fetchOptions.signal = controller.signal;

      const response = await fetch(parsed.href, fetchOptions);
      const text = await readResponseTextWithLimit(response);
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: text,
        userMessage: getProxyHtmlErrorMessage({
          url: parsed.href,
          status: response.status,
          body: text,
          contentType: response.headers.get('content-type'),
        }),
      });
    } catch (error) {
      const isTimeout = error?.name === 'AbortError';
      const isLocalHttp = parsedUrl?.protocol === 'http:' && (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost');
      const rawErr = error instanceof Error ? error.message : String(error);
      const localHint = isLocalHttp
        ? '（无法连接本地代理，请先启动 Win/macOS 本地托盘代理或运行 python call_api.py --serve，并在代理软件中放行 127.0.0.1/localhost）'
        : '';
      sendResponse({
        ok: false,
        status: isTimeout ? 408 : 0,
        statusText: isTimeout ? 'TIMEOUT' : 'FETCH_FAILED',
        body: '',
        error: isTimeout
          ? '请求超时（超过 45 秒），请检查网络或接口服务状态。'
          : `${rawErr}${localHint}`,
      });
    } finally {
      if (timeoutId && typeof clearTimeout === 'function') {
        clearTimeout(timeoutId);
      }
    }
  })();

  return true;
});
