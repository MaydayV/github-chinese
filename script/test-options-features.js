#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const optionsPath = path.resolve(__dirname, '../chrome/options/options.js');
const source = fs.readFileSync(optionsPath, 'utf8');

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
  formatRecordDetail('translated_nodes=30;retry_missed=51;remaining=48'),
  '已翻译节点：30；重试未翻译：51；剩余未翻译：48',
  '复合翻译详情不应直接显示内部字段名',
);

assert.strictEqual(getRecordSourceMeta('readme').label, '说明文档', 'README 来源应显示中文');
assert.strictEqual(getStatusMeta('partial').label, '部分完成', 'partial 状态应显示中文');

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

console.log('PASS');
