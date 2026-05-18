// ===== Content Script - Betou Coletor (baseado na extensao que funciona) =====
const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_ENVIO = 3;
const DEBOUNCE_DOM = 800;

const isSpribe = location.hostname.includes('spribegaming');
const isBetou = location.hostname.includes('betou');

let ultimasVelas = [];
let ultimoEnvio = 0;
let rodadasVistas = new Set();
let config = { token: 'default', aviator: 1 };

// Carrega config do storage
chrome.storage.sync.get(['token', 'aviator'], (cfg) => {
  if (cfg.token) config.token = cfg.token;
  if (cfg.aviator) config.aviator = parseInt(cfg.aviator);
});

// ===== INVERSAO: /aviator2 no Betou = Painel 1 =====
function getPainel() {
  try {
    if (isBetou && location.href.includes('/aviator2')) return 1;
    return config.aviator || 1;
  } catch(e) { return config.aviator || 1; }
}

// ===== 1. CAPTURA VIA WEBSOCKET (funciona no iframe spribegaming) =====
const NativeWS = window.WebSocket;

window.WebSocket = new Proxy(NativeWS, {
  construct(target, args) {
    const ws = new target(...args);
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        const rodada = extrairRodada(data);
        if (rodada) adicionarVela(rodada);
      } catch (e) { /* ignorado */ }
    });
    return ws;
  }
});

// ===== 2. CAPTURA VIA DOM (fallback - funciona na pagina principal Betou) =====
let timeoutDOM = null;
let ultimoValorDOM = null;
let ultimaRodadaDOM = null;

const observer = new MutationObserver(() => {
  if (timeoutDOM) return;
  timeoutDOM = setTimeout(() => {
    timeoutDOM = null;

    // Tenta capturar o numero da rodada
    let rodadaAtual = null;
    const todosEl = document.querySelectorAll('span, div, h1, h2, h3, p, label, b, strong');
    for (const el of todosEl) {
      if (el.children.length) continue;
      const txt = (el.innerText || el.textContent || "").trim();
      const m = txt.match(/[Rr]odada\s+(\d{4,})/);
      if (m) { rodadaAtual = m[1]; break; }
      const mR = txt.match(/[Rr]ound\s+(\d{4,})/);
      if (mR) { rodadaAtual = mR[1]; break; }
    }

    // Tenta capturar o multiplicador
    const elementos = document.querySelectorAll(
      '[class*="multiplicador"], [class*="multiplier"], ' +
      '[class*="round"], [class*="rodada"], ' +
      '.multiplier, .value, .round-number, ' +
      '.bubble-multiplier, .payout'
    );
    elementos.forEach(el => {
      const texto = el.textContent.trim();
      const mult = parseFloat(texto.replace('x', '').replace(',', '.'));
      if (mult && mult > 0 && mult < 100000) {
        // Se mudou a rodada, reseta o tracking
        if (rodadaAtual && rodadaAtual !== ultimaRodadaDOM) {
          ultimoValorDOM = null;
          ultimaRodadaDOM = rodadaAtual;
        }
        // So envia se o valor mudou (evita duplicatas do mesmo DOM)
        if (mult === ultimoValorDOM) return;
        ultimoValorDOM = mult;

        const agora = Date.now();
        const key = rodadaAtual ? `dom_${rodadaAtual}_${mult.toFixed(2)}` : `dom_${Math.floor(agora / 5000)}_${mult.toFixed(2)}`;
        if (rodadasVistas.has(key)) return;
        rodadasVistas.add(key);
        adicionarVela({
          rodada: rodadaAtual ? parseInt(rodadaAtual) : undefined,
          multiplicador: mult,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
          origem: 'dom',
          capturado_em: agora
        });
      }
    });
  }, DEBOUNCE_DOM);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ===== 3. FUNCOES =====
function extrairRodada(data) {
  if (!data || typeof data !== 'object') return null;
  // Formato 1: { round: 123, multiplier: 1.45 }
  if (data.round && data.multiplier) {
    return { rodada: data.round, mult: data.multiplier };
  }
  // Formato 2: { rodada: 123, mult: 1.45 }
  if (data.rodada && data.mult) {
    return { rodada: data.rodada, mult: data.mult };
  }
  // Formato 3: { id: 123, value: 1.45 }
  if (data.id && data.value) {
    return { rodada: data.id, mult: data.value };
  }
  // Formato 4: { r: 123, m: 1.45 }
  if (data.r && data.m) {
    return { rodada: data.r, mult: data.m };
  }
  // Formato 5: { rodada: 123, multiplicador: 1.45 } (formato do backend)
  if (data.rodada && data.multiplicador) {
    return { rodada: data.rodada, mult: data.multiplicador };
  }
  // Formato 6: array
  if (Array.isArray(data)) {
    return extrairRodada(data[0]);
  }
  // Formato 7: { data: { ... } }
  if (data.data) {
    return extrairRodada(data.data);
  }
  // Formato 8: { payload: { ... } } ou { result: { ... } } ou { args: { ... } }
  if (data.payload) return extrairRodada(data.payload);
  if (data.result) return extrairRodada(data.result);
  if (data.args) return extrairRodada(data.args);

  return null;
}

function adicionarVela(rodada) {
  const id = rodada.rodada || rodada.capturado_em || Date.now();
  if (rodadasVistas.has(id)) return;
  rodadasVistas.add(id);
  if (rodadasVistas.size > 1000) {
    rodadasVistas = new Set([...rodadasVistas].slice(-500));
  }
  ultimasVelas.push({ ...rodada, capturado_em: Date.now() });
  if (ultimasVelas.length > 20) ultimasVelas = ultimasVelas.slice(-20);
  enviarLote();
}

function enviarLote() {
  const agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_ENVIO * 1000) return;
  if (ultimasVelas.length === 0) return;
  ultimoEnvio = agora;
  const lote = [...ultimasVelas];
  ultimasVelas = [];

  // Mapeia os campos para o formato que o backend espera
  const rodadas = lote.map(v => ({
    rodada: v.rodada || 0,
    multiplicador: v.mult || v.multiplicador || 0,
    timestamp: v.timestamp || new Date().toLocaleTimeString('pt-BR'),
    origem: v.origem || 'extensao'
  }));

  fetch(`${SERVER_URL}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou',
      token: config.token,
      aviator: getPainel(),
      rodadas: rodadas,
      timestamp: new Date().toISOString()
    })
  }).then(() => {
    chrome.runtime.sendMessage({
      tipo: 'status',
      conectada: true,
      ultimaVela: lote.length > 0
        ? `${(lote[lote.length-1].mult || lote[lote.length-1].multiplicador || 0).toFixed(2)}x`
        : '—',
      totalEnviadas: lote.length
    }).catch(() => {});
  }).catch(() => {
    // Re-coloca na fila em caso de erro
    ultimasVelas.unshift(...lote);
    if (ultimasVelas.length > 50) ultimasVelas = ultimasVelas.slice(-50);
  });
}

// Heartbeat a cada 30s
setInterval(() => {
  fetch(`${SERVER_URL}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou',
      token: config.token,
      aviator: getPainel(),
      heartbeat: true,
      timestamp: new Date().toISOString()
    })
  }).then(() => {
    chrome.runtime.sendMessage({ tipo: 'status', conectada: true }).catch(() => {});
  }).catch(() => {});
}, 30000);

// Envio periodico forçado a cada 5s (garante que nada fique preso)
setInterval(() => {
  if (ultimasVelas.length > 0) {
    ultimoEnvio = 0; // reseta pra forçar envio
    enviarLote();
  }
}, 5000);

// Anti-throttle: mantem o service worker acordado
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
setInterval(() => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
}, 10000);

console.log(`[Betou Coletor] Ativo | ${location.hostname} | Painel ${getPainel()}`);
