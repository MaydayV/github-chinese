'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
const MODEL = 'Index-Translate-35B-A3B';

function createHarness(browser) {
  let listener;
  let response = {};
  const requests = [];
  const background = vm.createContext({
    URL,
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(fn) { listener = fn; } },
      },
    },
    fetch: async (url, request) => {
      requests.push({ url, ...request });
      if (response.error) throw new Error(response.error);
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText || '',
        headers: { get: () => response.contentType || '' },
        text: async () => response.body,
      };
    },
  });
  vm.runInContext(read(`${browser}/background.js`), background);

  function createClient() {
    return vm.createContext({
      console, URL, URLSearchParams, Intl,
      window: { setTimeout },
      document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
      chrome: {
        runtime: {
          id: 'test-extension',
          lastError: null,
          sendMessage(message, callback) {
            assert.equal(listener(message, {}, callback), true);
          },
        },
        storage: { onChanged: { addListener() {} } },
      },
    });
  }

  const options = createClient();
  vm.runInContext(read(`${browser}/options/options.js`), options);
  const content = createClient();
  for (const file of ['core/constants.js', 'core/utils.js', 'core/storage-cache.js',
    'providers/provider-config.js', 'providers/cloud-translators.js']) {
    vm.runInContext(read(`chrome/src/${file}`), content);
  }

  return { background, clients: [options, content], requests, respond(value) { response = value; } };
}

async function main() {
  // 三端共用后台错误处理；设置页保留各端原有功能差异，分别验证实际行为。
  for (const browser of ['edge', 'firefox']) {
    assert.equal(read(`${browser}/background.js`), read('chrome/background.js'), `${browser} 后台应保持同步`);
  }
  for (const browser of ['chrome', 'edge', 'firefox']) {
    await testBrowser(browser);
  }
  console.log('Index-Translate request and proxy error tests passed (Chrome/Edge/Firefox).');
}

async function testBrowser(browser) {
  const harness = createHarness(browser);
  const config = { url: INDEX_URL, model: MODEL, key: 'test-placeholder' };
  for (const client of harness.clients) {
    for (const indexConfig of [
      config,
      { url: INDEX_URL, model: 'custom-alias' },
      { url: 'http://127.0.0.1:8080/v1/chat/completions', model: MODEL },
      { url: 'http://localhost:8080/v1/chat/completions', model: 'Index-Translate-2B' },
      { url: 'https://relay.example/v1/chat/completions', model: 'bilibili/Index-Translate-9B' },
    ]) {
      const payload = { chat_template_kwargs: { custom_option: true, enable_thinking: true } };
      client.applyOpenAiCompatibleRequestOptions(payload, indexConfig);
      assert.equal(payload.chat_template_kwargs.enable_thinking, false);
      assert.equal(payload.chat_template_kwargs.custom_option, true);
      assert.equal(payload.stream, false);
      assert.equal(payload.thinking, undefined);
    }

    for (const unrelated of [
      { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
      { url: 'http://localhost:8080/v1/chat/completions', model: 'other-model' },
      { url: 'https://index-translate.bilibili.com.example/v1', model: 'other-model' },
      { url: 'https://relay.example/v1', model: 'my-Index-Translate' },
    ]) {
      const payload = {};
      client.applyOpenAiCompatibleRequestOptions(payload, unrelated);
      assert.deepEqual(payload, {}, '其他自定义模型不应收到 Index-Translate 专用参数');
    }
  }

  const html = '\uFEFF\n<!DOCTYPE html><html><body>private-error-page-content</body></html>';
  for (const client of harness.clients) {
    for (const scenario of [
      { status: 412, contentType: 'text/html', body: html, url: INDEX_URL, bridge: true },
      { status: 412, body: html, url: 'https://other.example/v1', bridge: false },
      { status: 403, body: html, url: INDEX_URL, bridge: true },
      { status: 200, contentType: 'text/html', body: html, url: INDEX_URL, bridge: true },
      { status: 412, contentType: 'Text/HTML; charset=UTF-8', body: '<!-- error --><div>private-error-page-content</div>', url: INDEX_URL, bridge: true },
      { status: 502, contentType: 'application/xhtml+xml', body: '<?xml version="1.0"?><html/>', url: INDEX_URL, bridge: true },
      { status: 412, body: html, url: 'https://index-translate.bilibili.com.example/v1', bridge: false },
    ]) {
      harness.respond(scenario);
      const before = harness.requests.length;
      await assert.rejects(client.proxyFetchJson({ url: scenario.url }), (error) => {
        assert.match(error.message, new RegExp(`HTTP ${scenario.status}`));
        assert.match(error.message, /HTML 页面/);
        assert.doesNotMatch(error.message, /<!DOCTYPE|<html|<div|private-error-page-content/i);
        assert.equal(error.message.includes('call_api.py --serve'), scenario.bridge);
        if (scenario.status === 412) assert.match(error.message, /上游服务拒绝/);
        return true;
      });
      assert.equal(harness.requests.length - before, 1, 'HTTP 拒绝不应触发额外重试');
    }

    for (const status of [401, 412, 429]) {
      harness.respond({ status, contentType: 'application/json', body: '{"error":{"message":"api-test-error"}}' });
      await assert.rejects(client.proxyFetchJson({ url: INDEX_URL }), (error) => {
        assert.match(error.message, new RegExp(String(status)));
        assert.match(error.message, /api-test-error/);
        assert.doesNotMatch(error.message, /call_api.py|HTML 页面/);
        return true;
      });
    }

    harness.respond({ error: 'test-network-failure' });
    await assert.rejects(client.proxyFetchJson({ url: INDEX_URL }), /test-network-failure/);
    harness.respond({ status: 200, body: 'not-json' });
    await assert.rejects(client.proxyFetchJson({ url: INDEX_URL }), /非 JSON/);
    harness.respond({ status: 200, contentType: 'text/html', body: '{"text":"<html>example</html>"}' });
    assert.equal((await client.proxyFetchJson({ url: INDEX_URL })).text, '<html>example</html>', 'JSON 中的 HTML 字符串不是 HTML 错误页');
  }

  // 检查实际连接测试、批量翻译的请求体与错误传播，而不只检查 helper。
  const [options, content] = harness.clients;
  harness.respond({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
  await options.testOpenAiCompatible(config);
  assert.equal(JSON.parse(harness.requests.at(-1).body).chat_template_kwargs.enable_thinking, false);
  harness.respond({ status: 200, body: JSON.stringify({
    choices: [{ message: { content: '{"texts":["创建一个新仓库。","支持文档。"]}' } }],
    usage: { total_tokens: 12 },
  }) });
  const result = await content.translateWithOpenAiCompatible(['Create a repository.', 'Supports documents.'], config);
  assert.deepEqual(Array.from(result.translations), ['创建一个新仓库。', '支持文档。']);
  assert.equal(result.tokens, 12);
  assert.equal(JSON.parse(harness.requests.at(-1).body).chat_template_kwargs.enable_thinking, false);

  // 免 Key 配置（Bilibili Index-Translate）不应发送 Authorization 头；填写可选 Key 时应发送 Bearer
  const keylessConfig = {
    provider: 'index_translate',
    url: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'custom-local-alias',
    key: '',
  };
  harness.respond({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
  await options.testOpenAiCompatible(keylessConfig);
  assert.equal(Object.hasOwn(harness.requests.at(-1).headers, 'Authorization'), false, `${browser}: 空 API Key 时测试连通性不得发送 Authorization`);
  assert.equal(JSON.parse(harness.requests.at(-1).body).chat_template_kwargs.enable_thinking, false);

  harness.respond({ status: 200, body: JSON.stringify({
    choices: [{ message: { content: '{"texts":["译文A"]}' } }],
    usage: { total_tokens: 6 },
  }) });
  const keylessRes = await content.translateWithOpenAiCompatible(['Text A'], keylessConfig);
  assert.deepEqual(Array.from(keylessRes.translations), ['译文A']);
  assert.equal(Object.hasOwn(harness.requests.at(-1).headers, 'Authorization'), false, `${browser}: 空 API Key 时批量翻译不得发送 Authorization`);

  harness.respond({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
  await options.testOpenAiCompatible({ ...keylessConfig, key: 'relay-secret' });
  assert.equal(harness.requests.at(-1).headers.Authorization, 'Bearer relay-secret', `${browser}: 填写可选 Key 时应发送 Bearer Authorization`);

  vm.runInContext(`
    FeatureSet.readme_provider = 'index_translate';
    FeatureSet.readme_index_translate_api_url = 'http://127.0.0.1:8080/v1';
    FeatureSet.readme_index_translate_api_key = '';
    FeatureSet.readme_index_translate_model = 'Index-Translate-35B-A3B';
  `, content);
  const resolvedIndexConfig = content.getProviderConfig();
  assert.equal(resolvedIndexConfig.ok, true, `${browser}: 内容脚本内置 index_translate 配置应通过免 Key 校验`);
  assert.equal(resolvedIndexConfig.url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(resolvedIndexConfig.key, '');

  harness.respond({ status: 412, body: html });
  await assert.rejects(options.testOpenAiCompatible(config), /HTTP 412.*call_api.py --serve/);
  await assert.rejects(content.translateWithOpenAiCompatible(['Create a repository.'], config), /HTTP 412.*call_api.py --serve/);

  // 后台安全边界验证：sender 校验、POST-only、HTTPS/localhost 校验、sync 配置域一致性及 clear 限制
  let secListener;
  const secRequests = [];
  let secPermission = true;
  let secSyncProvider = 'openai';
  let secSyncUrl = INDEX_URL;
  let secSyncIndexUrl = 'http://127.0.0.1:8080/v1';
  let secFetchThrows = null;
  const secStorage = { ghcn_ui_misses: [{ page: 'repository/issues', text: 'Old label', count: 1 }] };
  const secBg = vm.createContext({
    URL,
    AbortController,
    TextDecoder,
    TextEncoder,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    GhcnMaintenance: {
      MISS_KEY: 'ghcn_ui_misses',
      collectable: () => true,
      normalize: (s) => String(s || '').trim(),
    },
    chrome: {
      runtime: {
        id: 'test-ext-id',
        getURL: (p) => `chrome-extension://test-ext-id/${p || ''}`,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(fn) { secListener = fn; } },
      },
      permissions: { contains(_q, cb) { cb(secPermission); } },
      storage: {
        sync: { get: async (d) => ({ ...d, readme_provider: secSyncProvider, readme_openai_api_url: secSyncUrl, readme_index_translate_api_url: secSyncIndexUrl }) },
        local: {
          get: async (k) => ({ [k]: secStorage[k] }),
          set: async (v) => Object.assign(secStorage, v),
        },
      },
    },
    fetch: async (url, opts) => {
      if (secFetchThrows) throw new Error(secFetchThrows);
      secRequests.push({ url, ...opts });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        text: async () => '{"ok":true}',
      };
    },
  });
  vm.runInContext(read(`${browser}/background.js`), secBg);
  const sendBg = (msg, sender) => new Promise((resolve) => secListener(msg, sender, resolve));

  const evilSender = { id: 'other-ext', url: 'https://evil.example/index.html', tab: { id: 9 } };
  const ghSender = { id: 'test-ext-id', url: 'https://github.com/owner/repo', tab: { id: 1 } };
  const ghFramelessSender = { id: 'test-ext-id', url: 'https://github.com/owner/repo' };
  const optSender = { id: 'test-ext-id', url: 'chrome-extension://test-ext-id/options/options.html' };
  const optTabSender = { id: 'test-ext-id', url: 'chrome-extension://test-ext-id/options/options.html', tab: { id: 2 } };

  assert.equal((await sendBg({ type: 'ghcn-proxy-fetch', payload: { url: INDEX_URL, method: 'POST' } }, evilSender)).status, 403);
  assert.equal((await sendBg({ type: 'ghcn-ui-misses', rows: [] }, evilSender)).error, 'FORBIDDEN');
  assert.equal((await sendBg({ type: 'ghcn-ui-misses', clear: true }, ghSender)).error, 'FORBIDDEN');
  assert.equal((await sendBg({ type: 'ghcn-proxy-fetch', payload: { url: INDEX_URL, method: 'GET' } }, ghSender)).status, 405);
  assert.equal((await sendBg({ type: 'ghcn-proxy-fetch', payload: { url: 'http://evil.example/v1', method: 'POST' } }, ghSender)).ok, false);
  assert.equal((await sendBg({ type: 'ghcn-proxy-fetch', payload: { url: 'https://other.example/v1', method: 'POST' } }, ghSender)).status, 403);
  assert.equal((await sendBg({ type: 'ghcn-proxy-fetch', payload: { url: 'https://other.example/v1', method: 'POST' } }, ghFramelessSender)).status, 403);

  // 设置页以标签页打开（带 sender.tab）时，保存前测试未保存的新服务商域名不得被 ORIGIN_NOT_CONFIGURED 拦截
  const preSaveOptRes = await sendBg({
    type: 'ghcn-proxy-fetch',
    payload: {
      url: 'https://new-provider.example/v1/chat/completions',
      method: 'POST',
      headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: '{}',
    },
  }, optTabSender);
  assert.equal(preSaveOptRes.ok, true, `${browser}: 设置页标签页保存前测试连通性应放行未保存域名`);

  // sync 中保存的 URL 若含内部空白字符，规整后仍应匹配内容脚本的域名校验
  secSyncUrl = '  https://index-translate.bilibili.com/\n  v1/chat/completions  ';
  const validRes = await sendBg({
    type: 'ghcn-proxy-fetch',
    payload: {
      url: INDEX_URL,
      method: 'POST',
      headers: { Authorization: 'Bearer k', Cookie: 'secret=1', 'Content-Type': 'application/json' },
      body: '{}',
    },
  }, ghSender);
  secSyncUrl = INDEX_URL;
  assert.equal(validRes.ok, true);
  const lastFetch = secRequests.at(-1);
  assert.equal(lastFetch.credentials, 'omit');
  assert.equal(lastFetch.redirect, 'error');
  assert.equal(Object.hasOwn(lastFetch.headers, 'Cookie'), false);
  assert.equal(lastFetch.headers.Authorization, 'Bearer k');

  // 内置 index_translate 默认本地桥接地址放行与断连排错提示
  secSyncProvider = 'index_translate';
  secSyncIndexUrl = 'http://127.0.0.1:8080/v1';
  const localRes = await sendBg({
    type: 'ghcn-proxy-fetch',
    payload: {
      url: 'http://127.0.0.1:8080/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  }, ghSender);
  assert.equal(localRes.ok, true, `${browser}: index_translate 应允许已配置的本机 127.0.0.1 地址`);
  assert.equal(Object.hasOwn(secRequests.at(-1).headers, 'Authorization'), false);

  secFetchThrows = 'Failed to fetch';
  const localErrRes = await sendBg({
    type: 'ghcn-proxy-fetch',
    payload: {
      url: 'http://127.0.0.1:8080/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  }, ghSender);
  secFetchThrows = null;
  secSyncProvider = 'openai';
  assert.equal(localErrRes.ok, false);
  assert.equal(localErrRes.status, 0);
  assert.match(localErrRes.error, /Failed to fetch.*call_api\.py --serve.*127\.0\.0\.1\/localhost/);

  assert.equal((await sendBg({ type: 'ghcn-ui-misses', clear: true }, optSender)).ok, true);
  assert.equal(secStorage.ghcn_ui_misses.length, 0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
