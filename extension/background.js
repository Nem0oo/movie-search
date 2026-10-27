function enableSidePanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanelOnClick);
chrome.runtime.onStartup.addListener(enableSidePanelOnClick);
