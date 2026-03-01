'use strict';

const defaults = {
  enable_extension: true
};

function byId(id) {
  return document.getElementById(id);
}

function updateStateText(enabled) {
  const status = byId('status');
  if (!status) return;

  status.textContent = enabled ? '开关状态：已开启' : '开关状态：已关闭';
  status.classList.toggle('is-on', enabled);
  status.classList.toggle('is-off', !enabled);
}

async function refreshActiveGithubPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'refresh-page' });
    return true;
  } catch {
    return false;
  }
}

async function init() {
  const settings = await chrome.storage.sync.get(defaults);

  Object.keys(defaults).forEach((key) => {
    const el = byId(key);
    if (!el) return;

    el.checked = Boolean(settings[key]);
    updateStateText(el.checked);

    el.addEventListener('change', async () => {
      await chrome.storage.sync.set({ [key]: el.checked });
      updateStateText(el.checked);
      await refreshActiveGithubPage();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    console.error(err);
    const status = byId('status');
    if (status) {
      status.textContent = '状态加载失败';
      status.classList.remove('is-on');
      status.classList.add('is-off');
    }
  });
});
