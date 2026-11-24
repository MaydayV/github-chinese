#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'chrome', 'src');
const BROWSERS = ['chrome', 'edge', 'firefox'];
const CONTENT_TARGETS = BROWSERS.map((browser) => path.join(ROOT, browser, 'content.js'));
const SHARED_BROWSER_FILES = [
  'background.js',
  'locals.js',
  'options/options.html',
  'options/options.js',
  'options/options.css',
  'options/maintenance.js',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
];

const MODULES = [
  'core/constants.js',
  'core/maintenance-tools.js',
  'features/maintenance.js',
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

function validateJsSyntax(code, filename) {
  try {
    new vm.Script(code, { filename });
  } catch (err) {
    console.error(`[build] Syntax validation failed (${filename}):`, err.message);
    process.exit(1);
  }
}

function collectSharedSyncPairs() {
  const maintenanceToolsCode = fs.readFileSync(path.join(SRC_DIR, 'core/maintenance-tools.js'), 'utf8');
  validateJsSyntax(maintenanceToolsCode, 'chrome/src/core/maintenance-tools.js');

  const pairs = BROWSERS.map((browser) => ({
    target: path.join(ROOT, browser, 'maintenance-tools.js'),
    content: maintenanceToolsCode,
    isJs: true,
  }));

  for (const rel of SHARED_BROWSER_FILES) {
    const sourcePath = path.join(ROOT, 'chrome', rel);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Shared source file not found: chrome/${rel}`);
    }
    const content = fs.readFileSync(sourcePath, 'utf8');
    const isJs = rel.endsWith('.js');
    if (isJs) {
      validateJsSyntax(content, `chrome/${rel}`);
    }
    for (const browser of BROWSERS) {
      if (browser === 'chrome') continue;
      pairs.push({
        target: path.join(ROOT, browser, rel),
        content,
        isJs,
      });
    }
  }

  return pairs;
}

function main() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check');

  console.log(`[build] Assembling ${MODULES.length} modules from chrome/src/...`);
  const output = assemble();
  validateJsSyntax(output, 'chrome/content.js');
  const sharedPairs = collectSharedSyncPairs();

  const lineCount = output.split('\n').length;
  const byteCount = Buffer.byteLength(output, 'utf8');

  if (isCheckMode) {
    let hasMismatch = false;
    for (const target of CONTENT_TARGETS) {
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
    for (const { target, content } of sharedPairs) {
      const rel = path.relative(ROOT, target);
      if (!fs.existsSync(target)) {
        console.error(`[build --check] Missing shared file: ${rel}`);
        hasMismatch = true;
        continue;
      }
      if (fs.readFileSync(target, 'utf8') !== content) {
        console.error(`[build --check] Shared file ${rel} is out of sync`);
        hasMismatch = true;
      }
    }
    if (hasMismatch) {
      console.error('[build --check] FAILED: Run "node script/build.js" to recompile and sync targets.');
      process.exit(1);
    }
    console.log(`[build --check] OK: All ${CONTENT_TARGETS.length} browser builds and ${sharedPairs.length} shared targets are in sync (${lineCount} lines, ${(byteCount / 1024).toFixed(1)} KB).`);
    return;
  }

  // Write mode (only reached after all syntax validations succeed)
  for (const target of CONTENT_TARGETS) {
    const rel = path.relative(ROOT, target);
    fs.writeFileSync(target, output, 'utf8');
    console.log(`[build] Synchronized -> ${rel}`);
  }
  for (const { target, content } of sharedPairs) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      fs.writeFileSync(target, content, 'utf8');
      console.log(`[build] Synchronized -> ${path.relative(ROOT, target)}`);
    }
  }

  console.log(`[build] Done: Compiled ${MODULES.length} modules into ${lineCount} lines (${(byteCount / 1024).toFixed(1)} KB).`);
}

main();
