// ===== Background - Betou Coletor v4.0 =====
const SERVER_URL = "https://painel-aviator.onrender.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keepAlive",  { periodInMinutes: 1 });
  chrome.alarms.create("serverPing", { periodInMinutes: 2 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keepAlive",  { periodInMinutes: 1 });
  chrome.alarms.create("serverPing", { periodInMinutes: 2 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    console.log("[Betou] KeepAlive");
  }
  if (alarm.name === "serverPing") {
    fetch(`${SERVER_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heartbeat: true, token: 'default', aviator: 0, timestamp: new Date().toISOString() })
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.tipo === 'status') {
    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...msg }).catch(() => {});
  }
  if (msg.type === "AVIATOR_PING") sendResponse({ alive: true });
});

console.log('[Betou] Background v4.0');
