// ===== Service Worker - Betou Coletor v3.0 =====

let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  versao: '3.0',
  abasAbertas: 0,
  ultimaAtualizacao: null
};

// Escuta mensagens do content.js e do popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Status vindo do content.js (via aba)
  if (sender.tab && msg.tipo === 'status') {
    if (msg.ultimaVela)           estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas = msg.totalEnviadas;
    if (msg.conectada !== undefined)     estado.conectada = msg.conectada;
    estado.ultimaAtualizacao = Date.now();

    // Repassa ao popup (se aberto)
    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    return false;
  }

  // Popup pedindo status atual
  if (msg.tipo === 'getStatus') {
    chrome.tabs.query(
      { url: ['https://betou.bet.br/games/spribe/aviator*', 'https://*.betou.bet.br/games/spribe/aviator*'] },
      (tabs) => {
        estado.abasAbertas = tabs ? tabs.length : 0;

        // Se não houve atualização nos últimos 60s, marca como desconectado
        if (estado.ultimaAtualizacao && Date.now() - estado.ultimaAtualizacao > 60000) {
          estado.conectada = false;
        }

        chrome.runtime.sendMessage({
          tipo: 'statusAtualizado',
          ...estado
        }).catch(() => {});
      }
    );
    return true;
  }

  return false;
});

// Mantém o service worker "vivo" no Kiwi Browser (Android) 
// fazendo uma operação de storage a cada 25 segundos
setInterval(() => {
  chrome.storage.local.set({ _keepalive: Date.now() });
}, 25000);

console.log('[BetouColetor] Service worker ativo v3.0');
