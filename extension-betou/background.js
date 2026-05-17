// Service worker Betou - relay de mensagens e heartbeat
let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  versao: '2.0'
};

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab && msg.tipo === 'status') {
    if (msg.ultimaVela) estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas = msg.totalEnviadas;
    estado.conectada = msg.conectada !== undefined ? msg.conectada : estado.conectada;

    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    return false;
  }

  if (msg.tipo === 'getStatus') {
    chrome.tabs.query({ url: ['https://betou.bet.br/games/spribe/aviator*'] }, (tabs) => {
      chrome.runtime.sendMessage({
        tipo: 'statusAtualizado',
        conectada: estado.conectada,
        ultimaVela: estado.ultimaVela,
        totalEnviadas: estado.totalEnviadas,
        versao: estado.versao,
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
  versao: '2.0',
  abasAbertas: 0
}).catch(() => {});

console.log('[BetouColetor] Service worker ativo v2.0');
