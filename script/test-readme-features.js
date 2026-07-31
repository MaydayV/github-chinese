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
  const sandbox = {};
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
  shouldSkipReadmeText('这是一个 GitHub 中文插件，用于仓库界面翻译。'),
  true,
  '中文 README 中夹少量英文时应跳过翻译',
);

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

console.log('PASS');
