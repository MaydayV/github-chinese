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

async function refreshActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'refresh-page' });
  } catch {
    await chrome.tabs.reload(tab.id);
  }
}

async function init() {
  const settings = await chrome.storage.sync.get(defaults);
  const toggle = byId('enable_extension');
  if (!toggle) return;

  toggle.checked = Boolean(settings.enable_extension);
  updateStateText(toggle.checked);

  toggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ enable_extension: toggle.checked });
    updateStateText(toggle.checked);
    await refreshActivePage();
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
