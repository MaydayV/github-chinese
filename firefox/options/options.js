'use strict';

const DEFAULTS = {
  enable_readme_translation: false,
  enable_issue_pr_translation: false,
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
  readme_openai_model: 'gpt-4.1-mini',
  readme_qwen_mt_api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  readme_qwen_mt_api_key: '',
  readme_qwen_mt_model: 'qwen-mt-turbo',
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

const AI_CHAT_PROVIDERS = ['openai', 'openai_compatible', 'deepseek', 'qwen', 'minimax', 'kimi', 'zhipu', 'volcengine'];

const AI_PROVIDER_DEFAULTS = {
  openai: { apiUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  deepseek: { apiUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  qwen: { apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-flash' },
  minimax: { apiUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7-highspeed' },
  kimi: { apiUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6' },
  zhipu: { apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
  volcengine: { apiUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-flash-250615' },
};

let LAST_SAVED_VALUES = { ...DEFAULTS };
const FIXED_TARGET_LANG = 'zh-CN';

function byId(id) {
  return document.getElementById(id);
}

function getStatusEl() {
  return byId('status');
}

function updateStatusElement(el, message, type = '') {
  if (!el) return;

  el.textContent = message || '';
  el.classList.toggle('is-success', type === 'success');
  el.classList.toggle('is-error', type === 'error');
}

function setStatus(message, type = '') {
  updateStatusElement(getStatusEl(), message, type);
}

function setTestStatus(message, type = '') {
  updateStatusElement(byId('testStatus'), message, type);
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

function isAnyAiTranslationEnabled(values) {
  return Boolean(values.enable_readme_translation || values.enable_issue_pr_translation);
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
  const normalizedProvider = AI_CHAT_PROVIDERS.includes(provider) ? 'ai_chat' : provider;
  document.querySelectorAll('.provider').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.provider === normalizedProvider);
  });
}

function getAiProviderDefaults(provider) {
  return AI_PROVIDER_DEFAULTS[provider] ? { ...AI_PROVIDER_DEFAULTS[provider] } : null;
}

function getQwenMtDefaults() {
  return {
    apiUrl: DEFAULTS.readme_qwen_mt_api_url,
    model: DEFAULTS.readme_qwen_mt_model,
  };
}

function applyProviderDefaultsToValues(values) {
  const provider = (values.readme_provider || '').trim().toLowerCase();
  const nextValues = { ...values };

  if (provider === 'qwen_mt') {
    const defaults = getQwenMtDefaults();
    nextValues.readme_qwen_mt_api_url = defaults.apiUrl;
    nextValues.readme_qwen_mt_model = defaults.model;
    return nextValues;
  }

  const defaults = getAiProviderDefaults(provider);
  if (!defaults) return nextValues;

  nextValues.readme_openai_api_url = defaults.apiUrl;
  nextValues.readme_openai_model = defaults.model;
  return nextValues;
}

function getAiProviderLabel(provider) {
  const labels = {
    openai: 'OpenAI 官方接口',
    openai_compatible: 'OpenAI 兼容接口',
    deepseek: 'DeepSeek',
    qwen: 'Qwen 对话模型',
    minimax: 'MiniMax',
    kimi: 'Kimi',
    zhipu: '智谱 GLM',
    volcengine: '火山方舟',
  };
  return labels[provider] || 'AI 对话接口';
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\s+/g, '');
}

function parseApiUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function getProviderDefaultBasePath(hostname) {
  if (hostname === 'api.deepseek.com') return '';
  if (/^dashscope(?:-(?:us|intl|finance))?\.aliyuncs\.com$/i.test(hostname)) return '/compatible-mode/v1';
  if (hostname === 'open.bigmodel.cn') return '/api/paas/v4';
  if (/^ark\.[^.]+\.volces\.com$/i.test(hostname)) return '/api/v3';
  if (
    hostname === 'api.openai.com'
    || hostname === 'api.minimaxi.com'
    || hostname === 'api.minimax.io'
    || hostname === 'api.moonshot.ai'
  ) {
    return '/v1';
  }

  return '/v1';
}

function getProviderHost(url) {
  return parseApiUrl(url)?.hostname.toLowerCase() || '';
}

function isDeepSeekEndpoint(url) {
  return getProviderHost(url) === 'api.deepseek.com';
}

function isQwenEndpoint(url) {
  return /^dashscope(?:-(?:us|intl|finance))?\.aliyuncs\.com$/i.test(getProviderHost(url));
}

function isMiniMaxEndpoint(url) {
  const host = getProviderHost(url);
  return host === 'api.minimaxi.com' || host === 'api.minimax.io';
}

function isKimiEndpoint(url) {
  return getProviderHost(url) === 'api.moonshot.ai';
}

function isZhipuEndpoint(url) {
  return getProviderHost(url) === 'open.bigmodel.cn';
}

function normalizeOpenAiEndpoint(url) {
  if (!url) return '';

  const parsedUrl = parseApiUrl(url);
  if (!parsedUrl) return url;

  const hostname = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(path)) {
    return `${parsedUrl.origin}${path}`;
  }

  if (!path) {
    return `${parsedUrl.origin}${getProviderDefaultBasePath(hostname)}/chat/completions`;
  }

  return `${parsedUrl.origin}${path}/chat/completions`;
}

function applyOpenAiCompatibleRequestOptions(payload, config) {
  if (!payload) return payload;

  if (isDeepSeekEndpoint(config?.url) || isKimiEndpoint(config?.url)) {
    payload.stream = false;
    payload.thinking = { type: 'disabled' };
  } else if (isQwenEndpoint(config?.url)) {
    payload.stream = false;
    payload.enable_thinking = false;
  } else if (isMiniMaxEndpoint(config?.url)) {
    payload.stream = false;
    payload.reasoning_split = true;
  } else if (isZhipuEndpoint(config?.url)) {
    payload.stream = false;
    payload.thinking = { type: 'disabled' };
    payload.do_sample = false;
  }
  return payload;
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
    case 'qwen_mt': {
      const url = normalizeOpenAiEndpoint(normalizeUrl(values.readme_qwen_mt_api_url));
      const key = (values.readme_qwen_mt_api_key || '').trim();
      const model = (values.readme_qwen_mt_model || '').trim();
      if (!url || !key || !model) {
        return { ok: false, message: 'Qwen-MT 需要 API 地址、API Key 和模型名。' };
      }
      return { ok: true, provider, targetLang, url, key, model };
    }
    case 'openai':
    case 'openai_compatible':
    case 'deepseek':
    case 'qwen':
    case 'minimax':
    case 'kimi':
    case 'zhipu':
    case 'volcengine': {
      const url = normalizeOpenAiEndpoint(normalizeUrl(values.readme_openai_api_url));
      const key = (values.readme_openai_api_key || '').trim();
      const model = (values.readme_openai_model || '').trim();
      if (!url || !key || !model) {
        return { ok: false, message: `${getAiProviderLabel(provider)}需要 API 地址、API Key 和模型名。` };
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
  if (request) {
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

  return {
    ok: false,
    message: `尚未授权访问 ${origin.hostLabel}。请在“翻译接口”点击“保存设置”或“测试连通性”完成授权。`,
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
  }

  if (resetAdvancedWhenEnable) {
    advancedSwitchKeys.forEach((key) => {
      nextValues[key] = false;
    });
  }

  if (requireApiConfig && isAnyAiTranslationEnabled(nextValues)) {
    const providerResult = getProviderConfig(nextValues);
    if (!providerResult.ok) {
      return {
        ok: false,
        values: nextValues,
        message: `请先填写并保存有效的翻译接口设置后再启用内容翻译功能。${providerResult.message}`,
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

async function savePartialValues(values) {
  await chrome.storage.sync.set(values);
  LAST_SAVED_VALUES = { ...LAST_SAVED_VALUES, ...values };
}

async function loadValues() {
  const rawValues = await chrome.storage.sync.get(DEFAULTS);
  const ruled = enforceFeatureSwitchRules(rawValues, { requireApiConfig: false });
  let normalized = ruled.values;

  if (isAnyAiTranslationEnabled(normalized)) {
    const permission = await ensureProviderHostPermission(normalized, { request: false });
    if (!permission.ok) {
      normalized = enforceFeatureSwitchRules(
        { ...normalized, enable_readme_translation: false, enable_issue_pr_translation: false },
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
  body.append('target_lang', mapTargetLangForDeepL());
  body.append('text', '翻译接口连通性测试。');

  const data = await proxyFetchJson({
    url: config.url,
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${config.key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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
  body.append('q', '翻译接口连通性测试。');

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
    body: JSON.stringify([{ text: '翻译接口连通性测试。' }]),
  });

  if (!Array.isArray(data) || !data[0]?.translations?.[0]?.text) {
    throw new Error('Azure 响应格式异常。');
  }
}

async function testOpenAiCompatible(config) {
  const payload = {
    model: config.model,
    temperature: 0,
    max_tokens: 32,
    messages: [
      { role: 'system', content: '你是连通性检查器，只回复 OK。' },
      { role: 'user', content: '连通性测试' },
    ],
  };
  applyOpenAiCompatibleRequestOptions(payload, config);

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

async function testQwenMt(config) {
  const data = await proxyFetchJson({
    url: config.url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: '翻译接口连通性测试。' }],
      translation_options: {
        source_lang: 'auto',
        target_lang: 'Chinese',
      },
    }),
  });

  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content ?? choice?.text;
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || '').join('')
    : String(content || '').trim();

  if (!text) {
    throw new Error('Qwen-MT 未返回有效翻译内容。');
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
    case 'qwen_mt':
      await testQwenMt(config);
      return 'Qwen-MT 连通性正常。';
    case 'openai':
    case 'openai_compatible':
    case 'deepseek':
    case 'qwen':
    case 'minimax':
    case 'kimi':
    case 'zhipu':
    case 'volcengine':
      await testOpenAiCompatible(config);
      return `${getAiProviderLabel(config.provider)}连通性正常。`;
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

  let match = text.match(/^(?:nodes|translated_nodes|discussion_translated_nodes|issue_translated_nodes|pull_translated_nodes|release_translated_nodes)=(\d+)$/i);
  if (match) return `翻译文本节点：${match[1]}`;

  if (text === 'discussion_cache_hit') return '命中讨论内容缓存';
  if (/^(?:issue|pull|release)_cache_hit$/i.test(text)) return '命中正文缓存';

  match = text.match(/^(?:reason|cache_reason|trigger)=(.+)$/i);
  if (match) return `触发来源：${match[1]}`;

  return text;
}

function normalizeRecordSourceType(sourceType) {
  const value = String(sourceType || '').trim().toLowerCase();
  if (value === 'issue' || value === 'pull' || value === 'release' || value === 'readme') return value;
  return 'readme';
}

function getRecordSourceMeta(sourceType) {
  const value = normalizeRecordSourceType(sourceType);
  const map = {
    readme: { label: 'README', className: 'is-readme' },
    issue: { label: 'Issue', className: 'is-issue' },
    pull: { label: 'Pull Request', className: 'is-pull' },
    release: { label: 'Release', className: 'is-release' },
  };
  return map[value];
}

function normalizeRecords(records) {
  const list = Array.isArray(records) ? records : [];

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || ''),
      repo: String(item.repo || 'unknown/unknown'),
      sourceType: normalizeRecordSourceType(item.sourceType),
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

function createRecordSpan(text, className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

function createRecordListItem(item) {
  const meta = getStatusMeta(item.status);
  const sourceMeta = getRecordSourceMeta(item.sourceType);
  const detailText = formatRecordDetail(item.detail);
  const repoUrl = buildRepoUrl(item.repo);

  const itemEl = document.createElement('li');
  itemEl.className = 'history-item';

  const topEl = document.createElement('div');
  topEl.className = 'history-top';

  if (repoUrl) {
    const linkEl = document.createElement('a');
    linkEl.className = 'history-repo-link';
    linkEl.href = repoUrl;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = item.repo || '';
    topEl.append(linkEl);
  } else {
    topEl.append(createRecordSpan(item.repo || '', 'history-repo'));
  }

  const badgesEl = document.createElement('span');
  badgesEl.className = 'history-badges';
  badgesEl.append(
    createRecordSpan(sourceMeta.label, `history-source ${sourceMeta.className}`.trim()),
    createRecordSpan(meta.label, `history-status ${meta.className}`.trim())
  );
  topEl.append(badgesEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'history-meta';
  metaEl.append(
    createRecordSpan(`Tokens：${formatNumber(item.tokens)}`),
    createRecordSpan(`时间：${formatTime(item.createdAt)}`),
    createRecordSpan(`服务：${item.provider || '-'}`)
  );
  if (detailText) metaEl.append(createRecordSpan(detailText));

  itemEl.append(topEl, metaEl);
  return itemEl;
}

function renderRecords() {
  const listEl = byId('recordsList');
  const summaryEl = byId('recordsSummary');
  const pagerEl = byId('recordsPager');
  const pageInfoEl = byId('recordsPageInfo');
  const prevEl = byId('recordsPrev');
  const nextEl = byId('recordsNext');
  const clearRecordsEl = byId('clearRecords');
  const clearRepoCacheEl = byId('clearRepoCache');

  if (!listEl || !summaryEl || !pagerEl || !pageInfoEl || !prevEl || !nextEl) return;

  const allRecords = RECORDS_STATE.records;
  const cacheEntries = RECORDS_STATE.cacheEntries;
  const totalPages = getRecordsPageCount();
  const currentPage = clampRecordsPage(RECORDS_STATE.page);
  RECORDS_STATE.page = currentPage;

  if (clearRecordsEl) clearRecordsEl.disabled = allRecords.length === 0;
  if (clearRepoCacheEl) clearRepoCacheEl.disabled = cacheEntries.length === 0;

  if (!allRecords.length) {
    const emptyEl = document.createElement('li');
    emptyEl.className = 'history-empty';
    emptyEl.textContent = '暂无翻译记录，开启“记录翻译消耗”后会自动累积。';
    listEl.replaceChildren(emptyEl);
    summaryEl.textContent = `暂无记录。当前缓存条目：${cacheEntries.length}`;
    pagerEl.hidden = true;
    pageInfoEl.textContent = '';
    prevEl.disabled = true;
    nextEl.disabled = true;
    return;
  }

  const tokenTotal = allRecords.reduce((sum, item) => sum + (Number.isFinite(item.tokens) ? item.tokens : 0), 0);
  summaryEl.textContent = `共 ${allRecords.length} 条记录，累计 tokens：${formatNumber(tokenTotal)}，缓存条目：${cacheEntries.length}`;

  const start = (currentPage - 1) * RECORDS_STATE.pageSize;
  const end = start + RECORDS_STATE.pageSize;
  const pagedRecords = allRecords.slice(start, end);

  listEl.replaceChildren(...pagedRecords.map(createRecordListItem));

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
    const nextValues = applyProviderDefaultsToValues(collectValues());
    applyValues(nextValues);
    setStatus('');
    setTestStatus('');
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
        setStatus('请先在“翻译接口”中保存可用配置，再开启 README 翻译。', 'error');
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

      try {
        applyValues(ruled.values);
        await savePartialValues({
          enable_readme_translation: true,
          readme_enable_token_record: false,
          readme_enable_repo_cache: false,
          readme_enable_progressive: false,
        });
        setStatus('README 翻译已开启。高级功能默认关闭，可按需手动开启。', 'success');
      } catch (error) {
        console.error(error);
        applyValues(LAST_SAVED_VALUES);
        updateAdvancedSwitchUi(Boolean(LAST_SAVED_VALUES.enable_readme_translation));
        setStatus('保存 README 翻译设置失败，请重试。', 'error');
      }
      return;
    }

    const ruled = enforceFeatureSwitchRules(values, { requireApiConfig: false });
    try {
      applyValues(ruled.values);
      await savePartialValues({
        enable_readme_translation: false,
        readme_enable_token_record: false,
        readme_enable_repo_cache: false,
        readme_enable_progressive: false,
      });
      setStatus('README 翻译已关闭，相关高级开关已自动关闭。', 'success');
    } catch (error) {
      console.error(error);
      applyValues(LAST_SAVED_VALUES);
      updateAdvancedSwitchUi(Boolean(LAST_SAVED_VALUES.enable_readme_translation));
      setStatus('保存 README 翻译设置失败，请重试。', 'error');
    }
  });

  const issuePrSwitch = byId('enable_issue_pr_translation');
  issuePrSwitch?.addEventListener('change', async () => {
    const values = collectValues();

    if (values.enable_issue_pr_translation) {
      const ruled = enforceFeatureSwitchRules(values, { requireApiConfig: true });
      if (!ruled.ok) {
        issuePrSwitch.checked = false;
        setStatus(ruled.message, 'error');
        return;
      }

      const savedConfig = getProviderConfig(LAST_SAVED_VALUES);
      if (!savedConfig.ok) {
        issuePrSwitch.checked = false;
        setStatus('请先在“翻译接口”中保存可用配置，再开启正文翻译。', 'error');
        return;
      }

      try {
        const permission = await ensureProviderHostPermission(LAST_SAVED_VALUES, { request: false });
        if (!permission.ok) {
          issuePrSwitch.checked = false;
          setStatus(permission.message, 'error');
          return;
        }
      } catch (error) {
        console.error(error);
        issuePrSwitch.checked = false;
        setStatus('读取接口权限失败，请重新点击“保存设置”或“测试连通性”。', 'error');
        return;
      }

      applyValues(ruled.values);
      await savePartialValues({ enable_issue_pr_translation: true });
      setStatus('正文翻译已开启并保存。进入 Issue、PR 或 Release 页面后，可手动翻译当前内容。', 'success');
      return;
    }

    await savePartialValues({ enable_issue_pr_translation: false });
    setStatus('正文翻译已关闭并保存。', 'success');
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

      const providerConfig = getProviderConfig(ruled.values);
      if (providerConfig.ok) {
        const permission = await ensureProviderHostPermission(ruled.values, { request: true });
        if (!permission.ok) {
          setStatus(permission.message, 'error');
          return;
        }
      }

      applyValues(ruled.values);
      await saveValues(ruled.values);
      setStatus(
        providerConfig.ok
          ? '设置已保存。接口域名权限已就绪，可点击“测试连通性”进一步验证。'
          : '设置已保存。',
        'success',
      );
    } catch (error) {
      console.error(error);
      setStatus('保存失败，请检查输入内容或稍后重试。', 'error');
    }
  });

  byId('testConnection')?.addEventListener('click', async () => {
    try {
      setStatus('');
      setTestStatus('正在测试连通性，请稍候...');
      const values = collectValues();
      const permission = await ensureProviderHostPermission(values, { request: true });
      if (!permission.ok) {
        setTestStatus(permission.message, 'error');
        return;
      }
      const message = await testProviderConnection(values);
      setTestStatus(`测试成功：${message}`, 'success');
    } catch (error) {
      console.error(error);
      setTestStatus(`测试失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  });

  document.querySelectorAll('[data-reset-readme-defaults]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await chrome.storage.sync.set({ ...DEFAULTS });
        LAST_SAVED_VALUES = { ...DEFAULTS };
        applyValues({ ...DEFAULTS });
        setStatus('内容翻译设置已恢复默认值。', 'success');
      } catch (error) {
        console.error(error);
        setStatus('恢复默认值失败，请稍后重试。', 'error');
      }
    });
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
