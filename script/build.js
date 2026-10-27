#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'chrome', 'src');
const TARGETS = [
  path.join(ROOT, 'chrome', 'content.js'),
  path.join(ROOT, 'edge', 'content.js'),
  path.join(ROOT, 'firefox', 'content.js')
];

const MODULES = [
  'core/constants.js',
  'core/utils.js',
  'core/storage-cache.js',
  'core/text-filter.js',
  'core/dom-observer.js',
  'features/ui-localization.js',
  'providers/provider-config.js',
  'providers/cloud-translators.js',
  'providers/dispatcher.js',
  'features/markdown-translation.js',
  'features/discussion-translation.js',
  'features/collaboration-helper.js',
  'features/tldr-capsule.js',
  'entry.js'
];

function assemble() {
  const parts = [];
  parts.push("(function (window, document, undefined) {\n    'use strict';\n\n");

  for (const rel of MODULES) {
    const modPath = path.join(SRC_DIR, rel);
    if (!fs.existsSync(modPath)) {
      throw new Error(`Module file not found: ${modPath}`);
    }
    let code = fs.readFileSync(modPath, 'utf8');
    // Strip module header docblock if present
    code = code.replace(/^\/\*\*[\s\S]*?\*\/\n\n?/, '').trimEnd();

    parts.push(`    // ==========================================================================\n    // [Module] ${rel}\n    // ==========================================================================\n\n`);
    parts.push(code + '\n\n');
  }

  parts.push('})(window, document);\n');
  return parts.join('');
}

function main() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check');

  console.log(`[build] Assembling ${MODULES.length} modules from chrome/src/...`);
  const output = assemble();

  // Syntax validation
  try {
    new vm.Script(output, { filename: 'chrome/content.js' });
  } catch (err) {
    console.error('[build] Syntax validation failed:', err.message);
    process.exit(1);
  }

  const lineCount = output.split('\n').length;
  const byteCount = Buffer.byteLength(output, 'utf8');

  if (isCheckMode) {
    let hasMismatch = false;
    for (const target of TARGETS) {
      const rel = path.relative(ROOT, target);
      if (!fs.existsSync(target)) {
        console.error(`[build --check] Missing target file: ${rel}`);
        hasMismatch = true;
        continue;
      }
      const existing = fs.readFileSync(target, 'utf8');
      if (existing !== output) {
        console.error(`[build --check] Target ${rel} is out of sync with chrome/src/`);
        hasMismatch = true;
      }
    }
    if (hasMismatch) {
      console.error('[build --check] FAILED: Run "node script/build.js" to recompile and sync targets.');
      process.exit(1);
    }
    console.log(`[build --check] OK: All ${TARGETS.length} browser builds are in sync with chrome/src/ (${lineCount} lines, ${(byteCount / 1024).toFixed(1)} KB).`);
    return;
  }

  // Write mode
  for (const target of TARGETS) {
    const rel = path.relative(ROOT, target);
    fs.writeFileSync(target, output, 'utf8');
    console.log(`[build] Synchronized -> ${rel}`);
  }

  console.log(`[build] Done: Compiled ${MODULES.length} modules into ${lineCount} lines (${(byteCount / 1024).toFixed(1)} KB).`);
}

main();
