#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const contentPath = path.resolve(__dirname, '../chrome/content.js');
const source = fs.readFileSync(contentPath, 'utf8');

function extractFunctionSource(name) {
  const token = `function ${name}(`;
  const start = source.indexOf(token);
  if (start === -1) {
    throw new Error(`函数不存在: ${name}`);
  }

  let index = source.indexOf('{', start);
  if (index === -1) {
    throw new Error(`函数缺少函数体: ${name}`);
  }

  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`函数解析失败: ${name}`);
}

function loadFunctions(functionNames) {
  const script = functionNames.map(extractFunctionSource).join('\n');
  const sandbox = { document: { title: 'suntek-official/suntek-sdk-sc1-sk1' } };
  vm.createContext(sandbox);
  vm.runInContext(`${script}\nthis.__exports = { ${functionNames.join(', ')} };`, sandbox);
  return sandbox.__exports;
}

const {
  buildRepoCacheKey,
  buildRepoIdentifierFromPath,
  getReadmeUsageTokens,
  buildProgressiveGroups,
  trimTranslationRecords,
  isMostlyCjkText,
  shouldSkipReadmeText,
  shouldSkipReadmeByLanguage,
  mapTargetLangForDeepL,
  mapTargetLangForAzure,
  isObjectObjectArtifact,
  normalizeTranslationText,
  parseOpenAiArray,
  stripOpenAiReasoningBlocks,
  normalizeRuntimeErrorMessage,
  isLikelyOpaqueReadmeLabel,
  isLikelyTechnicalReadmeText,
  isPlausiblePreservedText,
} = loadFunctions([
  'isExtensionContextInvalidatedError',
  'normalizeRuntimeErrorMessage',
  'buildRepoCacheKey',
  'buildRepoIdentifierFromPath',
  'getReadmeUsageTokens',
  'buildProgressiveGroups',
  'trimTranslationRecords',
  'isMostlyCjkText',
  'shouldSkipReadmeText',
  'shouldSkipReadmeByLanguage',
  'isLikelyOpaqueReadmeLabel',
  'isLikelyTechnicalReadmeText',
  'isPlausiblePreservedText',
  'mapTargetLangForDeepL',
  'mapTargetLangForAzure',
  'isObjectObjectArtifact',
  'normalizeTranslationText',
  'createRecoverableTranslationError',
  'parseOpenAiArray',
  'stripOpenAiReasoningBlocks',
]);

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

assert.strictEqual(
  buildRepoCacheKey({ owner: 'OpenAI', repo: 'Cookbook' }, 'abc123', 'sig-v1'),
  'openai/cookbook|abc123|sig-v1',
  '仓库缓存键应稳定且大小写归一化',
);

assert.strictEqual(
  buildRepoIdentifierFromPath('/OpenAI/Cookbook/tree/main'),
  'openai/cookbook',
  '应从 URL path 提取 owner/repo',
);

assert.strictEqual(
  getReadmeUsageTokens({ usage: { total_tokens: 128 } }),
  128,
  '应优先读取 total_tokens',
);

assert.strictEqual(
  getReadmeUsageTokens({ usage: { prompt_tokens: 50, completion_tokens: 70 } }),
  120,
  '当缺少 total_tokens 时应回退到 prompt+completion',
);

const groups = normalize(buildProgressiveGroups(Array.from({ length: 9 }, (_, idx) => `text-${idx + 1}`), 4));
assert.deepStrictEqual(
  groups,
  [
    ['text-1', 'text-2', 'text-3', 'text-4'],
    ['text-5', 'text-6', 'text-7', 'text-8'],
    ['text-9'],
  ],
  '分段翻译应按分组大小切片',
);

const records = Array.from({ length: 6 }, (_, idx) => ({
  id: idx + 1,
  createdAt: 100 + idx,
}));
assert.deepStrictEqual(
  normalize(trimTranslationRecords(records, 3)).map((item) => item.id),
  [6, 5, 4],
  '记录应按时间倒序并按上限裁剪',
);

assert.strictEqual(
  isMostlyCjkText('这是一个 GitHub 中文插件，用于仓库界面翻译。'),
  true,
  '中文为主的混合文本应识别为 CJK 主导',
);

assert.strictEqual(
  isMostlyCjkText('面向 AI、IoT、IIoT 和车联网的最具可扩展性和可靠性的 MQTT broker'),
  true,
  '技术英文缩写偏多的中文技术语句应正确识别为 CJK 主导',
);

assert.strictEqual(
  shouldSkipReadmeText('这是一个 GitHub 中文插件，用于仓库界面翻译。'),
  true,
  '中文 README 中夹少量英文时应跳过翻译',
);

assert.strictEqual(
  shouldSkipReadmeText('面向 AI、IoT、IIoT 和车联网的最具可扩展性和可靠性的 MQTT broker'),
  true,
  '含技术专有词的已翻译简介语句应跳过重复翻译',
);

assert.strictEqual(
  isLikelyOpaqueReadmeLabel('X', { parentElement: { closest: (selector) => selector.includes('a') } }),
  true,
  '外链中的单字母社交平台标签（如 X）应识别为不透明标签避免重试',
);

{
  const makeNode = (tags) => ({
    parentElement: {
      closest: (selector) => selector.split(',').map((s) => s.trim()).some((part) => tags.includes(part)),
    },
  });
  for (const label of ['Windows', 'Arch Linux', 'Nix']) {
    assert.strictEqual(isLikelyOpaqueReadmeLabel(label, makeNode(['td', 'table'])), true, `表格单元格专有名词 ${label} 应跳过`);
  }
  assert.strictEqual(isLikelyOpaqueReadmeLabel('Platform', makeNode(['th', 'table'])), false, '表头 Platform 仍应翻译');
  assert.strictEqual(isLikelyOpaqueReadmeLabel('Supported', makeNode(['td', 'table'])), false, '表格状态词 Supported 仍应翻译');
  assert.strictEqual(
    isLikelyOpaqueReadmeLabel('Claude Code · Claude Desktop · Claude Science · Codex · Gemini CLI'),
    true,
    '中点分隔的产品名列表应跳过',
  );
  assert.strictEqual(
    isLikelyOpaqueReadmeLabel('Anthropic · OpenAI · Amazon Bedrock (Runtime and Mantle) · DeepSeek'),
    false,
    '含括号自然语言说明的列表不应误跳过',
  );
  assert.strictEqual(
    isLikelyOpaqueReadmeLabel('Fast · Simple · Open Source · Reliable'),
    false,
    '中点分隔的营销短语不应误跳过',
  );
  for (const translatedMixed of [
    '安装 T3 Code',
    'Provider 设置',
    'Debian、Ubuntu',
    '在 Windows 上，在 PowerShell 中：',
    '涵盖 nightly 构建、AppImage、WSL 和 NixOS。',
    '登录到一个 agent',
    '它可与 Claude Code、Codex、Cursor、OpenCode、Grok Build、Antigravity、Kiro、Pi、Muse Code、fx 以及任何',
  ]) {
    assert.strictEqual(isMostlyCjkText(translatedMixed), true, `已译中英混排短句应识别为中文: ${translatedMixed}`);
  }
  for (const englishPrompt of [
    'Switch to 中文 version to read the full documentation.',
    'Read 简体中文',
  ]) {
    assert.strictEqual(isMostlyCjkText(englishPrompt), false, `含中文词的英文指令不应误跳过: ${englishPrompt}`);
  }
  for (const [text, tags] of [
    ['Official Hardware SDK & Developer Kit', ['strong']],
    ['Hardware', ['a[href]']],
    ['Architecture', ['a[href]']],
    ['Interfaces', ['a[href]']],
    ['Downloads', ['a[href]']],
    ['FAQ', ['a[href]']],
    ['Official Product Page', ['td', 'a[href]', 'table']],
    ['Desktop POS Terminal', ['td', 'sub', 'table']],
    ['Self-Service Kiosk', ['td', 'sub', 'table']],
    ['15.6-inch Mini Kiosk', ['td', 'sub', 'table']],
    ['Chipset / Board', ['th', 'table']],
    ['OS Versions', ['th', 'table']],
    ['Device Path / Service Target', ['th', 'table']],
    ['Android 10 - 14 (GMS & Non-GMS)', ['td', 'table']],
    ['Preinstalled System IPC', ['td', 'table']],
    ['SdkApi Display Module', ['td', 'table']],
    ['Hide nav/status bar, secondary screen', ['td', 'table']],
    ['GPIO & Serial UART', ['td', 'table']],
    ['RS232/RS485/TTL port power & I/O', ['td', 'table']],
    ['Unified Multi-Model Compatibility', ['li', 'strong']],
    ['Full Terminal Hardware Control', ['li', 'strong']],
    ['Platform Target', ['li', 'strong']],
    ['App Signing Requirement', ['li', 'strong']],
    ['Bug Reports', ['li', 'strong']],
    [': One shared', ['li']],
    ['AAR API supports', ['li']],
    ['terminals identically.', ['li']],
    ['firmware.', ['p']],
    ['. Verify downloaded archives before production deployment:', ['p']],
    ['Step 1: Add Matching AAR Dependency', ['h3']],
    ['Step 2: Initialize SDK & Query Hardware State', ['h3']],
    ['Troubleshooting & FAQ', ['h2']],
    ['Which models share `suntek-sdk-sc1-sk1`?', ['summary', 'b']],
    ['Smart Commercial Terminal Hardware Manufacturer Since 2010', ['em']],
  ]) {
    assert.strictEqual(isLikelyOpaqueReadmeLabel(text, makeNode(tags)), false, `正常英文短语不应跳过: ${text}`);
  }
  for (const [text, tags] of [
    ['SC1', ['td', 'strong', 'table']],
    ['SK1-15', ['td', 'strong', 'table']],
    ['CHANGELOG.md', ['li', 'a[href]']],
    ['SECURITY.md', ['li', 'a[href]']],
    ['support@suntekai.com', ['li', 'a[href]']],
    ['www.suntekai.com', ['sub', 'a[href]']],
    ['cumora.ai', ['p', 'a[href]', 'strong']],
    ['Cumora.ai', ['p']],
    ['github.com', ['li']],
    ['t3.gg', ['p']],
    ['docs.rs', ['p']],
    ['deno.land', ['p', 'a[href]']],
    ['suntek-docs', ['li', 'a[href]']],
    ['Amazon Simple Queue Service (SQS)', ['td', 'a[href]', 'table']],
  ]) {
    assert.strictEqual(isLikelyOpaqueReadmeLabel(text, makeNode(tags)), true, `纯技术标识/专有名词应跳过: ${text}`);
  }
  for (const [text, tags] of [
    ['Done.Also', ['p']],
    ['end.to', ['p']],
  ]) {
    assert.strictEqual(isLikelyOpaqueReadmeLabel(text, makeNode(tags)), false, `非链接普通点分词或粘连错字不应误判为域名: ${text}`);
  }
  for (const [text, tags] of [
    ['slug', ['li']],
    ['tags', ['li']],
    ['api_key', ['td', 'table']],
  ]) {
    assert.strictEqual(isLikelyTechnicalReadmeText(text, makeNode(tags)), true, `列表/表格参数键名应跳过: ${text}`);
  }
  for (const [text, tags] of [
    ['and', ['li']],
    ['or', ['li']],
    ['with', ['li']],
    ['for', ['td', 'table']],
  ]) {
    assert.strictEqual(isLikelyTechnicalReadmeText(text, makeNode(tags)), false, `列表/表格普通英文虚词不应被当成参数键名跳过: ${text}`);
  }
}

assert.strictEqual(
  shouldSkipReadmeText('A lightweight extension that translates GitHub repository README files.'),
  false,
  '英文说明文本应继续进入翻译流程',
);

assert.strictEqual(
  shouldSkipReadmeByLanguage('这是一个 GitHub 中文化插件，支持仓库页面词条翻译和 README 处理。', 'zh-CN'),
  true,
  '整篇内容已是中文时应跳过 README 翻译',
);

assert.strictEqual(
  shouldSkipReadmeByLanguage('A lightweight extension for translating GitHub interface and README content.', 'zh-CN'),
  false,
  '英文 README 不应被语言判断误跳过',
);

assert.strictEqual(
  mapTargetLangForDeepL('zh-TW'),
  'ZH',
  'DeepL 目标语言应固定为简体中文',
);

assert.strictEqual(
  mapTargetLangForAzure('zh-TW'),
  'zh-Hans',
  'Azure 目标语言应固定为简体中文',
);

assert.strictEqual(
  normalizeTranslationText({ text: '你好世界' }),
  '你好世界',
  '对象条目应提取 text 字段',
);

assert.strictEqual(
  normalizeTranslationText({ translation: '分段翻译' }),
  '分段翻译',
  '对象条目应提取 translation 字段',
);

assert.strictEqual(
  normalizeTranslationText([{ type: 'text', text: '多模态' }, { type: 'text', text: '内容' }]),
  '多模态内容',
  '多模态 content 数组应拼接 text',
);

assert.deepStrictEqual(
  normalize(parseOpenAiArray(JSON.stringify([
    { text: '第一段' },
    { translatedText: '第二段' },
    '第三段',
  ]), 3)),
  ['第一段', '第二段', '第三段'],
  'OpenAI 数组中的对象条目应规范化为字符串',
);

assert.throws(
  () => parseOpenAiArray(JSON.stringify([{ foo: {} }, 'ok']), 2),
  /无法解析的对象条目|无效/,
  '无法提取文本的对象条目应失败而不是写成 [object Object]',
);

assert.strictEqual(
  normalizeTranslationText({}),
  '',
  '空对象不应落到 [object Object]',
);

// 部分模型镜像请求结构，把译文包进 texts/translations 返回，需能解析而非降级漏译
assert.strictEqual(
  normalizeTranslationText({ texts: ['译文'] }),
  '译文',
  'texts 数组包裹的译文应被提取',
);

assert.deepStrictEqual(
  normalize(parseOpenAiArray(JSON.stringify([{ texts: ['译文'] }]), 1)),
  ['译文'],
  '数组中每项为 {texts:[...]} 的返回应正确解析',
);

assert.deepStrictEqual(
  normalize(parseOpenAiArray(JSON.stringify({ texts: ['甲', '乙'] }), 2)),
  ['甲', '乙'],
  '顶层 {texts:[...]} 包裹的整批译文应解包',
);

// chrome.runtime.lastError 等普通对象错误必须取出可读 message，不能落成 "[object Object]"
assert.strictEqual(
  normalizeRuntimeErrorMessage({ message: 'Could not establish connection.' }),
  'Could not establish connection.',
  '普通对象错误应提取 message 而非 [object Object]',
);

assert.strictEqual(
  normalizeRuntimeErrorMessage(new Error('边界超时')),
  '边界超时',
  'Error 实例应返回其 message',
);

async function runReadmePipelineTests() {
  const readModule = (rel) => fs.readFileSync(path.resolve(__dirname, '../chrome/src', rel), 'utf8');
  function createFakeNode(nodeType, value, parent = null, tagName = 'DIV') {
    const node = {
      nodeType,
      tagName,
      parentElement: parent,
      isConnected: true,
      childNodes: [],
      attributes: {},
      closest(selector) {
        if (!selector) return null;
        return this.parentElement ? this.parentElement.closest(selector) : null;
      },
    };
    if (nodeType === 3) node.data = value;
    else node._html = value || '';
    return node;
  }

  function buildDocTree(items) {
    const root = createFakeNode(1, '', null, 'ARTICLE');
    root.replaceChildren = (...nodes) => {
      root.childNodes = [];
      for (const n of nodes) {
        n.parentElement = root;
        root.childNodes.push(n);
      }
    };
    const nodes = [];
    for (const item of items) {
      const el = createFakeNode(1, '', root, item.tag || 'P');
      const txt = createFakeNode(3, item.text, el);
      el.childNodes.push(txt);
      root.childNodes.push(el);
      nodes.push(txt);
    }
    Object.defineProperty(root, 'innerHTML', {
      get() { return JSON.stringify(root.childNodes.map((el) => ({ tag: el.tagName, text: el.childNodes[0]?.data || '' }))); },
      set(val) {
        const parsed = JSON.parse(val);
        root.childNodes = [];
        for (const row of parsed) {
          const el = createFakeNode(1, '', root, row.tag || 'P');
          el.childNodes.push(createFakeNode(3, row.text, el));
          root.childNodes.push(el);
        }
      },
    });
    Object.defineProperty(root, 'textContent', {
      get() { return root.childNodes.map((el) => el.childNodes[0]?.data || '').join(' '); },
    });
    return root;
  }

  const sandbox = {
    console,
    Date,
    Math,
    URL,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    Number,
    String,
    Array,
    Object,
    RegExp,
    performance: { now: () => 100 },
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 },
    isPageExcluded: () => false,
    window: {
      location: { hostname: 'github.com', pathname: '/owner/repo', href: 'https://github.com/owner/repo' },
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      requestAnimationFrame: (fn) => fn(),
    },
    chrome: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    },
    DOMParser: class {
      parseFromString(html) {
        const makeBody = () => {
          const rows = html.trim().startsWith('[') ? JSON.parse(html) : [];
          const children = rows.map((row) => {
            const el = createFakeNode(1, '', null, row.tag || 'P');
            el.childNodes.push(createFakeNode(3, row.text, el));
            return el;
          });
          return {
            childNodes: children,
            get textContent() { return children.map((el) => el.childNodes[0]?.data || '').join(' '); },
            querySelectorAll: () => [],
            cloneNode: () => makeBody(),
          };
        };
        return { body: makeBody() };
      }
    },
    document: {
      title: 'owner/repo',
      importNode: (node) => node,
      createElement: () => buildDocTree([]),
      createTreeWalker(rootEl) {
        const texts = [];
        for (const el of rootEl.childNodes || []) {
          for (const ch of el.childNodes || []) {
            if (ch.nodeType === 3) texts.push(ch);
          }
        }
        return { nextNode: () => texts.shift() || null };
      },
    },
  };
  vm.createContext(sandbox);
  for (const rel of [
    'core/constants.js',
    'core/utils.js',
    'core/storage-cache.js',
    'core/text-filter.js',
    'providers/dispatcher.js',
    'features/markdown-translation.js',
  ]) {
    vm.runInContext(readModule(rel), sandbox);
  }
  sandbox.document.importNode = (node) => node;
  let batchCalls = [];
  let translateHandler = async (batch) => ({ translations: batch.slice(), tokens: 10 });
  sandbox.translateBatch = async (batch, cfg) => {
    batchCalls.push(batch.slice());
    return translateHandler(batch, cfg);
  };
  const providerConfig = { ok: true, provider: 'deepseek', targetLang: 'zh-CN', signature: 'sig' };
  sandbox.getProviderConfig = () => providerConfig;

  // 1. 批量中专有名词原样返回 -> 单条确认一次 -> 记入 preservedCache，不记为 missedItems
  batchCalls = [];
  translateHandler = async (batch) => {
    if (batch.length === 2) return { translations: ['安装 CLI', 'Codex Web'], tokens: 100 };
    return { translations: ['Codex Web'], tokens: 20 };
  };
  const debugEvents1 = [];
  const res1 = await sandbox.translateTextsWithProvider(['Install CLI', 'Codex Web'], providerConfig, {
    debugContext: { events: debugEvents1 },
    debugPhase: 'initial',
  });
  assert.strictEqual(res1.totalTokens, 120, '应统计批量与单条确认的全部 Tokens');
  assert.strictEqual(res1.translatedMap.get('Install CLI'), '安装 CLI');
  assert.strictEqual(res1.translatedMap.get('Codex Web'), 'Codex Web');
  const endEvent1 = debugEvents1.find((e) => e.phase === 'batch_end');
  assert.strictEqual(endEvent1.missedItems.length, 0, '确认保持原文的专有名词不应记为 missedItems');
  assert.strictEqual(endEvent1.preservedItems.length, 1);
  assert.strictEqual(endEvent1.preservedItems[0].textPreview, 'Codex Web');
  assert.strictEqual(vm.runInContext("readmeRuntime.preservedCache.has('sig|Codex Web')", sandbox), true);

  batchCalls = [];
  await sandbox.translateTextsWithProvider(['Codex Web'], providerConfig);
  assert.strictEqual(batchCalls.length, 0, '已确认保留原文的条目不应再发起请求');

  // 2. 单条重试 (preferSingleItem) 不应再内嵌重复单条请求
  batchCalls = [];
  translateHandler = async () => ({ translations: ['Docker Desktop'], tokens: 30 });
  const debugEvents2 = [];
  await sandbox.translateTextsWithProvider(['Docker Desktop'], providerConfig, {
    preferSingleItem: true,
    debugContext: { events: debugEvents2 },
    debugPhase: 'retry_1',
  });
  assert.strictEqual(batchCalls.length, 1, '单条批次不应再触发内部重复单条请求');
  assert.strictEqual(debugEvents2.find((e) => e.phase === 'batch_end').missedItems.length, 0);
  assert.strictEqual(vm.runInContext("readmeRuntime.preservedCache.has('sig|Docker Desktop')", sandbox), true);

  // 3. 可恢复解析错误（降级返回原文）不得写入 preservedCache
  batchCalls = [];
  translateHandler = async () => { throw sandbox.createRecoverableTranslationError('bad json'); };
  const debugEvents3 = [];
  await sandbox.translateTextsWithProvider(['Broken JSON entry'], providerConfig, {
    debugContext: { events: debugEvents3 },
    debugPhase: 'initial',
  });
  assert.strictEqual(debugEvents3.find((e) => e.phase === 'batch_end').missedItems.length, 1, '解析降级应保留在 missedItems 以便重试');
  assert.strictEqual(vm.runInContext("readmeRuntime.preservedCache.has('sig|Broken JSON entry')", sandbox), false);

  // 4. 部分缓存命中时只补翻未翻译原文节点，且完成后即使仍有部分未翻，当前页不再因 mutation 重复发起请求
  const origTree = buildDocTree([
    { text: 'Install T3 Code' },
    { text: 'Windows' },
    { text: 'Run the following command' },
  ]);
  const cachedTree = buildDocTree([
    { text: '安装 T3 Code' },
    { text: 'Windows' },
    { text: 'Run the following command' },
  ]);
  origTree.childNodes.forEach((el) => { el.parentElement = origTree; });
  cachedTree.childNodes.forEach((el) => { el.parentElement = cachedTree; });
  const origHtml = origTree.innerHTML;
  const cachedHtml = cachedTree.innerHTML;
  const readmeEl = buildDocTree([
    { text: 'Install T3 Code' },
    { text: 'Windows' },
    { text: 'Run the following command' },
  ]);
  readmeEl.childNodes.forEach((el) => { el.parentElement = readmeEl; });

  vm.runInContext("readmeRuntime.preservedCache.add('sig|Windows')", sandbox);
  const origGetRepoCachedTranslation = sandbox.getRepoCachedTranslation;
  const origUpsertRepoCachedTranslation = sandbox.upsertRepoCachedTranslation;
  let savedCacheEntry = null;
  let savedRecord = null;
  sandbox.getRepoCachedTranslation = async () => ({ translatedHtml: cachedHtml, complete: false });
  sandbox.upsertRepoCachedTranslation = async (_key, entry) => { savedCacheEntry = entry; };
  sandbox.appendReadmeTranslationRecord = async (record) => { savedRecord = record; };

  batchCalls = [];
  translateHandler = async (batch) => {
    if (batch[0] === 'Run the following command') return { translations: ['运行以下命令'], tokens: 40 };
    return { translations: batch.slice(), tokens: 10 };
  };
  await sandbox.translateReadmeElement(readmeEl, 'mutation', { events: [] });
  assert.strictEqual(batchCalls.length, 1, '部分缓存只应请求真正未翻的节点');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])), ['Run the following command'], '不应重新翻译已译出的中文节点或已保留专有名词');
  assert.strictEqual(savedCacheEntry.complete, true);
  assert.strictEqual(savedRecord.status, 'success');

  // 5. 若仍有真实英文句子未翻（status=partial），同一页再次触发 mutation 时应跳过避免死循环重跑
  const readmeEl2 = buildDocTree([{ text: 'Pending sentence that fails to parse properly.' }]);
  readmeEl2.childNodes.forEach((el) => { el.parentElement = readmeEl2; });
  sandbox.getRepoCachedTranslation = async () => null;
  batchCalls = [];
  translateHandler = async () => { throw sandbox.createRecoverableTranslationError('bad json'); };
  await sandbox.translateReadmeElement(readmeEl2, 'mutation', { events: [] });
  assert.strictEqual(savedRecord.status, 'partial');
  const callsAfterPartial = batchCalls.length;
  const eventsSecond = [];
  await sandbox.translateReadmeElement(readmeEl2, 'mutation', { events: eventsSecond });
  assert.strictEqual(batchCalls.length, callsAfterPartial, '同一 DOM 状态不应因 partial 再次触发 API 请求');
  assert.strictEqual(eventsSecond.find((e) => e.phase === 'readme_skipped')?.reason, 'already_translated');

  // 6. 仓库缓存应持久化、去重并保留 preservedTexts（TL;DR 单独更新时不得丢失）
  let storedRepoCache = [];
  sandbox.chrome.storage.local.get = async (defaults) => ({
    ...defaults,
    ghcn_readme_repo_cache: storedRepoCache,
  });
  sandbox.chrome.storage.local.set = async (values) => {
    if (Array.isArray(values?.ghcn_readme_repo_cache)) {
      storedRepoCache = values.ghcn_readme_repo_cache;
    }
  };
  vm.runInContext('FeatureSet.readme_enable_repo_cache = true; readmeRuntime.repoCacheLoaded = false; readmeRuntime.repoCacheMap.clear();', sandbox);
  await origUpsertRepoCachedTranslation('owner/repo|hash1|sig', {
    repo: 'owner/repo',
    sourceHash: 'hash1',
    translatedHtml: cachedHtml,
    complete: true,
    preservedTexts: [' Cumora ', 'Cumora', 'Cumora Cloud', '', 'x'.repeat(161)],
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(storedRepoCache[0].preservedTexts)),
    ['Cumora', 'Cumora Cloud'],
    '仓库缓存应去重、裁剪超长项并持久化 preservedTexts',
  );
  await origUpsertRepoCachedTranslation('owner/repo|hash1|sig', {
    repo: 'owner/repo',
    sourceHash: 'hash1',
    tldrContent: 'TL;DR 速读内容',
    complete: true,
  });
  vm.runInContext('readmeRuntime.repoCacheLoaded = false; readmeRuntime.repoCacheMap.clear();', sandbox);
  const reloadedCache = await origGetRepoCachedTranslation('owner/repo|hash1|sig');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(reloadedCache.preservedTexts)),
    ['Cumora', 'Cumora Cloud'],
    '仅更新 TL;DR 后重新从 storage 加载，preservedTexts 不应丢失',
  );
  assert.strictEqual(reloadedCache.tldrContent, 'TL;DR 速读内容');

  // 7. 刷新页面后命中 complete:true 缓存（含新格式带 preservedTexts 与旧格式不带 preservedTexts）必须 0 请求 0 Token 返回 cache_hit
  const origCumoraHtml = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: 'Where agent teams gather.' },
  ]).innerHTML;
  const translatedCumoraHtml = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: '智能体团队汇聚之处。' },
  ]).innerHTML;

  // 7a: 含 preservedTexts 的完整缓存命中，并回填内存 preservedCache
  vm.runInContext('readmeRuntime.preservedCache.clear();', sandbox);
  const readmeCompleteA = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: 'Where agent teams gather.' },
  ]);
  readmeCompleteA.childNodes.forEach((el) => { el.parentElement = readmeCompleteA; });
  assert.strictEqual(readmeCompleteA.innerHTML, origCumoraHtml);
  sandbox.getRepoCachedTranslation = async () => ({
    translatedHtml: translatedCumoraHtml,
    complete: true,
    preservedTexts: ['Cumora', 'Cumora Cloud'],
  });
  sandbox.upsertRepoCachedTranslation = async (_key, entry) => { savedCacheEntry = entry; };
  batchCalls = [];
  savedCacheEntry = null;
  savedRecord = null;
  const eventsCompleteA = [];
  await sandbox.translateReadmeElement(readmeCompleteA, 'mutation', { events: eventsCompleteA });
  assert.strictEqual(batchCalls.length, 0, '刷新命中完整缓存后不应再发起任何 API 请求');
  assert.ok(eventsCompleteA.some((e) => e.phase === 'cache_hit'), '应记录 cache_hit 调试事件');
  assert.ok(!eventsCompleteA.some((e) => e.phase === 'partial_cache_hit'), 'complete:true 不应降级为 partial_cache_hit');
  assert.strictEqual(savedRecord.status, 'cache_hit');
  assert.strictEqual(savedRecord.tokens, 0);
  assert.strictEqual(
    vm.runInContext("readmeRuntime.preservedCache.has('sig|Cumora') && readmeRuntime.preservedCache.has('sig|Cumora Cloud')", sandbox),
    true,
    '命中带 preservedTexts 的缓存时应回填内存 preservedCache',
  );

  // 7b: 兼容旧格式 complete:true（无 preservedTexts）也不应重新触发补翻译
  vm.runInContext('readmeRuntime.preservedCache.clear();', sandbox);
  const readmeCompleteB = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: 'Where agent teams gather.' },
  ]);
  readmeCompleteB.childNodes.forEach((el) => { el.parentElement = readmeCompleteB; });
  sandbox.getRepoCachedTranslation = async () => ({
    translatedHtml: translatedCumoraHtml,
    complete: true,
  });
  batchCalls = [];
  savedRecord = null;
  const eventsCompleteB = [];
  await sandbox.translateReadmeElement(readmeCompleteB, 'mutation', { events: eventsCompleteB });
  assert.strictEqual(batchCalls.length, 0, '旧版 complete:true 缓存同样不应发起 API 请求');
  assert.ok(eventsCompleteB.some((e) => e.phase === 'cache_hit'));
  assert.strictEqual(savedRecord.status, 'cache_hit');
  assert.strictEqual(savedRecord.tokens, 0);

  // 8. 刷新命中 complete:false 部分缓存时，只补翻真正的漏译句，已记录的 preservedTexts 不再重复请求
  vm.runInContext('readmeRuntime.preservedCache.clear();', sandbox);
  const readmePartial = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: 'Where agent teams gather.' },
    { text: 'Join the beta.' },
  ]);
  readmePartial.childNodes.forEach((el) => { el.parentElement = readmePartial; });
  const partialHtmlWithPreserved = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: '智能体团队汇聚之处。' },
    { text: 'Join the beta.' },
  ]).innerHTML;
  sandbox.getRepoCachedTranslation = async () => ({
    translatedHtml: partialHtmlWithPreserved,
    complete: false,
    preservedTexts: ['Cumora', 'Cumora Cloud'],
  });
  batchCalls = [];
  savedCacheEntry = null;
  savedRecord = null;
  translateHandler = async () => ({ translations: ['加入测试版。'], tokens: 45 });
  const eventsPartial = [];
  await sandbox.translateReadmeElement(readmePartial, 'mutation', { events: eventsPartial });
  assert.strictEqual(eventsPartial.find((e) => e.phase === 'partial_cache_hit')?.remaining, 1);
  assert.strictEqual(batchCalls.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])), ['Join the beta.']);
  assert.strictEqual(savedCacheEntry.complete, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(savedCacheEntry.preservedTexts)), ['Cumora', 'Cumora Cloud']);
  assert.strictEqual(savedRecord.status, 'success');
  assert.strictEqual(savedRecord.tokens, 45);

  // 9. 部分缓存（未含 preservedTexts）补翻后全部被确认为 preserved（translatedCount=0, totalTokens>0）时仍需结算记账并升级为 complete:true
  vm.runInContext('readmeRuntime.preservedCache.clear();', sandbox);
  const readmePreservedOnly = buildDocTree([
    { text: 'Cumora' },
    { text: 'Cumora Cloud' },
    { text: 'Where agent teams gather.' },
  ]);
  readmePreservedOnly.childNodes.forEach((el) => { el.parentElement = readmePreservedOnly; });
  sandbox.getRepoCachedTranslation = async () => ({
    translatedHtml: translatedCumoraHtml,
    complete: false,
  });
  batchCalls = [];
  savedCacheEntry = null;
  savedRecord = null;
  translateHandler = async (batch) => ({ translations: batch.slice(), tokens: batch.length > 1 ? 200 : 50 });
  const eventsPreservedOnly = [];
  await sandbox.translateReadmeElement(readmePreservedOnly, 'mutation', { events: eventsPreservedOnly });
  const endPreservedOnly = eventsPreservedOnly.find((e) => e.phase === 'readme_end');
  assert.ok(endPreservedOnly, '即使 translatedCount === 0，消耗了 Tokens 也应记录 readme_end');
  assert.strictEqual(endPreservedOnly.status, 'success');
  assert.strictEqual(endPreservedOnly.translatedCount, 0);
  assert.strictEqual(endPreservedOnly.remaining, 0);
  assert.strictEqual(savedRecord.status, 'success');
  assert.strictEqual(savedRecord.tokens, 300);
  assert.strictEqual(savedCacheEntry.complete, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(savedCacheEntry.preservedTexts)), ['Cumora', 'Cumora Cloud']);

  // 10. 前方有被规则跳过的 <li> 参数键名节点、后方 <p> 有同名节点时，回填必须命中原 <p> 节点，不能错写到 <li> 引发 retry_1
  vm.runInContext('readmeRuntime.translationCache.clear(); readmeRuntime.preservedCache.clear();', sandbox);
  const readmeMisTarget = buildDocTree([
    { tag: 'LI', text: 'slug' },
    { tag: 'P', text: 'slug' },
  ]);
  readmeMisTarget.childNodes[0].closest = (selector) => (
    selector.split(',').some((s) => s.trim().toLowerCase() === 'li') ? readmeMisTarget.childNodes[0] : null
  );
  readmeMisTarget.childNodes.forEach((el) => { el.parentElement = readmeMisTarget; });
  sandbox.getRepoCachedTranslation = async () => null;
  batchCalls = [];
  savedCacheEntry = null;
  savedRecord = null;
  translateHandler = async () => ({ translations: ['短别名'], tokens: 35 });
  const eventsMisTarget = [];
  await sandbox.translateReadmeElement(readmeMisTarget, 'mutation', { events: eventsMisTarget });
  assert.strictEqual(readmeMisTarget.childNodes[0].childNodes[0].data, 'slug', '跳过的 <li> 参数键名不得被后方同名 <p> 的译文覆盖');
  assert.strictEqual(readmeMisTarget.childNodes[1].childNodes[0].data, '短别名', '<p> 节点应准确拿到自己的译文');
  assert.strictEqual(batchCalls.length, 1, '命中原节点后不应触发额外 retry_1');
  assert.strictEqual(eventsMisTarget.find((e) => e.phase === 'retry_scan')?.remaining, 0);

  // 11. 原节点离线触发候选重查时，refreshReadmeTextTaskNodes 也应排除被技术规则跳过的 <li> 节点并回落到新 <p> 节点
  const detachedTree = buildDocTree([
    { tag: 'LI', text: 'slug' },
    { tag: 'P', text: 'slug' },
  ]);
  detachedTree.childNodes[0].closest = (selector) => (
    selector.split(',').some((s) => s.trim().toLowerCase() === 'li') ? detachedTree.childNodes[0] : null
  );
  detachedTree.childNodes.forEach((el) => { el.parentElement = detachedTree; });
  const staleTask = {
    node: { nodeType: 3, data: 'slug', isConnected: false, parentElement: detachedTree.childNodes[1] },
    rawText: 'slug',
    trimmedText: 'slug',
    normalizedText: 'slug',
  };
  const appliedDetached = sandbox.applyReadmeTaskTranslations(detachedTree, [staleTask], new Map([['slug', '短别名']]));
  assert.strictEqual(appliedDetached, 1);
  assert.strictEqual(detachedTree.childNodes[0].childNodes[0].data, 'slug', '回落重查不得选中被技术规则跳过的 <li> 节点');
  assert.strictEqual(detachedTree.childNodes[1].childNodes[0].data, '短别名', '回落重查应命中新替换的 <p> 节点');

  // 12. Batch 1/2 安全与内核修复验证：64 位哈希、缓存 HTML DOM 净化、Google 不二次反转义、OpenAI JSON/think 块
  const hashA = sandbox.createHash('alpha');
  const hashB = sandbox.createHash('beta');
  assert.strictEqual(hashA.length, 16, 'createHash 应返回 16 字符 64 位摘要');
  assert.notStrictEqual(hashA, hashB);

  const dangerousScript = { tagName: 'SCRIPT', removed: false, remove() { this.removed = true; } };
  const dangerousLink = {
    tagName: 'A',
    removed: false,
    attrs: [{ name: 'href', value: 'javascript:alert(1)' }, { name: 'onclick', value: 'hack()' }],
    get attributes() { return this.attrs; },
    hasAttribute(n) { return this.attrs.some((a) => a.name === n); },
    getAttribute(n) { return this.attrs.find((a) => a.name === n)?.value ?? null; },
    removeAttribute(n) { this.attrs = this.attrs.filter((a) => a.name !== n); },
    remove() { this.removed = true; },
  };
  sandbox.sanitizeCachedHtmlTree({ querySelectorAll: (sel) => (sel === '*' ? [dangerousScript, dangerousLink] : [dangerousScript]) });
  assert.strictEqual(dangerousScript.removed, true, 'sanitizeCachedHtmlTree 应移除危险标签');
  assert.strictEqual(dangerousLink.attrs.length, 0, 'sanitizeCachedHtmlTree 应剥离 javascript: 链接与事件属性');

  const ctSandbox = {
    console, Date, Math, JSON, URL, URLSearchParams, Set, Map, Array, Object, String, Number, Error, RegExp, Promise,
    chrome: { runtime: { id: 'ext', sendMessage() {} } },
    window: { setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} },
    proxyFetchJson: async () => [[['&lt;div&gt;示例', '&lt;div&gt;example']]],
  };
  vm.createContext(ctSandbox);
  for (const rel of ['core/constants.js', 'core/utils.js', 'providers/provider-config.js', 'providers/cloud-translators.js']) {
    vm.runInContext(readModule(rel), ctSandbox);
  }
  const googleRes = await ctSandbox.translateWithGoogle(['&lt;div&gt;example'], { url: 'https://translate.googleapis.com/translate_a/single', key: '' });
  assert.strictEqual(googleRes.translations[0], '&lt;div&gt;示例', 'Google 翻译结果不应被二次 HTML 解码');
  assert.deepStrictEqual(Array.from(ctSandbox.parseOpenAiArray('["Use [a, b] carefully"]')), ['Use [a, b] carefully']);
  assert.strictEqual(
    ctSandbox.stripOpenAiReasoningBlocks('  <think>plan</think>\nFinal <think>literal tag</think>'),
    'Final <think>literal tag</think>',
  );

  // 13. openmausbot 品牌/技术栈/架构标签保留校验与负例拦截
  for (const label of [
    'Muse vs Grok Bot vs Dots vs Cue',
    'React + Vite + Tailwind CSS',
    'ElevenLabs · Fish Audio',
    '(x64)',
    'Windows x64',
    'macOS arm64',
  ]) {
    assert.strictEqual(isPlausiblePreservedText(label), true, `合法专有标签应保留原文: ${label}`);
  }
  for (const prose of [
    'This sentence should fail translation properly',
    'Install the following command',
    'Fast + Simple + Reliable',
    '+ React',
    'React +',
    'React + · Vite',
  ]) {
    assert.strictEqual(isPlausiblePreservedText(prose), false, `自然语言或异常符号连接不得误判为保留标签: ${prose}`);
  }
  assert.strictEqual(isLikelyOpaqueReadmeLabel('(x64)'), true);
  assert.strictEqual(isLikelyOpaqueReadmeLabel('arm64'), true);

  // 14. 仓库缓存应保留 pathname，并拒绝 [object Object] 与空载荷条目
  vm.runInContext('FeatureSet.readme_enable_repo_cache = true;', sandbox);
  const normalizedEntries = normalize(sandbox.normalizeRepoCacheEntries([
    {
      key: 'owner/repo|tldr|h1',
      repo: 'owner/repo',
      pathname: '/owner/repo/tree/main/packages/a',
      tldrContent: '- 核心定位：子包',
      complete: true,
      updatedAt: 300,
    },
    {
      key: 'owner/repo|corrupt|html',
      repo: 'owner/repo',
      translatedHtml: '<p>[object Object]</p>',
      tldrContent: '',
      complete: false,
      updatedAt: 200,
    },
    {
      key: 'owner/repo|corrupt|tldr',
      repo: 'owner/repo',
      translatedHtml: '',
      tldrContent: '[object Object]',
      complete: false,
      updatedAt: 150,
    },
    {
      key: 'owner/repo|empty|both',
      repo: 'owner/repo',
      translatedHtml: '',
      tldrContent: '',
      complete: false,
      updatedAt: 100,
    },
  ]));
  assert.strictEqual(normalizedEntries.length, 1, '损坏或全空缓存条目不得通过 normalizeRepoCacheEntries 过滤');
  assert.strictEqual(normalizedEntries[0].pathname, '/owner/repo/tree/main/packages/a');

  storedRepoCache = [];
  vm.runInContext('readmeRuntime.repoCacheLoaded = false; readmeRuntime.repoCacheMap.clear();', sandbox);
  await origUpsertRepoCachedTranslation('owner/repo|empty|skip', {
    repo: 'owner/repo',
    translatedHtml: '',
    tldrContent: '',
  });
  assert.strictEqual(storedRepoCache.length, 0, '全空载荷不应写入仓库缓存');
  await origUpsertRepoCachedTranslation('owner/repo|tldr|sub', {
    repo: 'owner/repo',
    pathname: '/owner/repo/tree/main/packages/b',
    sourceHash: 'subhash',
    tldrContent: '- 核心定位：B 包',
    complete: true,
  });
  assert.strictEqual(storedRepoCache[0].pathname, '/owner/repo/tree/main/packages/b');

  // 15. sanitizeCachedHtmlTree 应移除 <style> 与非法 srcset，并保留合法 HTTPS srcset
  const dangerousStyle = { tagName: 'STYLE', removed: false, remove() { this.removed = true; } };
  const imgBadSrcset = {
    tagName: 'IMG',
    attrs: [{ name: 'srcset', value: 'javascript:alert(1) 1x, https://github.com/a.png 2x' }],
    get attributes() { return this.attrs; },
    hasAttribute(n) { return this.attrs.some((a) => a.name === n); },
    getAttribute(n) { return this.attrs.find((a) => a.name === n)?.value ?? null; },
    removeAttribute(n) { this.attrs = this.attrs.filter((a) => a.name !== n); },
  };
  const imgGoodSrcset = {
    tagName: 'IMG',
    attrs: [{ name: 'srcset', value: 'https://github.com/a.png 1x, https://github.com/b.png 2x' }],
    get attributes() { return this.attrs; },
    hasAttribute(n) { return this.attrs.some((a) => a.name === n); },
    getAttribute(n) { return this.attrs.find((a) => a.name === n)?.value ?? null; },
    removeAttribute(n) { this.attrs = this.attrs.filter((a) => a.name !== n); },
  };
  sandbox.sanitizeCachedHtmlTree({
    querySelectorAll: (sel) => (sel === '*' ? [dangerousStyle, imgBadSrcset, imgGoodSrcset] : [dangerousStyle]),
  });
  assert.strictEqual(dangerousStyle.removed, true, 'sanitizeCachedHtmlTree 应移除 style 标签');
  assert.strictEqual(imgBadSrcset.hasAttribute('srcset'), false, '非法 srcset 应被清除');
  assert.strictEqual(imgGoodSrcset.hasAttribute('srcset'), true, '合法 HTTPS srcset 应保留');

  // 16. 渐进式翻译并发度应严格控制在 TRANSLATION_CONCURRENCY (3) 以内，避免双层并发放大
  let activeCalls = 0;
  let maxActiveCalls = 0;
  sandbox.translateBatch = async (batch) => {
    activeCalls += 1;
    if (activeCalls > maxActiveCalls) maxActiveCalls = activeCalls;
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeCalls -= 1;
    return { translations: batch.map((item) => `已翻:${item}`), tokens: 10 };
  };
  vm.runInContext(`
    FeatureSet.readme_enable_progressive = true;
    readmeRuntime.translationCache.clear();
    readmeRuntime.preservedCache.clear();
  `, sandbox);
  const longGroupsDoc = buildDocTree(
    Array.from({ length: 12 }, (_, idx) => ({
      text: `Paragraph number ${idx + 1} with ${'x'.repeat(2200)} detailed English explanation.`,
    })),
  );
  longGroupsDoc.childNodes.forEach((el) => { el.parentElement = longGroupsDoc; });
  sandbox.getRepoCachedTranslation = async () => null;
  await sandbox.translateReadmeElement(longGroupsDoc, 'progressive-concurrency', { events: [] });
  assert.ok(maxActiveCalls <= 3, `渐进式翻译峰值并发不得超过 3，实际为 ${maxActiveCalls}`);
  vm.runInContext('FeatureSet.readme_enable_progressive = false;', sandbox);

  // 17. 二分拆批回退时，父批次失败消耗的 error.tokens 必须累计进 totalTokens
  sandbox.translateBatch = async (batch) => {
    if (batch.length === 2) {
      return { translations: ['仅返回一条触发数量不匹配'], tokens: 80 };
    }
    if (batch[0] === 'First item') return { translations: ['第一项'], tokens: 30 };
    return { translations: ['第二项'], tokens: 40 };
  };
  const splitRes = await sandbox.translateBatchWithFallback(['First item', 'Second item'], providerConfig);
  assert.strictEqual(splitRes.tokens, 150, '二分回退总 tokens 应包含失败父批次消耗的 80 tokens');

  // 18. isExtensionContextInvalidatedError 识别规范化中文失效错误，瞬态 502/503/504/SSL EOF 自动重试 1 次
  assert.strictEqual(
    sandbox.isExtensionContextInvalidatedError(new Error('插件上下文已失效，请刷新当前 GitHub 页面后重试。')),
    true,
    '规范化中文上下文失效错误应被正确识别',
  );
  assert.strictEqual(
    sandbox.isExtensionContextInvalidatedError({ code: 'GHCN_CONTEXT_INVALIDATED', message: 'other' }),
    true,
  );

  let gatewayAttempts = 0;
  sandbox.translateBatch = async () => {
    gatewayAttempts += 1;
    if (gatewayAttempts === 1) {
      throw new Error('翻译请求失败 (502 Bad Gateway): {"error": "<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING]>"}');
    }
    return { translations: ['重试成功'], tokens: 12 };
  };
  const recoveredRes = await sandbox.translateBatchWithFallback(['Retry item'], providerConfig);
  assert.strictEqual(gatewayAttempts, 2, '瞬态 502 SSL EOF 错误应自动重试 1 次并恢复');
  assert.deepStrictEqual(Array.from(recoveredRes.translations), ['重试成功']);

  for (const nonTransientError of [
    new Error('HTTP 502：接口返回 HTML 页面而非翻译 API 数据，请检查 API 地址及网络状态。'),
    new Error('翻译请求失败 (401 Unauthorized): invalid api key'),
    new Error('插件上下文已失效，请刷新当前 GitHub 页面后重试。'),
  ]) {
    let attempts = 0;
    sandbox.translateBatch = async () => {
      attempts += 1;
      throw nonTransientError;
    };
    await assert.rejects(sandbox.translateBatchWithFallback(['No retry'], providerConfig));
    assert.strictEqual(attempts, 1, `非瞬态错误不得重试: ${nonTransientError.message}`);
  }

  // 19. isPlausiblePreservedText 放行 brpc/vllm/k8s 等全小写技术缩写，不放行普通英文单词
  for (const lowercaseTech of ['brpc', 'grpc', 'vllm', 'k8s', 'utf8', 'http2']) {
    assert.strictEqual(isPlausiblePreservedText(lowercaseTech), true, `全小写技术缩写 ${lowercaseTech} 应允许保持原文`);
  }
  for (const plainWord of ['slug', 'try', 'by', 'overview', 'install']) {
    assert.strictEqual(isPlausiblePreservedText(plainWord), false, `普通英文单词 ${plainWord} 不应被误判为技术缩写`);
  }
}

runReadmePipelineTests()
  .then(() => console.log('PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
