'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const T = GhcnMaintenance;
  const MISS_ISSUE_URL = 'https://github.com/MaydayV/github-chinese/issues/new?title=' + encodeURIComponent('漏译词库反馈');
  const defaults = { ...DEFAULTS, enable_extension: true, prefer_chinese_readme: true, collect_ui_misses: false };
  let data = { entries: [], excluded: [] };
  const el = id => document.getElementById(id);
  const status = message => { el('maintenanceStatus').textContent = message; };
  const run = fn => async () => { try { await fn(); } catch (error) { status(error.message); } };
  const read = async () => T.validateData((await chrome.storage.local.get(T.DATA_KEY))[T.DATA_KEY] || {});
  const save = async (next, { syncExcludedInput = true } = {}) => {
    const checked = T.validateData(next);
    await chrome.storage.local.set({ [T.DATA_KEY]: checked });
    data = checked; render();
    if (syncExcludedInput) el('excludedPaths').value = data.excluded.join('\n');
    status('已保存。刷新 GitHub 页面后完整生效。');
  };
  function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function input(value, label) {
    const node = document.createElement('input'); node.value = value; node.setAttribute('aria-label', label); return node;
  }
  function button(label, action) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'btn btn-ghost btn-mini'; node.textContent = label; node.addEventListener('click', run(action)); return node;
  }
  function onEnter(node, action) {
    node.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      action();
    });
  }
  function render() {
    const query = el('entrySearch').value.toLowerCase();
    const entries = data.entries.filter(row => (row.source + row.target + row.scope).toLowerCase().includes(query));
    el('entrySummary').textContent = `共 ${data.entries.length} 条，匹配 ${entries.length} 条（每次显示前 50 条）。`;
    const list = el('customEntryList'); list.replaceChildren();
    for (const row of entries.slice(0, 50)) {
      const item = document.createElement('li'); item.className = 'maintenance-row';
      const scope = input(row.scope, '页面范围'), source = input(row.source, '英文原文'), target = input(row.target, '中文译文');
      const saveBtn = button('保存', async () => {
        const current = await read();
        const nextEntry = { scope: scope.value, source: source.value, target: target.value };
        let matched = false;
        const updated = current.entries.map((entry) => {
          if (entry.scope === row.scope && entry.source === row.source) {
            matched = true;
            return nextEntry;
          }
          return entry;
        });
        if (!matched) {
          data = current;
          render();
          throw new Error('该词条已被其他操作修改或删除，已刷新列表。');
        }
        await save({ ...current, entries: updated }, { syncExcludedInput: false });
      });
      [scope, source, target].forEach(field => onEnter(field, () => saveBtn.click()));
      item.append(scope, source, target, saveBtn,
        button('删除', async () => {
          const current = await read();
          await save({ ...current, entries: current.entries.filter(entry => entry.scope !== row.scope || entry.source !== row.source) }, { syncExcludedInput: false });
        }));
      list.append(item);
    }
  }
  el('entrySearch').addEventListener('input', render);
  ['newEntryScope', 'newEntrySource', 'newEntryTarget'].forEach(id => onEnter(el(id), () => el('addCustomEntry').click()));
  el('addCustomEntry').addEventListener('click', run(async () => {
    const current = await read();
    await save({ ...current, entries: [...current.entries, { scope: el('newEntryScope').value, source: el('newEntrySource').value, target: el('newEntryTarget').value }] }, { syncExcludedInput: false });
    el('newEntrySource').value = ''; el('newEntryTarget').value = '';
  }));
  el('saveExcluded').addEventListener('click', run(async () => {
    await save({ ...await read(), excluded: el('excludedPaths').value.split('\n').map(s => s.trim()).filter(Boolean) });
  }));
  for (const key of ['prefer_chinese_readme', 'collect_ui_misses']) {
    el(key).addEventListener('change', run(async () => {
      await chrome.storage.sync.set({ [key]: el(key).checked }); status('已保存。');
    }));
  }
  el('exportEntries').addEventListener('click', run(async () => download('github-chinese-dictionary.json', { format: 'ghcn-dictionary', version: 1, data: await read() })));
  el('importEntries').addEventListener('change', run(async () => {
    const file = el('importEntries').files[0]; if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('词库文件不得超过 2 MB。');
      const payload = JSON.parse(await file.text());
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.format !== 'ghcn-dictionary' || payload.version !== 1) throw new Error('不支持的词库文件。');
      const incoming = T.validateData(payload.data);
      if (!confirm(`导入 ${incoming.entries.length} 条词条？同范围的相同原文将被替换。`)) return;
      const current = await read();
      const merged = new Map(current.entries.map(row => [row.scope + '\n' + row.source, row]));
      incoming.entries.forEach(row => merged.set(row.scope + '\n' + row.source, row));
      await save({ ...current, entries: [...merged.values()] }, { syncExcludedInput: false });
    } finally { el('importEntries').value = ''; }
  }));
  const refreshMisses = async () => {
    const rows = (await chrome.storage.local.get(T.MISS_KEY))[T.MISS_KEY] || [];
    el('missSummary').textContent = `本地记录 ${rows.length} 条；默认关闭，不记录敏感设置页，不上传。`;
    return rows;
  };
  const hideMissExportHint = () => {
    const hint = el('missExportHint');
    if (!hint) return;
    hint.hidden = true;
    hint.replaceChildren();
  };
  el('exportMisses').addEventListener('click', run(async () => {
    const rows = await refreshMisses();
    if (!rows.length) {
      hideMissExportHint();
      status('当前暂无漏译记录，请先开启“记录界面漏译”并浏览 GitHub 页面后再导出。');
      return;
    }
    download('github-chinese-ui-misses.json', { format: 'ghcn-ui-misses', version: 1, rows });
    const hint = el('missExportHint');
    if (hint) {
      const link = document.createElement('a');
      link.href = MISS_ISSUE_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '前往插件仓库提交漏译词库';
      hint.replaceChildren(`已导出 ${rows.length} 条漏译记录（github-chinese-ui-misses.json）。请确认文件不含敏感信息后，前往仓库提交 Issue 并附上该文件，帮助完善词库：`, link);
      hint.hidden = false;
    }
    status('已导出漏译清单，请前往插件仓库提交 Issue 并附上导出的词库文件。');
  }));
  el('refreshMisses').addEventListener('click', run(refreshMisses));
  el('clearMisses').addEventListener('click', run(async () => {
    const result = await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'ghcn-ui-misses', clear: true }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    }));
    if (!result?.ok) throw new Error('清空失败，请重试。');
    hideMissExportHint();
    await refreshMisses();
  }));
  el('exportBackup').addEventListener('click', run(async () => {
    const settings = T.settings(await chrome.storage.sync.get(defaults), defaults, el('backupSecrets').checked);
    download('github-chinese-backup.json', { format: 'ghcn-backup', version: 1, settings, data: await read() });
    status(el('backupSecrets').checked ? '已导出：文件包含密钥，请妥善保管。' : '已导出：不含 API Key、翻译缓存或历史记录。');
  }));
  el('importBackup').addEventListener('change', run(async () => {
    const file = el('importBackup').files[0]; if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('备份文件不得超过 2 MB。');
      const incoming = T.backup(JSON.parse(await file.text()), defaults, el('backupSecrets').checked);
      if (!confirm(`恢复 ${incoming.data.entries.length} 条词条、${incoming.data.excluded.length} 条排除路径及 ${Object.keys(incoming.settings).length} 项设置？当前相关配置会被替换。`)) return;
      const previousSync = await chrome.storage.sync.get(defaults);
      let previousData = { entries: [], excluded: [] };
      try { previousData = await read(); } catch { /* 损坏的旧数据不阻断备份恢复。 */ }
      const safeSettings = { ...incoming.settings };
      for (const flagKey of [
        'enable_readme_translation',
        'enable_issue_pr_translation',
        'enable_collaboration_helper',
        'enable_repo_tldr',
        'readme_enable_token_record',
        'readme_enable_repo_cache',
        'readme_enable_progressive',
        'readme_enable_debug',
      ]) {
        if (Object.hasOwn(defaults, flagKey) || Object.hasOwn(safeSettings, flagKey)) {
          safeSettings[flagKey] = false;
        }
      }
      const originOf = (value) => {
        try {
          const cleaned = String(value || '').trim().replace(/\s+/g, '');
          return cleaned ? new URL(cleaned).origin : '';
        } catch {
          return '';
        }
      };
      for (const [urlKey, keyField] of [
        ['readme_deepl_api_url', 'readme_deepl_api_key'],
        ['readme_google_api_url', 'readme_google_api_key'],
        ['readme_azure_api_url', 'readme_azure_api_key'],
        ['readme_qwen_mt_api_url', 'readme_qwen_mt_api_key'],
        ['readme_index_translate_api_url', 'readme_index_translate_api_key'],
        ['readme_openai_api_url', 'readme_openai_api_key'],
      ]) {
        if (Object.hasOwn(safeSettings, urlKey)
          && !Object.hasOwn(safeSettings, keyField)
          && originOf(safeSettings[urlKey]) !== originOf(previousSync[urlKey])) {
          safeSettings[keyField] = '';
        }
      }
      try {
        await chrome.storage.sync.set(safeSettings);
        await chrome.storage.local.set({ [T.DATA_KEY]: incoming.data });
      } catch (error) {
        try { await chrome.storage.sync.set(previousSync); await chrome.storage.local.set({ [T.DATA_KEY]: previousData }); }
        catch { throw new Error('恢复失败且未能完全回滚，请检查设置。'); }
        throw error;
      }
      location.reload();
    } finally { el('importBackup').value = ''; }
  }));
  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes[T.DATA_KEY]) {
        try {
          const prevExcluded = data.excluded;
          data = T.validateData(changes[T.DATA_KEY].newValue || {});
          render();
          if (JSON.stringify(prevExcluded) !== JSON.stringify(data.excluded)) {
            el('excludedPaths').value = data.excluded.join('\n');
          }
        } catch { /* 忽略外部无效写入。 */ }
      }
      if (changes[T.MISS_KEY]) run(refreshMisses)();
    }
    if (areaName === 'sync') {
      for (const key of ['prefer_chinese_readme', 'collect_ui_misses']) {
        if (changes[key]) el(key).checked = Boolean(changes[key].newValue);
      }
    }
  });
  run(async () => {
    data = await read(); render(); el('excludedPaths').value = data.excluded.join('\n'); await refreshMisses();
    const values = await chrome.storage.sync.get({ prefer_chinese_readme: true, collect_ui_misses: false });
    Object.keys(values).forEach(key => { el(key).checked = values[key]; });
  })();
});
