// Клик по иконке – переключаем панель на активной вкладке
browser.browserAction.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith('https://messenger.360.yandex.ru/')) {
    browser.tabs.sendMessage(tab.id, { action: "togglePanel" });
  }
});