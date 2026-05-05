#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const popupCss = fs.readFileSync(path.resolve(__dirname, '../chrome/popup/popup.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../chrome/manifest.json'), 'utf8'));

assert.strictEqual(
  /(\.usage-note\s*\{[\s\S]*?text-align:\s*center;)/m.test(popupCss),
  true,
  'usage-note 文案应居中显示',
);

assert.strictEqual(
  manifest.version,
  '2.2.1',
  'manifest 版本号应更新为 2.2.1',
);

console.log('PASS');
