/**
 * Service worker: opens the side panel on toolbar click, and opens product
 * pages in a tab with the element-picker content script injected.
 */

// Open the side panel when the toolbar icon is clicked.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    console.error("sidePanel.open failed", e);
  }
});

// Make the side panel openable via the action by default.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "openPickTab") {
    (async () => {
      try {
        const tab = await chrome.tabs.create({ url: msg.url, active: true });
        // Wait for the tab to finish loading, then inject the picker.
        const onUpdated = async (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"],
              });
            } catch (e) {
              console.error("inject failed", e);
            }
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        sendResponse({ ok: true, tabId: tab.id });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async response
  }

  if (msg?.type === "liveExtract") {
    // Navigate the same tab to a product URL, wait for load, inject the picker,
    // then extract all fields with the saved selectors. Resolves with the data.
    (async () => {
      const { tabId, url, fields } = msg;
      try {
        await chrome.tabs.update(tabId, { url, active: true });

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error("timeout"));
          }, 45000);
          const listener = (id, info) => {
            if (id === tabId && info.status === "complete") {
              clearTimeout(timeout);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });

        // let late/JS-rendered content settle
        await new Promise((r) => setTimeout(r, 1200));

        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        const res = await chrome.tabs.sendMessage(tabId, { type: "extract", fields });
        sendResponse({ ok: true, data: res?.data || {} });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (msg?.type === "injectPicker") {
    chrome.scripting
      .executeScript({ target: { tabId: msg.tabId }, files: ["content.js"] })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
