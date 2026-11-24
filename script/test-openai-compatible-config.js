'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const browser of ['chrome', 'edge', 'firefox']) {
  const optionsJsPath = path.resolve(__dirname, `../${browser}/options/options.js`);
  const contentJsPath = path.resolve(__dirname, `../${browser}/content.js`);
  const code = fs.readFileSync(optionsJsPath, 'utf8');
  const contentCode = fs.readFileSync(contentJsPath, 'utf8');

  const context = {
    console,
    URL,
    URLSearchParams,
    Intl,
    crypto: { randomUUID: () => 'test-uuid' },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    chrome: {
      permissions: {
        contains: () => {},
        request: () => {},
      },
      runtime: {
        sendMessage: () => {},
        lastError: null,
      },
      storage: {
        sync: { get: () => {}, set: () => {} },
        local: { get: () => {}, set: () => {}, remove: () => {} },
        onChanged: { addListener: () => {} },
      },
    },
  };

  vm.runInNewContext(code, context, { filename: optionsJsPath });

  const assertPreset = (actual, expected) => {
    assert.equal(actual?.apiUrl, expected.apiUrl, `${browser}: apiUrl`);
    assert.equal(actual?.model, expected.model, `${browser}: model`);
  };

  assertPreset(context.getAiProviderDefaults('openai'), {
    apiUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  });

  assertPreset(context.getAiProviderDefaults('deepseek'), {
    apiUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  });

  assertPreset(context.getAiProviderDefaults('qwen'), {
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
  });

  assertPreset(context.getQwenMtDefaults(), {
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-mt-turbo',
  });

  assertPreset(context.getAiProviderDefaults('minimax'), {
    apiUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7-highspeed',
  });

  assertPreset(context.getAiProviderDefaults('kimi'), {
    apiUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
  });

  assertPreset(context.getAiProviderDefaults('zhipu'), {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
  });

  assertPreset(context.getAiProviderDefaults('volcengine'), {
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-flash-250615',
  });

  const qwenDefaults = context.applyProviderDefaultsToValues({
    readme_provider: 'qwen',
    readme_openai_api_url: 'old',
    readme_openai_model: 'old',
    readme_openai_api_key: 'keep-key',
  });
  assert.equal(qwenDefaults.readme_provider, 'qwen');
  assert.equal(qwenDefaults.readme_openai_api_url, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwenDefaults.readme_openai_model, 'qwen-flash');
  assert.equal(qwenDefaults.readme_openai_api_key, 'keep-key');

  const qwenMtDefaults = context.applyProviderDefaultsToValues({
    readme_provider: 'qwen_mt',
    readme_qwen_mt_api_url: '',
    readme_qwen_mt_model: '',
    readme_qwen_mt_api_key: 'keep-key',
  });
  assert.equal(qwenMtDefaults.readme_provider, 'qwen_mt');
  assert.equal(qwenMtDefaults.readme_qwen_mt_api_url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(qwenMtDefaults.readme_qwen_mt_model, 'qwen-mt-turbo');
  assert.equal(qwenMtDefaults.readme_qwen_mt_api_key, 'keep-key');

  const qwenMtCustom = context.applyProviderDefaultsToValues({
    readme_provider: 'qwen_mt',
    readme_qwen_mt_api_url: 'https://relay.example/qwen-mt/chat/completions',
    readme_qwen_mt_model: 'qwen-mt-plus',
    readme_qwen_mt_api_key: 'keep-key',
  });
  assert.equal(qwenMtCustom.readme_qwen_mt_api_url, 'https://relay.example/qwen-mt/chat/completions');
  assert.equal(qwenMtCustom.readme_qwen_mt_model, 'qwen-mt-plus');

  assertPreset(context.getIndexTranslateDefaults(), {
    apiUrl: 'http://127.0.0.1:8080/v1',
    model: 'Index-Translate-35B-A3B',
  });

  const indexTranslateDefaults = context.applyProviderDefaultsToValues({
    readme_provider: 'index_translate',
    readme_index_translate_api_url: '',
    readme_index_translate_model: '',
    readme_index_translate_api_key: '',
    readme_openai_api_key: 'keep-openai-key',
  });
  assert.equal(indexTranslateDefaults.readme_provider, 'index_translate');
  assert.equal(indexTranslateDefaults.readme_index_translate_api_url, 'http://127.0.0.1:8080/v1');
  assert.equal(indexTranslateDefaults.readme_index_translate_model, 'Index-Translate-35B-A3B');
  assert.equal(indexTranslateDefaults.readme_index_translate_api_key, '');
  assert.equal(indexTranslateDefaults.readme_openai_api_key, 'keep-openai-key');

  const indexTranslateCustom = context.applyProviderDefaultsToValues({
    readme_provider: 'index_translate',
    readme_index_translate_api_url: 'http://127.0.0.1:8088/v1',
    readme_index_translate_model: 'Index-Translate-9B',
    readme_index_translate_api_key: 'relay-key',
  });
  assert.equal(indexTranslateCustom.readme_index_translate_api_url, 'http://127.0.0.1:8088/v1');
  assert.equal(indexTranslateCustom.readme_index_translate_model, 'Index-Translate-9B');
  assert.equal(indexTranslateCustom.readme_index_translate_api_key, 'relay-key');

  assert.equal(
    context.normalizeOpenAiEndpoint('https://api.deepseek.com'),
    'https://api.deepseek.com/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://api.deepseek.com/v1'),
    'https://api.deepseek.com/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://dashscope.aliyuncs.com'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://api.minimaxi.com'),
    'https://api.minimaxi.com/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://api.minimax.io/v1'),
    'https://api.minimax.io/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://api.moonshot.ai'),
    'https://api.moonshot.ai/v1/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  );

  assert.equal(
    context.normalizeOpenAiEndpoint('https://example.com/custom/base?api-version=2024'),
    'https://example.com/custom/base/chat/completions?api-version=2024',
  );

  const payload = {
    model: 'deepseek-v4-pro',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(payload, {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-pro',
  });

  assert.equal(payload.thinking?.type, 'disabled');
  assert.equal(payload.stream, false);

  const qwenPayload = {
    model: 'qwen-plus',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(qwenPayload, {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
  });

  assert.equal(qwenPayload.enable_thinking, false);

  const kimiPayload = {
    model: 'kimi-k2.6',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(kimiPayload, {
    url: 'https://api.moonshot.ai/v1/chat/completions',
    model: 'kimi-k2.6',
  });

  assert.equal(kimiPayload.thinking?.type, 'disabled');

  const glmPayload = {
    model: 'glm-5.1',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(glmPayload, {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-5.1',
  });

  assert.equal(glmPayload.thinking?.type, 'disabled');
  assert.equal(glmPayload.do_sample, false);

  const minimaxPayload = {
    model: 'MiniMax-M2.7',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(minimaxPayload, {
    url: 'https://api.minimax.io/v1/chat/completions',
    model: 'MiniMax-M2.7',
  });

  assert.equal(minimaxPayload.reasoning_split, true);

  const openAiPayload = {
    model: 'gpt-4o-mini',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(openAiPayload, {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  });

  assert.equal(openAiPayload.thinking, undefined);
  assert.equal(openAiPayload.stream, undefined);

  const indexProviderPayload = {
    model: 'custom-local-alias',
    messages: [],
  };

  context.applyOpenAiCompatibleRequestOptions(indexProviderPayload, {
    provider: 'index_translate',
    url: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'custom-local-alias',
  });

  assert.equal(indexProviderPayload.stream, false);
  assert.equal(indexProviderPayload.chat_template_kwargs?.enable_thinking, false);

  assert.match(contentCode, /function stripOpenAiReasoningBlocks/);
  assert.match(contentCode, /<think>\[\\s\\S\]\*\?<\\\/think>/);
  assert.match(contentCode, /function translateWithQwenMt/);
  assert.match(contentCode, /translation_options/);
}

console.log('OpenAI compatible config tests passed.');
