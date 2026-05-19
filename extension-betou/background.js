// ===== Service Worker v4.0 - Betou Aviator =====
let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  totalErros: 0,
  versao: '4.0',
  abasAbertas: 0,
  ultimoUpdate: null,
  ultimaRodada: null
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.tipo === 'status') {
    if (msg.ultimaVela !== undefined) estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas = msg.totalEnviadas;
    if (msg.conectada !== undefined) estado.conectada = msg.conectada;
    if (msg.ultimaRodada !== undefined) {
      estado.ultimaRodada = msg.ultimaRodada;
      estado.ultimoUpdate = Date.now();
    }
    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
  }

  if (msg.tipo === 'getStatus') {
    chrome.tabs.query({
      url: [
        'https://betou.bet.br/*',
        'https://*.betou.bet.br/*',
        'https://*.spribegaming.com/*'
      ]
    }, (tabs) => {
      estado.abasAbertas = tabs ? tabs.length : 0;
      if (estado.ultimoUpdate && Date.now() - estado.ultimoUpdate > 90000) {
        estado.conectada = false;
      }
      chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    });
    return true;
  }
  return false;
});

// Keepalive Kiwi/Android
setInterval(() => chrome.storage.local.set({ _ka: Date.now() }), 25000);

console.log('[BetouWorker] v4.0 ativo');
