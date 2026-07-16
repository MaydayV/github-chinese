import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const locales = [
  ['chrome', new URL('../locals.js', import.meta.url)],
  ['edge', new URL('../../edge/locals.js', import.meta.url)],
  ['firefox', new URL('../../firefox/locals.js', import.meta.url)],
];

function loadLocale(file) {
  const context = {};
  createContext(context);
  runInContext(`${readFileSync(file, 'utf8')}\nglobalThis.__I18N = I18N;`, context, { filename: file.pathname });
  return context.__I18N;
}

function translate(rules, source) {
  for (const [pattern, replacement] of rules) {
    const translated = source.replace(pattern, replacement);
    if (translated !== source) return translated;
  }
  return source;
}

test('upstream relative-time regression keeps minutes and months distinct', () => {
  for (const [browser, file] of locales) {
    const publicLocale = loadLocale(file)['zh-CN'].public;
    for (const [source, expected] of Object.entries({
      '1m': '1 分钟之前',
      '1m ago': '1 分钟之前',
      '1mo': '1 个月之前',
      '12mo ago': '12 个月之前',
      '2h': '2 小时之前',
    })) {
      for (const rules of [publicLocale.regexp, publicLocale['time-regexp']]) {
        assert.equal(translate(rules, source), expected, `${browser}: ${source}`);
      }
    }
  }
});

test('upstream issue and PR fixes exist in every browser build', () => {
  for (const [browser, file] of locales) {
    const locales = loadLocale(file);
    const i18n = locales['zh-CN'];
    const issueLocale = i18n['repository/issues'];
    assert.equal(issueLocale.static['Load older activity'], '加载更早的活动', browser);
    assert.equal(issueLocale.static['Load newer activity'], '加载更新的活动', browser);
    assert.equal(issueLocale.static['Collapse sidebar'], '折叠侧边栏', browser);
    assert.equal(issueLocale.static['No projects were found. Please try a different search query.'], '未找到项目。请尝试其他搜索关键词。', browser);
    assert.equal(i18n['repository/releases'].static['Release list'], '发行版列表', browser);
    assert.ok(locales.conf.ignoreSelectorPage['repository/pull'].includes('span.PRIVATE_TreeView-item-content-text'), browser);
    assert.ok(locales.conf.ignoreMutationSelectorPage['repository/pull'].includes('span.PRIVATE_TreeView-item-content-text'), browser);
  }
});
