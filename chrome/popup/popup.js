'use strict';

const defaults = {
  enable_extension: true
};

const HOMEPAGE_URL = 'https://maydayv.github.io/github-chinese/';
const CHANGELOG_URL = `${HOMEPAGE_URL}#changelog`;

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

async function openTab(url) {
  await chrome.tabs.create({ url });
  window.close();
}

async function clearUpdateNotice() {
  await chrome.storage.local.remove('update_notice');
}

// 更新提示由 background 在版本更新后写入。打开 popup 即视为已看到，先摘掉角标；
// 横幅本身留到用户点开更新日志或手动忽略为止。
async function initUpdateNotice() {
  const notice = byId('updateNotice');
  if (!notice) return;

  const { update_notice: pending } = await chrome.storage.local.get('update_notice');
  if (!pending?.version) return;

  await chrome.action.setBadgeText({ text: '' });

  const text = byId('updateNoticeText');
  if (text) text.textContent = `已更新到 v${pending.version} · 看看改了什么`;
  notice.hidden = false;

  byId('updateNoticeOpen')?.addEventListener('click', async () => {
    await clearUpdateNotice();
    openTab(pending.url || CHANGELOG_URL);
  });

  byId('updateNoticeClose')?.addEventListener('click', async () => {
    await clearUpdateNotice();
    notice.hidden = true;
  });
}

async function init() {
  const settings = await chrome.storage.sync.get(defaults);

  Object.keys(defaults).forEach((key) => {
    const el = byId(key);
    if (!el) return;

    el.checked = Boolean(settings[key]);
    updateStateText(el.checked);

    el.addEventListener('change', async () => {
      const nextChecked = el.checked;
      try {
        await chrome.storage.sync.set({ [key]: nextChecked });
        updateStateText(nextChecked);
        await refreshActiveGithubPage();
      } catch (error) {
        el.checked = !nextChecked;
        updateStateText(!nextChecked);
        const status = byId('status');
        if (status) status.textContent = error?.message || '开关状态保存失败，请重试。';
      }
    });
  });

  byId('openOptions')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  await initUpdateNotice();
  const exclude = byId('excludeCurrent');
  const excludeStatus = byId('excludeStatus');
  const showExcludeStatus = (message) => {
    if (excludeStatus) {
      excludeStatus.textContent = message;
      excludeStatus.hidden = !message;
    } else if (byId('status')) {
      byId('status').textContent = message;
    }
  };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const current = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'ghcn-current-page' }) : null;
    if (!current?.scope) { exclude.disabled = true; return; }
    if (current.inheritedExclusion) {
      exclude.textContent = '此页被范围排除（设置）';
      exclude.addEventListener('click', () => chrome.runtime.openOptionsPage());
      return;
    }
    let normalizedScope = '';
    if (!current.excluded) {
      try {
        normalizedScope = GhcnMaintenance.scope(current.scope);
      } catch (error) {
        exclude.disabled = true;
        showExcludeStatus(error.message);
        return;
      }
    }
    exclude.textContent = current.excluded ? '恢复当前页面翻译' : '排除当前页面';
    exclude.addEventListener('click', async () => {
      exclude.disabled = true;
      showExcludeStatus('');
      try {
        const key = GhcnMaintenance.DATA_KEY;
        const data = GhcnMaintenance.validateData((await chrome.storage.local.get(key))[key] || {});
        if (current.excluded) {
          const slash = current.scope.indexOf('/');
          const hostname = slash >= 0 ? current.scope.slice(0, slash) : current.scope;
          const pathname = slash >= 0 ? current.scope.slice(slash) : '/';
          data.excluded = data.excluded.filter(rule => !GhcnMaintenance.matches(rule, { hostname, pathname }));
        } else {
          data.excluded.push(normalizedScope);
        }
        await chrome.storage.local.set({ [key]: GhcnMaintenance.validateData(data) });
        await refreshActiveGithubPage();
        window.close();
      } catch (error) { showExcludeStatus(error.message); exclude.disabled = false; }
    });
  } catch { if (exclude) exclude.disabled = true; }
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
