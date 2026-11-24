#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const popupCss = fs.readFileSync(path.resolve(__dirname, '../chrome/popup/popup.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const expectedVersion = '3.1.5';
const manifests = ['chrome', 'edge', 'firefox'].map((browser) => ({
  browser,
  manifest: JSON.parse(fs.readFileSync(path.resolve(__dirname, `../${browser}/manifest.json`), 'utf8')),
}));

assert.strictEqual(pkg.version, expectedVersion, `package.json 版本号应为 ${expectedVersion}`);

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
  assert.strictEqual(
    Object.hasOwn(manifest, 'host_permissions'),
    false,
    `${browser} manifest 不应包含冗余顶层 host_permissions`,
  );
  assert.deepStrictEqual(manifest.permissions, ['storage'], `${browser} manifest 权限应仅保留 storage`);
  assert.ok(
    Array.isArray(manifest.optional_host_permissions) && manifest.optional_host_permissions.length > 0,
    `${browser} manifest 应保留 optional_host_permissions`,
  );
}

console.log('PASS');
