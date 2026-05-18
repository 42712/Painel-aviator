// ===== Background - Betou Coletor v4.3 =====
const SERVER_URL = "https://painel-aviator.onrender.com";

let totalEnviadas = 0;
let ultimaVela = null;
let abasAtivas = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
  chrome.alarms.create("serverPing", { periodInMinutes: 2 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keepAlive", { periodInMinutes: 1 });
  chrome.alarms.create("serverPing", { periodInMinutes: 2 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "serverPing") {
    fetch(`${SERVER_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        heartbeat: true,
        token: 'default',
        aviator: 0,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }
});

function atualizarAbas() {
  chrome.tabs.query({ url: ["*://*.betou.bet.br/*", "*://*.spribegaming.com/*"] }, (tabs) => {
    abasAtivas.clear();
    tabs.forEach(tab => abasAtivas.add(tab.id));
    enviarStatus();
  });
}

function enviarStatus() {
  chrome.runtime.sendMessage({
    tipo: 'statusAtualizado',
    conectada: true,
    ultimaVela: ultimaVela || '—',
    totalEnviadas: totalEnviadas,
    abasAbertas: abasAtivas.size
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.tipo === 'novaRodada') {
    totalEnviadas++;
    ultimaVela = `${msg.multiplicador}x #${msg.rodada_id}`;
    enviarStatus();
  }
  if (msg.tipo === 'status') {
    if (msg.ultimaVela) { ultimaVela = msg.ultimaVela; totalEnviadas = msg.totalEnviadas || totalEnviadas; }
    enviarStatus();
  }
  if (msg.tipo === 'getStatus') {
    enviarStatus();
  }
  if (msg.type === "AVIATOR_PING") sendResponse({ alive: true });
});

setInterval(atualizarAbas, 10000);
setTimeout(atualizarAbas, 1000);

console.log('[Betou] Background v4.3');
