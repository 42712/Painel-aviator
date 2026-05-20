// ===== Content Script v4.1 - Betou Aviator Collector =====
// v4.1: injeta MAIN world script para interceptar WS em iframes
// Captura rodadas em tempo real via WebSocket interception + DOM fallback
// Coleta: vela (multiplicador), ID rodada, horário (HH:MM:SS), soma
// Envia para o servidor Render via webhook + SSE keepalive

const SERVER_BASE = "https://painel-aviator.onrender.com";
const WS_CHECK_INTERVAL = 2000;
const DOM_SCAN_INTERVAL = 1500;
const FLUSH_INTERVAL = 3000;
const MAX_BATCH = 50;
const MAX_SEEN = 8000;

// Injeta script no MAIN world (para interceptar WS em iframes)
(function injectMainWorld() {
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('main-world.js');
    s.onload = () => s.remove();
    (document.documentElement || document).appendChild(s);
  } catch(e) { /* pode falhar em alguns iframes */ }
})();

// Listeners para eventos do MAIN world (iframe WS intercept)
window.addEventListener('aviator-ws-data', (e) => {
  if (e.detail) parseWS(e.detail);
});

let domFromMainTimer = null;
window.addEventListener('aviator-dom-text', (e) => {
  if (!e.detail) return;
  if (domFromMainTimer) return;
  domFromMainTimer = setTimeout(() => { domFromMainTimer = null; }, 500);
  const txt = e.detail;
  let m = txt.match(/(\d+(?:[.,]\d{3})*(?:,\d+)?)\s*x/i);
  if (m) {
    let numStr = m[1];
    if (numStr.includes(',') && numStr.includes('.')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (numStr.includes(',')) {
      const afterComma = numStr.split(',')[1];
      if (afterComma && afterComma.length >= 3) {
        numStr = numStr.replace(',', '');
      } else {
        numStr = numStr.replace(',', '.');
      }
    }
    const val = parseFloat(numStr);
    if (!isNaN(val) && val >= 1.0 && val < 100000) {
      const key = `main_${val.toFixed(2)}_${Math.floor(Date.now()/5000)}`;
      if (!ENV.rodadasVistas.has(key)) {
        ENV.rodadasVistas.add(key);
        processarRodada(`main_${Date.now()}`, val);
      }
    }
  }
});

let ENV = {
  rodadasVistas: new Set(),
  lote: [],
  enviadas: 0,
  erros: 0,
  conectado: false,
  ultimaVela: null,
  ultimaRodada: null,
  flushTimer: null,
  enviando: false,
  wsInterceptado: false,
  painel: 1,
  domParserAtivo: false
};

// Carregar config
try { chrome.storage?.sync?.get(['painel'], c => {
  if (c.painel) ENV.painel = parseInt(c.painel);
}); } catch(e) {}

try { chrome.storage?.onChanged?.addListener((ch) => {
  if (ch.painel) ENV.painel = parseInt(ch.painel.newValue) || 1;
}); } catch(e) {}

// ===== UTILITÁRIOS =====
function fmtTime(d) {
  const t = d || new Date();
  if (typeof t === 'string') return t.substring(0,8);
  return t.toTimeString().slice(0,8);
}

function calcSoma(v) {
  let s = 0;
  for (const c of v.toFixed(2)) if (c>='0'&&c<='9') s += parseInt(c);
  return s;
}

function corPorMult(v) {
  if (v < 2) return 'azul';
  if (v < 10) return 'roxa';
  return 'rosa';
}

function detectarPainel() {
  try {
    const u = window.top.location.href;
    if (u.includes('aviator2')) return 2;
    if (u.includes('aviator1')) return 1;
  } catch(e) {}
  return ENV.painel;
}

// ===== ENVIO AO SERVIDOR =====
async function flushBatch() {
  if (ENV.lote.length === 0 || ENV.enviando) return;
  ENV.enviando = true;
  const batch = ENV.lote.splice(0, MAX_BATCH);
  try {
    const r = await fetch(`${SERVER_BASE}/api/webhook`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        painel: detectarPainel(),
        rodadas: batch
      })
    });
    if (r.ok) {
      ENV.enviadas += batch.length;
      console.log(`[Aviator] Enviadas ${batch.length} rodadas | total: ${ENV.enviadas}`);
    } else {
      ENV.erros++;
      ENV.lote.unshift(...batch);
    }
  } catch(e) {
    ENV.erros++;
    ENV.lote.unshift(...batch);
  }
  ENV.enviando = false;
}

function notificarPopup() {
  try {
    chrome.runtime.sendMessage({
      tipo: 'status',
      conectada: ENV.conectado,
      ultimaVela: ENV.ultimaVela,
      totalEnviadas: ENV.enviadas,
      totalErros: ENV.erros,
      ultimaRodada: ENV.ultimaRodada
    });
  } catch(e) {}
}

function processarRodada(rodadaId, mult, ts) {
  if (!rodadaId || mult < 0.01) return;
  const key = String(rodadaId);
  if (ENV.rodadasVistas.has(key)) return;
  ENV.rodadasVistas.add(key);
  if (ENV.rodadasVistas.size > MAX_SEEN) {
    ENV.rodadasVistas = new Set([...ENV.rodadasVistas].slice(-MAX_SEEN/2));
  }

  const v = parseFloat(mult.toFixed(2));
  const tm = fmtTime(ts);
  const s = calcSoma(v);
  const c = corPorMult(v);

  ENV.ultimaVela = `${v.toFixed(2)}x`;
  ENV.conectado = true;
  ENV.ultimaRodada = { rodada: key, multiplicador: v, timestamp: tm, soma: s, cor: c };

  ENV.lote.push({
    rodada: key,
    multiplicador: v,
    timestamp: tm,
    soma: s,
    cor: c,
    painel: detectarPainel()
  });

  console.log(`[Aviator] 🎯 #${key} | ${v.toFixed(2)}x | ${tm} | soma=${s}`);

  notificarPopup();
  if (ENV.lote.length >= 5) flushBatch();
}

// ===== 1. INTERCEPTAÇÃO DE WEBSOCKET =====
// Baseado no Guia Técnico: Spribe usa mensagens JSON via WebSocket
// com formatos: game_end, round_ended, complete, etc.
(function interceptWS() {
  const NativeWS = window.WebSocket;
  if (!NativeWS) {
    console.warn('[Aviator] WebSocket não disponível');
    return;
  }

  const origSend = NativeWS.prototype.send;
  NativeWS.prototype.send = function(data) {
    return origSend.call(this, data);
  };

  window.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) {
      const ws = new Target(...args);
      const url = (args[0] || '').toString().toLowerCase();

      ws.addEventListener('message', function onMsg(ev) {
        try {
          let raw = ev.data;
          if (raw instanceof Blob) {
            const r = new FileReader();
            r.onload = () => parseWS(r.result);
            r.readAsText(raw);
            return;
          }
          if (raw instanceof ArrayBuffer) {
            raw = new TextDecoder().decode(raw);
          }
          if (typeof raw === 'string') parseWS(raw);
        } catch(e) { /* ignorar */ }
      });

      return ws;
    }
  });

  console.log('[Aviator] WebSocket interceptado');
})();

function parseWS(raw) {
  try {
    const msg = JSON.parse(raw);

    // --- Extrair dados da rodada ---
    let rid = null, mult = null;

    // Formato Spribe principal
    if (msg.type === 'game_end' || msg.type === 'round_ended' || msg.type === 'end') {
      rid = msg.data?.round_id || msg.round_id || msg.data?.id;
      mult = msg.data?.multiplier || msg.multiplier || msg.data?.value;
    }
    // Formato evento
    else if (msg.event === 'complete' || msg.event === 'game_complete') {
      rid = msg.round?.id || msg.round_id || msg.data?.round_id;
      mult = msg.round?.multiplier || msg.multiplier || msg.data?.multiplier;
    }
    // Formato data direto
    else if (msg.data?.round_id && msg.data?.multiplier !== undefined) {
      rid = msg.data.round_id;
      mult = msg.data.multiplier;
    }
    // Formato aninhado (Proteus/Spribe)
    else if (msg.message?.round?.id && msg.message?.round?.multiplier !== undefined) {
      rid = msg.message.round.id;
      mult = msg.message.round.multiplier;
    }
    // Formato "result" array
    else if (msg.result?.round_id && msg.result?.multiplier !== undefined) {
      rid = msg.result.round_id;
      mult = msg.result.multiplier;
    }
    // Formato "payload"
    else if (msg.payload?.round_id && msg.payload?.multiplier !== undefined) {
      rid = msg.payload.round_id;
      mult = msg.payload.multiplier;
    }

    if (rid && mult !== null) {
      const val = parseFloat(mult);
      if (!isNaN(val) && val >= 1.0) {
        processarRodada(String(rid), val);
      }
    }
  } catch(e) {}
}

// ===== 2. MONITORAMENTO DE DOM (FALLBACK) =====
// Para quando o WS não é capturado, lê o DOM
let textosVistos = new Set();

function escanearDOM() {
  const sel = [
    '[class*="multiplier"],[class*="Multiplier"]',
    '[class*="bubble"],[class*="Bubble"]',
    '.bubble-multiplier',
    '[class*="game-end"],[class*="game_end"]',
    '[class*="round"],[class*="Round"]',
    '[data-testid*="multiplier"]',
    '[class*="value"],[class*="Value"]'
  ].join(',');

  const els = document.querySelectorAll(sel);
  for (const el of els) {
    const txt = el.textContent.trim();
    if (!txt || textosVistos.has(txt)) continue;

    // "5.65x", "5,65x" ou "105.785,14x" (formato brasileiro)
    let m = txt.match(/(\d+(?:[.,]\d{3})*(?:,\d+)?)\s*x/i);
    if (m) {
      // Formato brasileiro: "105.785,14" -> remove pontos, troca vírgula por ponto
      let numStr = m[1];
      if (numStr.includes(',') && numStr.includes('.')) {
        // Brasileiro: 1.234,56 -> remove pontos, troca , por .
        numStr = numStr.replace(/\./g, '').replace(',', '.');
      } else if (numStr.includes(',')) {
        // Pode ser "5,65" (virgula decimal) ou "1,234" (milhar)
        // Se tiver 3+ dígitos após a vírgula, é milhar
        const afterComma = numStr.split(',')[1];
        if (afterComma && afterComma.length >= 3) {
          numStr = numStr.replace(',', ''); // milhar
        } else {
          numStr = numStr.replace(',', '.'); // decimal
        }
      }
      const val = parseFloat(numStr);
      if (val >= 1.0 && val < 10000) {
        const key = `dom_${val.toFixed(2)}_${Math.floor(Date.now()/5000)}`;
        if (!ENV.rodadasVistas.has(key)) {
          ENV.rodadasVistas.add(key);
          // Tentar encontrar round ID
          let roundEl = el.closest('[class*="round"]') || el.closest('[class*="Round"]') || el.parentElement;
          let roundTxt = roundEl?.textContent || '';
          let rm = roundTxt.match(/(?:rodada|round)\s*[#:]?\s*(\d+)/i);
          let rid = rm ? rm[1] : `dom_${Date.now()}`;
          processarRodada(String(rid), val);
        }
        textosVistos.add(txt);
      }
    }
  }

  if (textosVistos.size > 500) {
    textosVistos = new Set([...textosVistos].slice(-250));
  }
}

// MutationObserver para DOM
let domTimer = null;
try {
  const obs = new MutationObserver(() => {
    if (domTimer) return;
    domTimer = setTimeout(() => { domTimer = null; escanearDOM(); }, 800);
  });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  else {
    const mo = new MutationObserver(() => {
      if (document.body) {
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        mo.disconnect();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
} catch(e) {
  console.warn('[Aviator] MutationObserver não disponível');
}

// Polling periódico DOM
setInterval(escanearDOM, DOM_SCAN_INTERVAL);

// ===== 3. FLUSH PERIÓDICO =====
setInterval(() => {
  flushBatch();
  // Health check
  fetch(`${SERVER_BASE}/api/ping`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({})
  }).catch(() => {});
}, FLUSH_INTERVAL);

// ===== 4. HEARTBEAT LONGO =====
setInterval(notificarPopup, 30000);

// ===== 5. INICIALIZAÇÃO =====
setTimeout(() => {
  escanearDOM();
  console.log('[Aviator] Content script v4.0 ativo');
}, 2000);

// No Kiwi/Android: reiniciar se ficou muito tempo sem atividade
setInterval(() => {
  if (ENV.lote.length > 0) flushBatch();
}, 10000);

console.log('[Aviator] Content script v4.0 carregado');
