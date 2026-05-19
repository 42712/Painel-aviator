// ===== Service Worker v4.0 - Betou Aviator Collector =====
let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  versao: '4.0',
  abasAbertas: 0,
  ultimaAtualizacao: null,
  ultimaRodada: null
};

// Recebe status do content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab && msg.tipo === 'status') {
    if (msg.ultimaVela !== undefined) estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas = msg.totalEnviadas;
    if (msg.conectada !== undefined) estado.conectada = msg.conectada;
    if (msg.ultimaRodada !== undefined) estado.ultimaRodada = msg.ultimaRodada;
    estado.ultimaAtualizacao = Date.now();

    // Repassa ao popup (se estiver aberto)
    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    return false;
  }

  // Popup solicitou status
  if (msg.tipo === 'getStatus') {
    chrome.tabs.query(
      {
        url: [
          'https://betou.bet.br/*',
          'https://*.betou.bet.br/*',
          'https://*.spribegaming.com/*'
        ]
      },
      (tabs) => {
        estado.abasAbertas = tabs ? tabs.length : 0;

        // Se não recebeu atualização nos últimos 60s, marca desconectado
        if (estado.ultimaAtualizacao && Date.now() - estado.ultimaAtualizacao > 60000) {
          estado.conectada = false;
        }

        chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
      }
    );
    return true;
  }

  return false;
});

// Keep alive para Kiwi Browser / Android
setInterval(() => {
  chrome.storage.local.set({ _keepalive: Date.now() });
}, 20000);

console.log('[BetouCollector] Service worker v4.0 ativo');
