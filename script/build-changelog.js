#!/usr/bin/env node
'use strict';

/**
 * 以 README.md 的「更新日志」章节为唯一数据源，生成官网 index.html 的更新日志板块。
 *
 *   node script/build-changelog.js          写入 index.html
 *   node script/build-changelog.js --check  只校验是否已同步（CI / 测试用）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const README_FILE = path.join(ROOT, 'README.md');
const PAGE_FILE = path.join(ROOT, 'index.html');
const START_MARK = '<!-- CHANGELOG:START -->';
const END_MARK = '<!-- CHANGELOG:END -->';
const VISIBLE_COUNT = 4;

function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+.*更新日志\s*$/.test(line));
  if (start === -1) throw new Error('README.md 中找不到「更新日志」章节');

  const entries = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line) || /^<div\s+align="right">/.test(line)) break;

    const head = line.match(/^###\s+v([\d.]+)\s*\(([^)]+)\)\s*$/);
    if (head) {
      entries.push({ version: head[1], date: head[2].trim(), points: [] });
      continue;
    }

    const point = line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
    if (point && entries.length) entries[entries.length - 1].points.push(point[1]);
  }

  if (!entries.length) throw new Error('未从 README.md 解析到任何版本条目');
  return entries;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineHtml(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function versionAnchor(version) {
  return `v${version.replace(/\./g, '-')}`;
}

function renderList(entries, pad) {
  const out = [`${pad}<ol class="changelog-list">`];

  for (const entry of entries) {
    out.push(`${pad}  <li class="changelog-item" id="${versionAnchor(entry.version)}">`);
    out.push(`${pad}    <div class="changelog-meta">`);
    out.push(`${pad}      <span class="changelog-version">v${entry.version}</span>`);
    out.push(`${pad}      <time class="changelog-date" datetime="${entry.date}">${entry.date}</time>`);
    out.push(`${pad}    </div>`);
    out.push(`${pad}    <ul class="changelog-points">`);
    entry.points.forEach((point) => out.push(`${pad}      <li>${inlineHtml(point)}</li>`));
    out.push(`${pad}    </ul>`);
    out.push(`${pad}  </li>`);
  }

  out.push(`${pad}</ol>`);
  return out;
}

function renderChangelog(entries, pad) {
  const recent = entries.slice(0, VISIBLE_COUNT);
  const older = entries.slice(VISIBLE_COUNT);
  const out = renderList(recent, pad);

  if (older.length) {
    out.push(`${pad}<details class="changelog-more">`);
    out.push(`${pad}  <summary>查看更早的 ${older.length} 个版本</summary>`);
    out.push(...renderList(older, `${pad}  `));
    out.push(`${pad}</details>`);
  }

  return out.join('\n');
}

function buildPage(page, entries) {
  const startIdx = page.indexOf(START_MARK);
  const endIdx = page.indexOf(END_MARK);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`index.html 中找不到 ${START_MARK} / ${END_MARK} 占位标记`);
  }

  const pad = page.slice(page.lastIndexOf('\n', startIdx) + 1, startIdx);
  const head = page.slice(0, startIdx + START_MARK.length);
  const tail = page.slice(endIdx);

  return `${head}\n${renderChangelog(entries, pad)}\n${pad}${tail}`;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const entries = parseChangelog(fs.readFileSync(README_FILE, 'utf8'));
  const page = fs.readFileSync(PAGE_FILE, 'utf8');
  const next = buildPage(page, entries);

  if (next === page) {
    console.log(`官网更新日志已是最新（${entries.length} 个版本，最新 v${entries[0].version}）`);
    return;
  }

  if (checkOnly) {
    console.error('官网更新日志与 README.md 不同步，请运行：node script/build-changelog.js');
    process.exit(1);
  }

  fs.writeFileSync(PAGE_FILE, next);
  console.log(`已写入官网更新日志（${entries.length} 个版本，最新 v${entries[0].version}）`);
}

main();
