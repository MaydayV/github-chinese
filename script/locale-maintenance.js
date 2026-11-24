'use strict';

// Offline tools: only read bundled dictionaries and explicitly supplied local samples.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'chrome/src/core/maintenance-tools.js'), 'utf8'), context);
const T = context.GhcnMaintenance;
const read = browser => fs.readFileSync(path.join(ROOT, browser, 'locals.js'), 'utf8');
function load(browser) { const sandbox = {}; vm.runInNewContext(read(browser), sandbox, { timeout: 5000 }); return sandbox.I18N; }
function staticConflicts(source) {
  const literal = text => { try { return JSON.parse(text); } catch { return vm.runInNewContext(text, {}, { timeout: 100 }); } };
  const valueRe = /\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/y;
  const result = [];
  for (const match of source.matchAll(/(?:"static"|'static'|\bstatic)\s*:\s*\{/g)) {
    const seen = new Map(); let depth = 1;
    for (let i = match.index + match[0].length; i < source.length && depth; i++) {
      if (source.slice(i, i + 2) === '//') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
      if (source.slice(i, i + 2) === '/*') { const end = source.indexOf('*/', i + 2); if (end < 0) break; i = end + 1; continue; }
      const char = source[i];
      if (char === '"' || char === "'" || char === '`') {
        const start = i;
        for (i++; i < source.length; i++) { if (source[i] === '\\') i++; else if (source[i] === char) break; }
        if (depth !== 1 || char === '`') continue;
        valueRe.lastIndex = i + 1;
        const value = valueRe.exec(source);
        if (!value) continue;
        const keyEnd = i;
        i += value[0].length;
        const key = literal(source.slice(start, keyEnd + 1)), target = literal(value[1]);
        if (seen.has(key) && seen.get(key) !== target) result.push(`行 ${source.slice(0, start).split('\n').length}: 同一 static 块存在冲突译文 ${key}`);
        seen.set(key, target);
      } else if (char === '{') depth++; else if (char === '}') depth--;
    }
  }
  return result;
}
function check() {
  const primary = read('chrome');
  let pages = 0, entries = 0, rules = 0, attributes = 0;
  const warnings = staticConflicts(primary);
  const topLevelSeen = new Map();
  for (const match of primary.matchAll(/^I18N\["zh-CN"\]\["([^"]+)"\]\s*=/gm)) {
    const pageKey = match[1];
    const lineNo = primary.slice(0, match.index).split('\n').length;
    if (topLevelSeen.has(pageKey)) {
      warnings.push(`行 ${lineNo}: 重复定义页面词库 ${pageKey}（首次定义于行 ${topLevelSeen.get(pageKey)}）`);
    } else {
      topLevelSeen.set(pageKey, lineNo);
    }
  }
  const routeSkip = new Set(['repository/pull_issue_public', 'repository/issues_public', 'repository/pulls_public', 'repository/issues-sidebar']);
  for (const browser of ['chrome', 'edge', 'firefox']) {
    if (read(browser) !== primary) throw new Error(`${browser} 词库与 Chrome 不一致。`);
    const i18n = load(browser);
    const locale = i18n['zh-CN'];
    const { rePagePathRepo, rePagePathOrg } = i18n.conf || {};
    for (const [page, dictionary] of Object.entries(locale)) {
      if (!dictionary || typeof dictionary !== 'object') continue;
      if (browser === 'chrome') {
        pages++;
        if (!routeSkip.has(page)) {
          if (page.startsWith('repository/') && rePagePathRepo) {
            const sub = page.slice('repository/'.length);
            const m = (`/o/r/${sub}`).match(rePagePathRepo);
            if (!m || `repository/${m[1]}` !== page) {
              warnings.push(`页面路由未匹配或被覆盖: ${page} (实际命中: ${m ? `repository/${m[1]}` : 'null'})`);
            }
          } else if (page.startsWith('orgs/') && !page.endsWith('-public') && !page.endsWith('-menu') && rePagePathOrg) {
            const sub = page.slice('orgs/'.length);
            const m = (`/orgs/org/${sub}`).match(rePagePathOrg) || (`/org/${sub}`).match(rePagePathOrg);
            const got = m ? `orgs/${m[1] || m.slice(-1)[0]}` : null;
            if (got !== page) {
              warnings.push(`组织路由未匹配或被覆盖: ${page} (实际命中: ${got || 'null'})`);
            }
          }
        }
      }
      for (const [source, target] of Object.entries(dictionary.static || {})) {
        if (typeof target !== 'string' || !source.trim()) throw new Error(`${browser}/${page} 词条格式错误`);
        if (browser === 'chrome') {
          entries++;
          if (source !== source.trim() || /\s{2,}/.test(source)) {
            warnings.push(`${page}: 静态词条含首尾或连续空白 ${JSON.stringify(source)}`);
          }
        }
      }
      const seen = new Map();
      for (const [pattern, target] of dictionary.regexp || []) {
        if (Object.prototype.toString.call(pattern) !== '[object RegExp]' && typeof pattern !== 'string' || typeof target !== 'string' && typeof target !== 'function') throw new Error(`${page} 正则格式错误`);
        const key = String(pattern);
        if (browser === 'chrome') {
          rules++;
          if (seen.has(key) && seen.get(key) !== String(target)) warnings.push(`${page}: 同一正则对应不同译文 ${key}`);
        }
        seen.set(key, String(target));
      }
      if (dictionary.attributes !== undefined) {
        if (!Array.isArray(dictionary.attributes)) throw new Error(`${browser}/${page} attributes 格式错误`);
        for (const rule of dictionary.attributes) {
          if (!Array.isArray(rule) || rule.length < 3 || rule.length > 4) throw new Error(`${browser}/${page} attributes 规则长度错误`);
          const [selector, attrName, translations, pathname] = rule;
          if (typeof selector !== 'string' || !selector.trim() || typeof attrName !== 'string' || !attrName.trim()) {
            throw new Error(`${browser}/${page} attributes 选择器或属性名错误`);
          }
          if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
            throw new Error(`${browser}/${page} attributes 译文表格式错误`);
          }
          for (const [sourceKey, targetVal] of Object.entries(translations)) {
            if (typeof targetVal !== 'string' || !sourceKey.trim()) throw new Error(`${browser}/${page} attributes 词条格式错误`);
            if (browser === 'chrome') attributes++;
          }
          if (pathname !== undefined && Object.prototype.toString.call(pathname) !== '[object RegExp]') {
            throw new Error(`${browser}/${page} attributes 路径正则格式错误`);
          }
        }
      }
    }
  }
  console.log(JSON.stringify({ pages, expandedStaticEntries: entries, expandedRegexRules: rules, expandedAttributeRules: attributes, warnings }, null, 2));
  if (process.argv.includes('--strict') && warnings.length) process.exitCode = 1;
}
function samples(filename) {
  const text = fs.readFileSync(filename === '-' ? 0 : filename, 'utf8');
  if (text.length > 2000000) throw new Error('样本不得超过 2 MB。');
  const input = JSON.parse(text);
  if (input.format !== 'ghcn-ui-misses' || input.version !== 1 || !Array.isArray(input.rows)) throw new Error('请提供插件导出的漏译清单。');
  const rows = new Map();
  for (const row of input.rows.slice(0, 2000)) {
    if (!row || !/^[a-z0-9/_-]{1,100}$/i.test(row.page || '') || !T.collectable(row.text)) continue;
    const normalized = T.normalize(row.text);
    const key = row.page + '\n' + normalized;
    const prev = rows.get(key);
    const addCount = Math.max(1, Math.min(1000, Number(row.count) || 1));
    rows.set(key, { page: row.page, text: normalized, count: (prev?.count || 0) + addCount });
  }
  return [...rows.values()];
}
function coverage(rows) {
  const locale = load('chrome')['zh-CN'];
  let covered = 0;
  const missing = [];
  for (const row of rows) {
    const page = locale[row.page];
    const lookupStatic = (dict, key) => (dict && Object.hasOwn(dict, key) ? dict[key] : undefined);
    let translated = lookupStatic(page?.static, row.text) ?? lookupStatic(locale.public?.static, row.text);
    if (translated === undefined) {
      for (const [, , translations] of [...(page?.attributes || []), ...(locale.public?.attributes || [])]) {
        const hit = lookupStatic(translations, row.text);
        if (typeof hit === 'string' && hit !== '' && hit !== row.text) { translated = hit; break; }
      }
    }
    if (translated === undefined) for (const [pattern, target] of [...(page?.regexp || []), ...locale.public.regexp]) {
      const result = row.text.replace(pattern, target);
      if (result !== row.text) { translated = result; break; }
    }
    if (typeof translated === 'string' && translated !== '' && translated !== row.text) covered++; else missing.push(row);
  }
  return { sampleCount: rows.length, covered, coverage: rows.length ? covered / rows.length : null, missing };
}
try {
  const command = process.argv[2] || 'check';
  if (command === 'check') check();
  else if (command === 'harvest' || command === 'coverage') {
    if (!process.argv[3]) throw new Error('需要指定导出的 JSON 文件路径。');
    const rows = samples(process.argv[3]);
    console.log(JSON.stringify(command === 'harvest' ? { format: 'ghcn-ui-misses', version: 1, rows } : coverage(rows), null, 2));
  } else throw new Error('用法：node script/locale-maintenance.js check [--strict] | harvest 文件.json | coverage 文件.json');
} catch (error) { console.error(error.message); process.exitCode = 1; }
