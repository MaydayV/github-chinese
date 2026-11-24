#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

for (const browser of ['chrome', 'edge', 'firefox']) {
  const optionsHtml = fs.readFileSync(path.resolve(__dirname, `../${browser}/options/options.html`), 'utf8');
  assert.match(optionsHtml, /<form[^>]*\bid="settingsForm"[^>]*\bnovalidate\b/, `${browser} settingsForm 应声明 novalidate`);
}

const optionsPath = path.resolve(__dirname, '../chrome/options/options.js');
const source = fs.readFileSync(optionsPath, 'utf8');

for (const edgeOrFirefox of ['edge', 'firefox']) {
  const otherSource = fs.readFileSync(path.resolve(__dirname, `../${edgeOrFirefox}/options/options.js`), 'utf8');
  assert.strictEqual(otherSource, source, `${edgeOrFirefox} options.js 应与 chrome 保持一致`);
}

assert.match(source, /originPattern:\s*`\$\{protocol\}\/\/\$\{hostname\}\/\*`/, '权限 originPattern 应去掉端口以兼容 Firefox');

const {
  normalizeUrl,
  normalizeOpenAiEndpoint,
  getProviderConfig,
  enforceFeatureSwitchRules,
  buildRepoUrl,
  formatRecordDetail,
  getRecordSourceMeta,
  getStatusMeta,
} = (() => {
  const sandbox = {
    console,
    Intl,
    Date,
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    chrome: {
      storage: {
        sync: {
          get: async () => ({}),
          set: async () => {},
        },
        local: {
          get: async () => ({}),
          set: async () => {},
        },
        onChanged: { addListener: () => {} },
      },
      runtime: { sendMessage: () => {} },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\nthis.__exports = { normalizeUrl, normalizeOpenAiEndpoint, getProviderConfig, enforceFeatureSwitchRules, buildRepoUrl, formatRecordDetail, getRecordSourceMeta, getStatusMeta };`, sandbox);
  return sandbox.__exports;
})();

assert.strictEqual(
  buildRepoUrl('karpathy/autoresearch'),
  'https://github.com/karpathy/autoresearch',
  '仓库名应转成 GitHub URL',
);

assert.strictEqual(
  formatRecordDetail('nodes=63'),
  '已翻译节点：63',
  'nodes 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('about_translated_nodes=2'),
  '已翻译节点：2',
  'about_translated_nodes 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('about_cache_hit'),
  '命中简介缓存',
  'about_cache_hit 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('translated_nodes=30;retry_missed=51;remaining=48'),
  '已翻译节点：30；重试未翻译：51；剩余未翻译：48',
  '复合翻译详情不应直接显示内部字段名',
);

assert.strictEqual(
  formatRecordDetail('collab_mode=bug'),
  '润色模式：Bug 反馈',
  'collab_mode=bug 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('collab_mode=feature'),
  '润色模式：功能建议',
  'collab_mode=feature 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('tldr_generated'),
  '生成速读胶囊',
  'tldr_generated 详情应显示为可读中文',
);

assert.strictEqual(
  formatRecordDetail('tldr_cache_hit'),
  '命中速读缓存',
  'tldr_cache_hit 详情应显示为可读中文',
);

assert.strictEqual(getRecordSourceMeta('readme').label, '说明文档', 'README 来源应显示中文');
assert.strictEqual(getRecordSourceMeta('about').label, '仓库简介', 'About 来源应显示中文');
assert.strictEqual(getRecordSourceMeta('collab').label, '协作润色', '协作润色来源应显示中文');
assert.strictEqual(getRecordSourceMeta('tldr').label, '速读胶囊', '速读胶囊来源应显示中文');
assert.strictEqual(getStatusMeta('partial').label, '部分完成', 'partial 状态应显示中文');

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'builtin_ai',
  }).ok,
  false,
  '已移除的 builtin_ai 配置校验应返回 false',
);

{
  const { ok, values } = enforceFeatureSwitchRules({
    enable_readme_translation: false,
    readme_enable_token_record: true,
    readme_enable_repo_cache: true,
    readme_enable_progressive: true,
    readme_provider: 'openai',
    readme_openai_api_url: '',
    readme_openai_api_key: '',
    readme_openai_model: '',
    readme_target_lang: 'zh-CN',
  }, { requireApiConfig: false });
  assert.strictEqual(ok, true, '关闭主开关时应允许保存');
  assert.strictEqual(values.readme_enable_token_record, false, '主开关关闭时高级开关必须为 false');
  assert.strictEqual(values.readme_enable_repo_cache, false, '主开关关闭时高级开关必须为 false');
  assert.strictEqual(values.readme_enable_progressive, false, '主开关关闭时高级开关必须为 false');
}

{
  const { ok } = enforceFeatureSwitchRules({
    enable_readme_translation: true,
    readme_enable_token_record: false,
    readme_enable_repo_cache: false,
    readme_enable_progressive: false,
    readme_provider: 'openai',
    readme_openai_api_url: '',
    readme_openai_api_key: '',
    readme_openai_model: '',
    readme_target_lang: 'zh-CN',
  }, { requireApiConfig: true });
  assert.strictEqual(ok, false, '主开关启用但 API 未配置时应拒绝');
}

{
  const { ok, values } = enforceFeatureSwitchRules({
    enable_readme_translation: true,
    readme_enable_token_record: true,
    readme_enable_repo_cache: true,
    readme_enable_progressive: true,
    readme_provider: 'openai',
    readme_openai_api_url: 'https://api.openai.com',
    readme_openai_api_key: 'sk-demo',
    readme_openai_model: 'gpt-4o-mini',
    readme_target_lang: 'zh-CN',
  }, { requireApiConfig: true, resetAdvancedWhenEnable: true });
  assert.strictEqual(ok, true, 'API 正常时应允许开启');
  assert.strictEqual(values.readme_enable_token_record, false, '开启主开关时高级开关默认关闭');
  assert.strictEqual(values.readme_enable_repo_cache, false, '开启主开关时高级开关默认关闭');
  assert.strictEqual(values.readme_enable_progressive, false, '开启主开关时高级开关默认关闭');
}

{
  const { ok, values } = enforceFeatureSwitchRules({
    enable_readme_translation: true,
    enable_collaboration_helper: true,
    enable_repo_tldr: true,
    readme_provider: 'deepl',
    readme_deepl_api_url: 'https://api-free.deepl.com/v2/translate',
    readme_deepl_api_key: 'demo-key',
    readme_target_lang: 'zh-CN',
  }, { requireApiConfig: true });
  assert.strictEqual(ok, false, '非对话翻译服务不应启用协作润色或 AI 速读');
  assert.strictEqual(values.enable_collaboration_helper, false, '非对话服务应关闭协作润色开关');
  assert.strictEqual(values.enable_repo_tldr, false, '非对话服务应关闭 AI 速读开关');
}

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'openai',
    readme_openai_api_url: 'https://api.openai.com',
    readme_openai_api_key: 'sk-xx',
    readme_openai_model: 'gpt-4o-mini',
    readme_target_lang: 'zh-TW',
  }).ok,
  true,
  'OpenAI 兼容配置校验应通过',
);

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'openai',
    readme_openai_api_url: 'https://api.openai.com',
    readme_openai_api_key: 'sk-xx',
    readme_openai_model: 'gpt-4o-mini',
    readme_target_lang: 'zh-TW',
  }).targetLang,
  'zh-CN',
  '目标语言应固定为简体中文',
);

assert.strictEqual(
  normalizeOpenAiEndpoint('https://api.example.com/v1/chat/completions?api-version=2024-06-01'),
  'https://api.example.com/v1/chat/completions?api-version=2024-06-01',
  'normalizeOpenAiEndpoint 应保留查询参数',
);

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'index_translate',
    readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
    readme_index_translate_api_key: '',
    readme_index_translate_model: 'Index-Translate-35B-A3B',
  }).ok,
  true,
  'Bilibili Index-Translate 留空 API Key 时配置校验应通过',
);

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'index_translate',
    readme_index_translate_api_url: '',
    readme_index_translate_api_key: '',
    readme_index_translate_model: 'Index-Translate-35B-A3B',
  }).ok,
  false,
  'Bilibili Index-Translate 缺少 API 地址时应拒绝',
);

assert.strictEqual(
  getProviderConfig({
    readme_provider: 'index_translate',
    readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
    readme_index_translate_api_key: '',
    readme_index_translate_model: '',
  }).ok,
  false,
  'Bilibili Index-Translate 缺少模型名时应拒绝',
);

{
  const { ok, values } = enforceFeatureSwitchRules({
    enable_readme_translation: true,
    enable_issue_pr_translation: true,
    enable_collaboration_helper: true,
    enable_repo_tldr: true,
    readme_enable_token_record: false,
    readme_enable_repo_cache: false,
    readme_enable_progressive: false,
    readme_enable_debug: false,
    readme_provider: 'index_translate',
    readme_index_translate_api_url: 'http://127.0.0.1:8080/v1',
    readme_index_translate_api_key: '',
    readme_index_translate_model: 'Index-Translate-35B-A3B',
  }, { requireApiConfig: true });
  assert.strictEqual(ok, true, 'Bilibili Index-Translate 免 Key 时应允许开启全部内容翻译与 AI 对话功能');
  assert.strictEqual(values.enable_collaboration_helper, true);
  assert.strictEqual(values.enable_repo_tldr, true);
}

async function testOptionsFormStateAndUrlCollection() {
  const listeners = [];
  const syncStore = {
    enable_extension: true,
    enable_readme_translation: false,
    enable_collaboration_helper: false,
    enable_repo_tldr: false,
    readme_provider: 'deepseek',
    readme_openai_api_url: 'https://api.deepseek.com',
    readme_openai_api_key: '',
    readme_openai_model: 'deepseek-flash',
  };
  const inputs = {};
  const makeInput = (id, props = {}) => {
    const handlers = {};
    const node = {
      id,
      value: props.value ?? '',
      checked: Boolean(props.checked),
      type: props.type || 'text',
      disabled: false,
      textContent: '',
      classList: {
        _set: new Set(),
        toggle(cls, force) {
          if (force === undefined ? !this._set.has(cls) : force) this._set.add(cls);
          else this._set.delete(cls);
        },
        contains(cls) { return this._set.has(cls); },
      },
      closest: () => ({ classList: node.classList }),
      addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn); },
      dispatch: async (t) => {
        for (const fn of handlers[t] || []) {
          await fn({ preventDefault() {}, stopPropagation() {} });
        }
      },
    };
    inputs[id] = node;
    return node;
  };

  makeInput('status');
  makeInput('testStatus');
  makeInput('enable_extension', { type: 'checkbox', checked: true });
  makeInput('prefer_chinese_readme', { type: 'checkbox', checked: true });
  makeInput('collect_ui_misses', { type: 'checkbox', checked: false });
  makeInput('enable_readme_translation', { type: 'checkbox', checked: false });
  makeInput('enable_issue_pr_translation', { type: 'checkbox', checked: false });
  makeInput('enable_collaboration_helper', { type: 'checkbox', checked: false });
  makeInput('enable_repo_tldr', { type: 'checkbox', checked: false });
  makeInput('readme_enable_token_record', { type: 'checkbox', checked: false });
  makeInput('readme_enable_repo_cache', { type: 'checkbox', checked: false });
  makeInput('readme_enable_progressive', { type: 'checkbox', checked: false });
  makeInput('readme_enable_debug', { type: 'checkbox', checked: false });
  makeInput('readme_provider', { value: 'deepseek' });
  makeInput('readme_deepl_api_url', { value: 'https://api-free.deepl.com/v2/translate' });
  makeInput('readme_deepl_api_key', { value: '' });
  makeInput('readme_google_api_url', { value: 'https://translation.googleapis.com/language/translate/v2' });
  makeInput('readme_google_api_key', { value: '' });
  makeInput('readme_azure_api_url', { value: 'https://api.cognitive.microsofttranslator.com/translate' });
  makeInput('readme_azure_api_key', { value: '' });
  makeInput('readme_azure_region', { value: '' });
  makeInput('readme_openai_api_url', { value: '  https://api.deepseek.com/\n  v1  ' });
  makeInput('readme_openai_api_key', { value: '' });
  makeInput('readme_openai_model', { value: 'deepseek-flash' });
  makeInput('readme_qwen_mt_api_url', { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' });
  makeInput('readme_qwen_mt_api_key', { value: '' });
  makeInput('readme_qwen_mt_model', { value: 'qwen-mt-turbo' });
  makeInput('readme_index_translate_api_url', { value: 'http://127.0.0.1:8080/v1' });
  makeInput('readme_index_translate_api_key', { value: '' });
  makeInput('readme_index_translate_model', { value: 'Index-Translate-35B-A3B' });

  const makePanel = (provider) => {
    const set = new Set();
    return {
      dataset: { provider },
      classList: {
        toggle(cls, force) {
          if (force === undefined ? !set.has(cls) : force) set.add(cls);
          else set.delete(cls);
        },
        contains(cls) { return set.has(cls); },
      },
    };
  };
  const providerPanels = [makePanel('deepl'), makePanel('qwen_mt'), makePanel('index_translate'), makePanel('ai_chat')];

  const sandbox = {
    console, Intl, Date, URL, Promise, Set, Object, Array,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    document: {
      getElementById: (id) => inputs[id] || null,
      querySelectorAll: (sel) => (sel === '.provider' ? providerPanels : []),
      addEventListener: () => {},
    },
    chrome: {
      permissions: {
        contains: (_q, cb) => cb(true),
        request: (_q, cb) => cb(true),
      },
      storage: {
        sync: {
          get: async (defaults) => ({ ...defaults, ...syncStore }),
          set: async (vals) => { Object.assign(syncStore, vals); },
        },
        local: {
          get: async () => ({}),
          set: async () => {},
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
      runtime: { sendMessage: () => {} },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  // 1. collectValues 应剔除 *_api_url 内部空白字符
  const collected = sandbox.collectValues();
  assert.strictEqual(collected.readme_openai_api_url, 'https://api.deepseek.com/v1');

  // 1.5 默认配置下（未保存过 readme_provider）应默认选中 index_translate（哔哩哔哩翻译）
  delete syncStore.readme_provider;
  await sandbox.loadValues();
  assert.strictEqual(inputs.readme_provider.value, 'index_translate', '新配置应默认选中 index_translate');
  assert.strictEqual(providerPanels.find((p) => p.dataset.provider === 'index_translate').classList.contains('is-active'), true, '新配置应激活 index_translate 面板');

  // 2. mainSwitch 应基于 LAST_SAVED_VALUES 评估规则，而不是未保存的表单草稿
  syncStore.readme_provider = 'deepseek';
  await sandbox.loadValues();
  sandbox.bindEvents();
  inputs.readme_openai_api_key.value = 'sk-unsaved-draft-key';
  inputs.enable_readme_translation.checked = true;
  await inputs.enable_readme_translation.dispatch('change');
  assert.strictEqual(inputs.enable_readme_translation.checked, false, '未保存 API Key 时即使表单已填草稿也不得开启主开关');

  // 3. 已保存配置可用而表单有未保存草稿时，切换主开关不应清空未保存表单内容
  syncStore.readme_openai_api_key = 'sk-saved-key';
  await sandbox.loadValues();
  inputs.readme_openai_api_key.value = 'sk-unsaved-edit';
  inputs.readme_openai_api_url.value = 'https://custom.example/v1';
  inputs.enable_readme_translation.checked = true;
  await inputs.enable_readme_translation.dispatch('change');
  assert.strictEqual(inputs.enable_readme_translation.checked, true);
  assert.strictEqual(inputs.readme_openai_api_key.value, 'sk-unsaved-edit', '切换开关不应覆盖用户未保存的接口密钥草稿');
  assert.strictEqual(inputs.readme_openai_api_url.value, 'https://custom.example/v1', '切换开关不应覆盖用户未保存的接口地址草稿');

  // 4. chrome.storage.onChanged 应基于 LAST_SAVED_VALUES 校验规则，不受未保存 DOM 状态干扰
  syncStore.readme_provider = 'deepseek';
  syncStore.enable_collaboration_helper = true;
  await sandbox.loadValues();
  inputs.readme_provider.value = 'deepl'; // 未保存的切换尝试
  listeners[0]({ enable_extension: { newValue: false } }, 'sync');
  assert.strictEqual(inputs.enable_collaboration_helper.checked, true, '外部 sync 变更不应读取未保存 DOM 下拉导致协作开关被误关');

  // 5. refreshProviderPanel('index_translate') 应激活独立面板，而非 ai_chat
  sandbox.refreshProviderPanel('index_translate');
  assert.strictEqual(providerPanels.find((p) => p.dataset.provider === 'index_translate').classList.contains('is-active'), true);
  assert.strictEqual(providerPanels.find((p) => p.dataset.provider === 'ai_chat').classList.contains('is-active'), false);
  sandbox.refreshProviderPanel('deepseek');
  assert.strictEqual(providerPanels.find((p) => p.dataset.provider === 'ai_chat').classList.contains('is-active'), true);
  assert.strictEqual(providerPanels.find((p) => p.dataset.provider === 'index_translate').classList.contains('is-active'), false);

  // 6. 翻译记录来源类型与服务显示名应正确映射
  assert.strictEqual(sandbox.normalizeRecordSourceType('discussion'), 'discussion');
  assert.strictEqual(sandbox.getRecordSourceMeta('discussion').label, '讨论');
  assert.strictEqual(sandbox.getRecordSourceMeta('discussion').className, 'is-discussion');
  assert.strictEqual(sandbox.formatRecordProviderLabel('index_translate'), '哔哩哔哩翻译');
  assert.strictEqual(sandbox.formatRecordProviderLabel('deepseek'), 'DeepSeek');
  assert.strictEqual(sandbox.formatRecordProviderLabel(''), '未知');
  assert.strictEqual(sandbox.formatRecordProviderLabel('custom_gateway'), 'custom_gateway');
}

testOptionsFormStateAndUrlCollection()
  .then(() => console.log('PASS'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
