'use strict';

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
