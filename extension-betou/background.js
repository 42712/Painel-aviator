// ===== Service Worker - Betou Coletor v3.3 =====
// Injeta dinamicamente com chrome.scripting para maior compatibilidade

let estado = {
  conectada: false,
  ultimaVela: '—',
  totalEnviadas: 0,
  versao: '3.3',
  abasAbertas: 0,
  ultimaAtualizacao: null
};

async function injetarContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
    console.log('[BetouColetor] content.js injetado na aba', tabId);
  } catch (e) {
    console.log('[BetouColetor] Erro ao injetar:', e.message);
  }
}

// Injeta automaticamente em TODAS as abas que carregam betou ou spribegaming
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    const url = tab.url.toLowerCase();
    if (
      url.includes('betou.bet.br') ||
      url.includes('spribegaming.com')
    ) {
      setTimeout(() => injetarContentScript(tabId), 500);
    }
  }
});

// Escuta mensagens do content.js e do popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (sender.tab && msg.tipo === 'status') {
    if (msg.ultimaVela)           estado.ultimaVela = msg.ultimaVela;
    if (msg.totalEnviadas !== undefined) estado.totalEnviadas = msg.totalEnviadas;
    if (msg.conectada !== undefined)     estado.conectada = msg.conectada;
    estado.ultimaAtualizacao = Date.now();

    chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    return false;
  }

  if (msg.tipo === 'getStatus') {
    chrome.tabs.query({}, (tabs) => {
      estado.abasAbertas = tabs.filter(t =>
        t.url && (t.url.includes('betou.bet.br') || t.url.includes('spribegaming.com'))
      ).length;

      if (estado.ultimaAtualizacao && Date.now() - estado.ultimaAtualizacao > 60000) {
        estado.conectada = false;
      }

      chrome.runtime.sendMessage({ tipo: 'statusAtualizado', ...estado }).catch(() => {});
    });
    return true;
  }

  // chrome.scripting API - injetar manualmente
  if (msg.tipo === 'injetar' && msg.tabId) {
    injetarContentScript(msg.tabId).then(sendResponse);
    return true;
  }

  return false;
});

// Injeção também ao instalar/atualizar
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('betou.bet.br') || tab.url.includes('spribegaming.com'))) {
        setTimeout(() => injetarContentScript(tab.id), 1000);
      }
    }
  });
});

// Keep-alive para service worker
setInterval(() => {
  chrome.storage.local.set({ _keepalive: Date.now() });
}, 25000);

console.log('[BetouColetor] Service worker v3.3 ativo');
