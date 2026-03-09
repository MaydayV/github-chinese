'use strict';

const DEFAULTS = {
  enable_readme_translation: false,
  readme_enable_token_record: false,
  readme_enable_repo_cache: false,
  readme_enable_progressive: false,
  readme_provider: 'deepl',
  readme_deepl_api_url: 'https://api-free.deepl.com/v2/translate',
  readme_deepl_api_key: '',
  readme_google_api_url: 'https://translation.googleapis.com/language/translate/v2',
  readme_google_api_key: '',
  readme_azure_api_url: 'https://api.cognitive.microsofttranslator.com/translate',
  readme_azure_api_key: '',
  readme_azure_region: '',
  readme_openai_api_url: 'https://api.openai.com/v1/chat/completions',
  readme_openai_api_key: '',
  readme_openai_model: 'gpt-4o-mini',
};

const LOCAL_STORAGE_KEYS = {
  TRANSLATION_RECORDS: 'ghcn_readme_translation_records',
  REPO_CACHE: 'ghcn_readme_repo_cache',
};

const ADVANCED_SWITCH_KEYS = [
  'readme_enable_token_record',
  'readme_enable_repo_cache',
  'readme_enable_progressive',
];

const RECORD_STATUS_META = {
  success: { label: '翻译成功', className: 'is-success' },
  cache_hit: { label: '缓存命中', className: 'is-cache' },
  failed: { label: '翻译失败', className: 'is-failed' },
};

const RECORDS_STATE = {
  records: [],
  cacheEntries: [],
  page: 1,
  pageSize: 8,
};

let LAST_SAVED_VALUES = { ...DEFAULTS };
const FIXED_TARGET_LANG = 'zh-CN';

function byId(id) {
  return document.getElementById(id);
}

function getStatusEl() {
  return byId('status');
}

function setStatus(message, type = '') {
  const el = getStatusEl();
  if (!el) return;

  el.textContent = message || '';
  el.classList.toggle('is-success', type === 'success');
  el.classList.toggle('is-error', type === 'error');
}

function collectValues() {
  return Object.keys(DEFAULTS).reduce((result, key) => {
    const el = byId(key);
    if (!el) return result;

    if (el.type === 'checkbox') {
      result[key] = el.checked;
      return result;
    }

    result[key] = (el.value || '').trim();
    return result;
  }, {});
}

function updateAdvancedSwitchUi(mainEnabled) {
  ADVANCED_SWITCH_KEYS.forEach((key) => {
    const input = byId(key);
    if (!input) return;
    const row = input.closest('.switch-row');
    input.disabled = !mainEnabled;
    row?.classList.toggle('is-disabled', !mainEnabled);

    if (!mainEnabled) {
      input.checked = false;
    }
  });
}

function applyValues(values) {
  Object.keys(DEFAULTS).forEach((key) => {
    const el = byId(key);
    if (!el) return;

    const value = values[key];
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
      return;
    }

    el.value = typeof value === 'string' ? value : '';
  });

  refreshProviderPanel(values.readme_provider || DEFAULTS.readme_provider);
  updateAdvancedSwitchUi(Boolean(values.enable_readme_translation));
}

function refreshProviderPanel(provider) {
  document.querySelectorAll('.provider').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.provider === provider);
  });
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\s+/g, '');
}

function normalizeOpenAiEndpoint(url) {
  if (!url) return '';

  if (/\/chat\/completions\/?$/i.test(url)) return url;
  if (/\/v1\/?$/i.test(url)) return `${url.replace(/\/+$/, '')}/chat/completions`;
  return `${url.replace(/\/+$/, '')}/v1/chat/completions`;
}

function mapTargetLangForDeepL() {
  return 'ZH';
}

function mapTargetLangForAzure() {
  return 'zh-Hans';
}

function getProviderConfig(values) {
  const provider = (values.readme_provider || '').trim().toLowerCase();
  const targetLang = FIXED_TARGET_LANG;

  if (!provider) {
    return { ok: false, message: '请先选择翻译服务。' };
  }

  switch (provider) {
    case 'deepl': {
      const url = normalizeUrl(values.readme_deepl_api_url);
      const key = (values.readme_deepl_api_key || '').trim();
      if (!url || !key) {
        return { ok: false, message: 'DeepL 需要 API 地址和 API Key。' };
      }
      return { ok: true, provider, targetLang, url, key };
    }
    case 'google': {
      const url = normalizeUrl(values.readme_google_api_url);
      const key = (values.readme_google_api_key || '').trim();
      if (!url || !key) {
        return { ok: false, message: 'Google 需要 API 地址和 API Key。' };
      }
      return { ok: true, provider, targetLang, url, key };
    }
    case 'azure': {
      const url = normalizeUrl(values.readme_azure_api_url);
      const key = (values.readme_azure_api_key || '').trim();
      const region = (values.readme_azure_region || '').trim();
      if (!url || !key || !region) {
        return { ok: false, message: 'Azure 需要 API 地址、API Key 和 Region。' };
      }
      return { ok: true, provider, targetLang, url, key, region };
    }
    case 'openai': {
      const url = normalizeOpenAiEndpoint(normalizeUrl(values.readme_openai_api_url));
      const key = (values.readme_openai_api_key || '').trim();
      const model = (values.readme_openai_model || '').trim();
      if (!url || !key || !model) {
        return { ok: false, message: 'OpenAI 兼容接口需要 API 地址、API Key 和模型名。' };
      }
      return { ok: true, provider, targetLang, url, key, model };
    }
    default:
      return { ok: false, message: `不支持的服务类型：${provider}` };
  }
}

function getApiOriginPattern(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, message: 'API 地址格式无效，请填写完整 URL。' };
  }

  const protocol = String(parsedUrl.protocol || '').toLowerCase();
  const hostname = String(parsedUrl.hostname || '').toLowerCase();
  const isLocalHttp = protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1');

  if (protocol !== 'https:' && !isLocalHttp) {
    return { ok: false, message: '为降低权限风险，API 地址仅支持 HTTPS（localhost/127.0.0.1 可用 HTTP）。' };
  }

  return {
    ok: true,
    originPattern: `${parsedUrl.protocol}//${parsedUrl.host}/*`,
    hostLabel: parsedUrl.host,
  };
}

function permissionsContains(origins) {
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins }, (granted) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function permissionsRequest(origins) {
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins }, (granted) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

async function ensureProviderHostPermission(values, options = {}) {
  const { request = false } = options;
  const config = getProviderConfig(values);
  if (!config.ok) {
    return { ok: false, message: config.message };
  }

  const origin = getApiOriginPattern(config.url);
  if (!origin.ok) {
    return { ok: false, message: origin.message };
  }

  const origins = [origin.originPattern];
  const alreadyGranted = await permissionsContains(origins);
  if (alreadyGranted) {
    return {
      ok: true,
      config,
      hostLabel: origin.hostLabel,
      originPattern: origin.originPattern,
      grantedByRequest: false,
    };
  }

  if (!request) {
    return {
      ok: false,
      message: `尚未授权访问 ${origin.hostLabel}。请在“API 设置”点击“保存设置”或“测试连通性”完成授权。`,
    };
  }

  const granted = await permissionsRequest(origins);
  if (!granted) {
    return {
      ok: false,
      message: `你未授予 ${origin.hostLabel} 的访问权限，无法调用该翻译接口。`,
    };
  }

  return {
    ok: true,
    config,
    hostLabel: origin.hostLabel,
    originPattern: origin.originPattern,
    grantedByRequest: true,
  };
}

function enforceFeatureSwitchRules(values, options = {}) {
  const { requireApiConfig = true, resetAdvancedWhenEnable = false } = options;
  const nextValues = { ...values };
  const advancedSwitchKeys = [
    'readme_enable_token_record',
    'readme_enable_repo_cache',
    'readme_enable_progressive',
  ];

  if (!nextValues.enable_readme_translation) {
    advancedSwitchKeys.forEach((key) => {
      nextValues[key] = false;
    });
    return { ok: true, values: nextValues, message: '' };
  }

  if (resetAdvancedWhenEnable) {
    advancedSwitchKeys.forEach((key) => {
      nextValues[key] = false;
    });
  }

  if (requireApiConfig) {
    const providerResult = getProviderConfig(nextValues);
    if (!providerResult.ok) {
      return {
        ok: false,
        values: nextValues,
        message: `请先填写并保存有效的 API 设置后再启用 README 翻译。${providerResult.message}`,
      };
    }
  }

  return { ok: true, values: nextValues, message: '' };
}

function hasSettingDifference(a, b) {
  return Object.keys(DEFAULTS).some((key) => {
    return a[key] !== b[key];
  });
}

async function saveValues(values) {
  await chrome.storage.sync.set(values);
  LAST_SAVED_VALUES = { ...values };
}

async function loadValues() {
  const rawValues = await chrome.storage.sync.get(DEFAULTS);
  const ruled = enforceFeatureSwitchRules(rawValues, { requireApiConfig: false });
  let normalized = ruled.values;

  if (normalized.enable_readme_translation) {
    const permission = await ensureProviderHostPermission(normalized, { request: false });
    if (!permission.ok) {
      normalized = enforceFeatureSwitchRules(
        { ...normalized, enable_readme_translation: false },
        { requireApiConfig: false },
      ).values;
    }
  }

  LAST_SAVED_VALUES = { ...normalized };

  applyValues(normalized);

  if (hasSettingDifference(rawValues, normalized)) {
    await chrome.storage.sync.set(normalized);
  }
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text || '';
  return `${text.slice(0, maxLength)}...`;
}

async function proxyFetchJson(request) {
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'ghcn-proxy-fetch',
        payload: request,
      },
      (message) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(message);
      },
    );
  });

  if (!response) {
    throw new Error('后台未返回响应。');
  }

  const { ok, status, statusText, body, error } = response;
  if (!ok) {
    const details = body ? truncateText(body, 180) : (error || 'unknown error');
    throw new Error(`HTTP ${status} ${statusText} - ${details}`);
  }

  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`返回非 JSON 数据：${truncateText(body, 150)}`);
  }
}

async function testDeepL(config) {
  const body = new URLSearchParams();
  body.append('auth_key', config.key);
  body.append('target_lang', mapTargetLangForDeepL());
  body.append('text', 'README translation connectivity test.');

  const data = await proxyFetchJson({
    url: config.url,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!Array.isArray(data?.translations) || !data.translations[0]?.text) {
    throw new Error('DeepL 响应格式异常。');
  }
}

async function testGoogle(config) {
  const url = new URL(config.url);
  url.searchParams.set('key', config.key);

  const body = new URLSearchParams();
  body.append('target', config.targetLang);
  body.append('format', 'text');
  body.append('q', 'README translation connectivity test.');

  const data = await proxyFetchJson({
    url: url.toString(),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!Array.isArray(data?.data?.translations) || !data.data.translations[0]?.translatedText) {
    throw new Error('Google 响应格式异常。');
  }
}

async function testAzure(config) {
  const url = new URL(config.url);
  url.searchParams.set('api-version', '3.0');
  url.searchParams.set('to', mapTargetLangForAzure());

  const data = await proxyFetchJson({
    url: url.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Ocp-Apim-Subscription-Key': config.key,
      'Ocp-Apim-Subscription-Region': config.region,
      'X-ClientTraceId': crypto?.randomUUID?.() || String(Date.now()),
    },
    body: JSON.stringify([{ text: 'README translation connectivity test.' }]),
  });

  if (!Array.isArray(data) || !data[0]?.translations?.[0]?.text) {
    throw new Error('Azure 响应格式异常。');
  }
}

async function testOpenAiCompatible(config) {
  const payload = {
    model: config.model,
    temperature: 0,
    max_tokens: 16,
    messages: [
      { role: 'system', content: 'You are a connectivity checker. Reply with exactly OK.' },
      { role: 'user', content: 'Connection test' },
    ],
  };

  const data = await proxyFetchJson({
    url: config.url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify(payload),
  });

  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content ?? choice?.text;
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || '').join('')
    : String(content || '').trim();

  if (!text) {
    throw new Error('OpenAI 兼容接口未返回有效内容。');
  }
}

async function testProviderConnection(values) {
  const config = getProviderConfig(values);
  if (!config.ok) {
    throw new Error(config.message);
  }

  switch (config.provider) {
    case 'deepl':
      await testDeepL(config);
      return 'DeepL 连通性正常。';
    case 'google':
      await testGoogle(config);
      return 'Google Cloud Translation 连通性正常。';
    case 'azure':
      await testAzure(config);
      return 'Azure Translator 连通性正常。';
    case 'openai':
      await testOpenAiCompatible(config);
      return 'OpenAI 兼容接口连通性正常。';
    default:
      throw new Error(`未知 provider: ${config.provider}`);
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';

  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0';
  return number.toLocaleString('zh-CN');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRepoUrl(repoFullName) {
  const match = String(repoFullName || '').trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return '';

  return `https://github.com/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
}

function formatRecordDetail(detail) {
  const text = String(detail || '').trim();
  if (!text) return '';

  let match = text.match(/^(?:nodes|translated_nodes)=(\d+)$/i);
  if (match) return `翻译文本节点：${match[1]}`;

  match = text.match(/^(?:reason|cache_reason|trigger)=(.+)$/i);
  if (match) return `触发来源：${match[1]}`;

  return text;
}

function normalizeRecords(records) {
  const list = Array.isArray(records) ? records : [];

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || ''),
      repo: String(item.repo || 'unknown/unknown'),
      status: String(item.status || 'success'),
      tokens: Math.max(0, Number(item.tokens) || 0),
      provider: String(item.provider || ''),
      createdAt: Number(item.createdAt || 0),
      detail: String(item.detail || ''),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeCacheEntries(cacheEntries) {
  const list = Array.isArray(cacheEntries) ? cacheEntries : [];
  return list.filter((item) => item && typeof item === 'object' && typeof item.key === 'string');
}

function getStatusMeta(status) {
  return RECORD_STATUS_META[status] || { label: status || '未知状态', className: '' };
}

function getRecordsPageCount() {
  return Math.max(1, Math.ceil(RECORDS_STATE.records.length / RECORDS_STATE.pageSize));
}

function clampRecordsPage(page) {
  const totalPages = getRecordsPageCount();
  return Math.min(Math.max(1, page), totalPages);
}

function setRecordsPage(page) {
  RECORDS_STATE.page = clampRecordsPage(page);
  renderRecords();
}

function renderRecords() {
  const listEl = byId('recordsList');
  const summaryEl = byId('recordsSummary');
  const pagerEl = byId('recordsPager');
  const pageInfoEl = byId('recordsPageInfo');
  const prevEl = byId('recordsPrev');
  const nextEl = byId('recordsNext');

  if (!listEl || !summaryEl || !pagerEl || !pageInfoEl || !prevEl || !nextEl) return;

  const allRecords = RECORDS_STATE.records;
  const cacheEntries = RECORDS_STATE.cacheEntries;
  const totalPages = getRecordsPageCount();
  const currentPage = clampRecordsPage(RECORDS_STATE.page);
  RECORDS_STATE.page = currentPage;

  if (!allRecords.length) {
    listEl.innerHTML = '<li class="history-empty">暂无翻译记录，开启“记录翻译消耗”后会自动累积。</li>';
    summaryEl.textContent = `暂无记录。当前缓存条目：${cacheEntries.length}`;
    pagerEl.hidden = true;
    return;
  }

  const tokenTotal = allRecords.reduce((sum, item) => sum + (Number.isFinite(item.tokens) ? item.tokens : 0), 0);
  summaryEl.textContent = `共 ${allRecords.length} 条记录，累计 tokens：${formatNumber(tokenTotal)}，缓存条目：${cacheEntries.length}`;

  const start = (currentPage - 1) * RECORDS_STATE.pageSize;
  const end = start + RECORDS_STATE.pageSize;
  const pagedRecords = allRecords.slice(start, end);

  listEl.innerHTML = pagedRecords.map((item) => {
    const meta = getStatusMeta(item.status);
    const providerText = item.provider ? escapeHtml(item.provider) : '-';
    const detailText = formatRecordDetail(item.detail);
    const detail = detailText ? `<span>详情：${escapeHtml(detailText)}</span>` : '';
    const repoText = escapeHtml(item.repo);
    const repoUrl = buildRepoUrl(item.repo);
    const repoHtml = repoUrl
      ? `<a class="history-repo-link" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${repoText}</a>`
      : `<span class="history-repo">${repoText}</span>`;

    return `
      <li class="history-item">
        <div class="history-top">
          ${repoHtml}
          <span class="history-status ${meta.className}">${meta.label}</span>
        </div>
        <div class="history-meta">
          <span>Tokens：${formatNumber(item.tokens)}</span>
          <span>时间：${formatTime(item.createdAt)}</span>
          <span>服务：${providerText}</span>
          ${detail}
        </div>
      </li>
    `;
  }).join('');

  pagerEl.hidden = totalPages <= 1;
  pageInfoEl.textContent = `${currentPage} / ${totalPages}`;
  prevEl.disabled = currentPage <= 1;
  nextEl.disabled = currentPage >= totalPages;
}

async function refreshRecordsView() {
  const data = await chrome.storage.local.get({
    [LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS]: [],
    [LOCAL_STORAGE_KEYS.REPO_CACHE]: [],
  });

  RECORDS_STATE.records = normalizeRecords(data[LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS]);
  RECORDS_STATE.cacheEntries = normalizeCacheEntries(data[LOCAL_STORAGE_KEYS.REPO_CACHE]);
  RECORDS_STATE.page = clampRecordsPage(RECORDS_STATE.page);

  renderRecords();
}

async function clearTranslationRecords() {
  await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS]: [] });
}

async function clearRepoCache() {
  await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.REPO_CACHE]: [] });
}

function setActiveTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    const isActive = button.dataset.tabTarget === tabId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.tabPanel === tabId);
  });
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tabTarget || 'features');
      setStatus('');
    });
  });

  const providerEl = byId('readme_provider');
  providerEl?.addEventListener('change', () => {
    refreshProviderPanel(providerEl.value);
    setStatus('');
  });

  const mainSwitch = byId('enable_readme_translation');
  mainSwitch?.addEventListener('change', async () => {
    const values = collectValues();

    if (values.enable_readme_translation) {
      const ruled = enforceFeatureSwitchRules(values, {
        requireApiConfig: true,
        resetAdvancedWhenEnable: true,
      });

      if (!ruled.ok) {
        mainSwitch.checked = false;
        updateAdvancedSwitchUi(false);
        setStatus(ruled.message, 'error');
        return;
      }

      const savedConfig = getProviderConfig(LAST_SAVED_VALUES);
      if (!savedConfig.ok) {
        mainSwitch.checked = false;
        updateAdvancedSwitchUi(false);
        setStatus('请先在“API 设置”中保存可用配置，再开启 README 翻译。', 'error');
        return;
      }

      try {
        const permission = await ensureProviderHostPermission(LAST_SAVED_VALUES, { request: false });
        if (!permission.ok) {
          mainSwitch.checked = false;
          updateAdvancedSwitchUi(false);
          setStatus(permission.message, 'error');
          return;
        }
      } catch (error) {
        console.error(error);
        mainSwitch.checked = false;
        updateAdvancedSwitchUi(false);
        setStatus('读取接口权限失败，请重新点击“保存设置”或“测试连通性”。', 'error');
        return;
      }

      applyValues(ruled.values);
      setStatus('README 翻译已开启。高级功能默认关闭，可按需手动开启。');
      return;
    }

    const ruled = enforceFeatureSwitchRules(values, { requireApiConfig: false });
    applyValues(ruled.values);
    setStatus('README 翻译已关闭，相关高级开关已自动关闭。');
  });

  ADVANCED_SWITCH_KEYS.forEach((key) => {
    byId(key)?.addEventListener('change', () => {
      if (!byId('enable_readme_translation')?.checked) {
        const el = byId(key);
        if (el) el.checked = false;
        setStatus('请先开启 README 翻译。', 'error');
      }
    });
  });

  byId('settingsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const values = collectValues();
      const ruled = enforceFeatureSwitchRules(values, { requireApiConfig: true });
      if (!ruled.ok) {
        setStatus(ruled.message, 'error');
        return;
      }

      const permission = await ensureProviderHostPermission(ruled.values, { request: true });
      if (!permission.ok) {
        setStatus(permission.message, 'error');
        return;
      }

      applyValues(ruled.values);
      await saveValues(ruled.values);
      setStatus('设置已保存。接口域名权限已就绪，可点击“测试连通性”进一步验证。', 'success');
    } catch (error) {
      console.error(error);
      setStatus('保存失败，请检查输入内容或稍后重试。', 'error');
    }
  });

  byId('testConnection')?.addEventListener('click', async () => {
    try {
      setStatus('正在测试连通性，请稍候...');
      const values = collectValues();
      const permission = await ensureProviderHostPermission(values, { request: true });
      if (!permission.ok) {
        setStatus(permission.message, 'error');
        return;
      }
      const message = await testProviderConnection(values);
      setStatus(`测试成功：${message}`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(`测试失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  });

  byId('resetReadmeDefaults')?.addEventListener('click', async () => {
    try {
      await chrome.storage.sync.set({ ...DEFAULTS });
      LAST_SAVED_VALUES = { ...DEFAULTS };
      applyValues({ ...DEFAULTS });
      setStatus('README 翻译设置已恢复默认值。', 'success');
    } catch (error) {
      console.error(error);
      setStatus('恢复默认值失败，请稍后重试。', 'error');
    }
  });

  byId('refreshRecords')?.addEventListener('click', async () => {
    try {
      await refreshRecordsView();
      setStatus('翻译记录已刷新。', 'success');
    } catch (error) {
      console.error(error);
      setStatus('刷新翻译记录失败。', 'error');
    }
  });

  byId('clearRecords')?.addEventListener('click', async () => {
    try {
      await clearTranslationRecords();
      RECORDS_STATE.page = 1;
      await refreshRecordsView();
      setStatus('翻译记录已清空。', 'success');
    } catch (error) {
      console.error(error);
      setStatus('清空记录失败。', 'error');
    }
  });

  byId('clearRepoCache')?.addEventListener('click', async () => {
    try {
      await clearRepoCache();
      await refreshRecordsView();
      setStatus('仓库翻译缓存已清空。', 'success');
    } catch (error) {
      console.error(error);
      setStatus('清空缓存失败。', 'error');
    }
  });

  byId('recordsPrev')?.addEventListener('click', () => {
    setRecordsPage(RECORDS_STATE.page - 1);
  });

  byId('recordsNext')?.addEventListener('click', () => {
    setRecordsPage(RECORDS_STATE.page + 1);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      const changedKeys = Object.keys(changes);
      if (!changedKeys.some((key) => key in DEFAULTS)) return;

      const nextValues = collectValues();
      changedKeys.forEach((key) => {
        if (!(key in DEFAULTS)) return;
        nextValues[key] = changes[key].newValue;
        LAST_SAVED_VALUES[key] = changes[key].newValue;
      });

      const ruled = enforceFeatureSwitchRules(nextValues, { requireApiConfig: false });
      applyValues(ruled.values);
      return;
    }

    if (areaName === 'local') {
      if (changes[LOCAL_STORAGE_KEYS.TRANSLATION_RECORDS] || changes[LOCAL_STORAGE_KEYS.REPO_CACHE]) {
        refreshRecordsView().catch((error) => {
          console.error(error);
        });
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  setActiveTab('features');
  Promise.all([loadValues(), refreshRecordsView()]).catch((error) => {
    console.error(error);
    setStatus('设置加载失败。', 'error');
  });
});
