#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const popupCss = fs.readFileSync(path.resolve(__dirname, '../chrome/popup/popup.css'), 'utf8');
const expectedVersion = '2.5.3';
const manifests = ['chrome', 'edge', 'firefox'].map((browser) => ({
  browser,
  manifest: JSON.parse(fs.readFileSync(path.resolve(__dirname, `../${browser}/manifest.json`), 'utf8')),
}));

assert.strictEqual(
  /(\.usage-note\s*\{[\s\S]*?text-align:\s*center;)/m.test(popupCss),
  true,
  'usage-note 文案应居中显示',
);

for (const { browser, manifest } of manifests) {
  assert.strictEqual(
    manifest.version,
    expectedVersion,
    `${browser} manifest 版本号应更新为 ${expectedVersion}`,
  );
}

console.log('PASS');
