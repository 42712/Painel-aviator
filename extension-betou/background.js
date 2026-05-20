// ===== Service Worker v4.1 - Betou Aviator =====
// MV3: estado em chrome.storage.session pra sobreviver a hibernate

const STATE_KEY = 'aviatorEstado';
const TIMEOUT_MS = 90000;

async function getEst() {
  try {
    const d = await chrome.storage.session.get(STATE_KEY);
    return d[STATE_KEY] || { conectada: false, ultimaVela: '—', totalEnviadas: 0, totalErros: 0, ultimaRodada: null, ultimoBeat: 0 };
  } catch { return { conectada: false, ultimaVela: '—', totalEnviadas: 0, totalErros: 0, ultimaRodada: null, ultimoBeat: 0 }; }
}

async function setEst(u) {
  try {
    const d = await chrome.storage.session.get(STATE_KEY);
    await chrome.storage.session.set({ [STATE_KEY]: { ...(d[STATE_KEY] || {}), ...u } });
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.tipo === 'status') {
    setEst({
      conectada: true,
      ultimoBeat: Date.now(),
      ultimaVela: msg.ultimaVela ?? undefined,
      totalEnviadas: msg.totalEnviadas ?? undefined,
      totalErros: msg.totalErros ?? undefined,
      ultimaRodada: msg.ultimaRodada ?? undefined
    });
    return false;
  }

  if (msg.tipo === 'getStatus') {
    getEst().then(e => {
      if (Date.now() - (e.ultimoBeat || 0) > TIMEOUT_MS) e.conectada = false;
      sendResponse(e);
    });
    return true; // async response
  }

  if (msg.tipo === 'zerar') {
    setEst({ totalEnviadas: 0, totalErros: 0 });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// Keepalive
setInterval(() => chrome.storage.local.set({ _ka: Date.now() }).catch(() => {}), 25000);

console.log('[BetouWorker] v4.1 ativo');
