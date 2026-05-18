// ===== Background - Betou Coletor v4.3 =====
const SERVER_URL = "https://painel-aviator.onrender.com";
let totalEnviadas = 0;
let ultimaVela = null;
let ultimoHeartbeat = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("heartbeat", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "heartbeat") {
    fetch(`${SERVER_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heartbeat: true, token: 'default', aviator: 0, timestamp: new Date().toISOString() })
    }).catch(() => {});
    chrome.runtime.getPlatformInfo(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.tipo === 'status') {
    if (msg.ultimaVela) { ultimaVela = msg.ultimaVela; totalEnviadas = msg.totalEnviadas || totalEnviadas; }
    try { chrome.runtime.sendMessage({ tipo: 'statusAtualizado', conectada: true, ultimaVela: ultimaVela || '—', totalEnviadas, abasAbertas: 1 }); } catch(e) {}
  }
  if (msg.tipo === 'getStatus') sendResponse({ conectada: true, ultimaVela: ultimaVela || '—', totalEnviadas, abasAbertas: 1 });
  if (msg.type === "AVIATOR_PING") sendResponse({ alive: true });
});

console.log('[Betou] Background v4.3');
