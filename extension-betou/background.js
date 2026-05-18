// Service worker - relay de mensagens entre content script e popup
let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0
};

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Content script -> popup
  if (sender.tab && msg.tipo === 'status') {
    if (msg.ultimaVela) estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas += msg.totalEnviadas;
    estado.conectada = msg.conectada;
    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    return false;
  }

  // Popup -> buscar estado atual
  if (msg.tipo === 'getStatus') {
    chrome.tabs.query({
      url: [
        'https://*.betou.bet.br/*',
        'https://*.spribegaming.com/*'
      ]
    }, (tabs) => {
      chrome.runtime.sendMessage({
        tipo: 'statusAtualizado',
        conectada: estado.conectada,
        ultimaVela: estado.ultimaVela,
        totalEnviadas: estado.totalEnviadas,
        abasAbertas: tabs ? tabs.length : 0
      }).catch(() => {});
    });
    return true;
  }

  return false;
});

// Inicializa
chrome.runtime.sendMessage({
  tipo: 'statusAtualizado',
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  abasAbertas: 0
}).catch(() => {});

console.log('[Betou] Background v1.1');
