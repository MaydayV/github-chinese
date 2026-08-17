'use strict';

const HOMEPAGE_URL = 'https://maydayv.github.io/github-chinese/';

function changelogUrl(version) {
  return `${HOMEPAGE_URL}#v${version.replace(/\./g, '-')}`;
}

async function showUpdateBadge() {
  await chrome.action.setBadgeBackgroundColor({ color: '#1f883d' });
  await chrome.action.setBadgeText({ text: '新' });
}

// 商店安装的插件由浏览器自动更新，这里只在更新装好之后留一条「看看改了什么」的提示，
// 不主动抢标签页。提示状态由 popup 消费并清除。
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason !== 'update') return;

  const version = chrome.runtime.getManifest().version;
  if (!version || version === previousVersion) return;

  await chrome.storage.local.set({
    update_notice: { version, previousVersion, url: changelogUrl(version) },
  });
  await showUpdateBadge();
});

// 角标不跨浏览器重启保留，重启后按未读状态补回
chrome.runtime.onStartup.addListener(async () => {
  const { update_notice: notice } = await chrome.storage.local.get('update_notice');
  if (notice?.version) await showUpdateBadge();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ghcn-proxy-fetch') return false;

  (async () => {
    try {
      const { url, method = 'GET', headers = {}, body } = message.payload || {};

      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      const text = await response.text();
      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: text,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        statusText: 'FETCH_FAILED',
        body: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});
