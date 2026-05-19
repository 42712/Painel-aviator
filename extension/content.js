// ===== Content Script v4.0 - Betou Aviator Collector =====
// Captura rodadas em tempo real via WebSocket + DOM fallback
// Envia vela (multiplicador), rodada, horário (HH:MM:SS) e soma para o painel

const SERVER_URL = "https://painel-aviator.onrender.com";
const POLL_INTERVAL_MS = 1000;
const DEBOUNCE_MS = 1200;
const MAX_LOTE = 100;

const LOG = true;
function log(...args) { if (LOG) console.log('[AviatorCollector v4.0]', ...args); }

// ---- Config do usuário ----
let config = {
  token: 'default',
  painel: 1  // 1 = aviator1, 2 = aviator2
};

chrome.storage.sync.get(['token', 'painel'], (cfg) => {
  if (cfg.token) config.token = cfg.token;
  if (cfg.painel) config.painel = parseInt(cfg.painel);
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.token) config.token = changes.token.newValue || 'default';
  if (changes.painel) config.painel = parseInt(changes.painel.newValue) || 1;
});

// ---- Estado interno ----
let rodadasVistas = new Set();
let lote = [];
let ultimoEnvioMs = 0;
let enviando = false;
let enviosOk = 0;
let enviosErro = 0;
let ultimaVela = '—';
let conectado = false;
let ultimaRodada = null;

// ---- Utilitários ----
function formatTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toTimeString().slice(0, 8); // HH:MM:SS
}

function calcularSoma(valor) {
  const str = valor.toFixed(2);
  let soma = 0;
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') soma += parseInt(ch);
  }
  return soma;
}

function obterPainel() {
  try {
    const topUrl = window.top.location.href;
    if (topUrl.includes('aviator2')) return 2;
    if (topUrl.includes('aviator1')) return 1;
    return config.painel;
  } catch (_) {
    return config.painel;
  }
}

// ---- Processar e enviar rodada ----
function processarRodada(rodadaId, multiplicador, timestamp) {
  if (!rodadaId || multiplicador < 0.01) return null;
  if (rodadasVistas.has(rodadaId)) return null;
  rodadasVistas.add(rodadaId);

  // Limitar set para evitar memory leak
  if (rodadasVistas.size > 5000) {
    rodadasVistas = new Set([...rodadasVistas].slice(-3000));
  }

  const ts = formatTime(timestamp);
  const soma = calcularSoma(multiplicador);

  ultimaVela = `${multiplicador.toFixed(2)}x`;
  conectado = true;
  ultimaRodada = { rodada: rodadaId, multiplicador, timestamp: ts, soma };

  // Adicionar ao lote para envio
  lote.push({
    rodada: rodadaId,
    multiplicador: parseFloat(multiplicador.toFixed(2)),
    timestamp: ts,
    soma,
    cor: multiplicador < 2 ? 'azul' : multiplicador < 10 ? 'roxa' : 'rosa',
    painel: obterPainel()
  });

  log(`🎯 Rodada #${rodadaId} | ${multiplicador.toFixed(2)}x | ${ts} | soma=${soma}`);

  // Enviar lote
  enviarLote();

  // Notificar popup
  chrome.runtime.sendMessage({
    tipo: 'status',
    conectada: true,
    ultimaVela: ultimaVela,
    totalEnviadas: enviosOk,
    ultimaRodada: ultimaRodada
  }).catch(() => {});

  return ultimaRodada;
}

async function enviarLote() {
  const agora = Date.now();
  if (lote.length === 0) return;
  if (lote.length < 5 && agora - ultimoEnvioMs < 3000) return;
  if (enviando) return;

  enviando = true;
  const batch = lote.splice(0, MAX_LOTE);
  ultimoEnvioMs = agora;

  try {
    const resp = await fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: config.token, rodadas: batch, painel: obterPainel() })
    });
    if (resp.ok) {
      enviosOk += batch.length;
      log(`📤 Enviadas ${batch.length} rodadas (total: ${enviosOk})`);
    } else {
      enviosErro++;
      log(`⚠️ Erro envio: ${resp.status}`);
      // Re-adicionar ao lote
      lote.unshift(...batch);
    }
  } catch (err) {
    enviosErro++;
    log(`🔴 Falha envio: ${err.message}`);
    lote.unshift(...batch);
  }

  enviando = false;
}

// ===== 1. INTERCEPTAÇÃO DE WEBSOCKET =====
(function interceptWebSocket() {
  const NativeWS = window.WebSocket;
  if (!NativeWS) return;

  window.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) {
      const ws = new Target(...args);
      const url = (args[0] || '').toString().toLowerCase();
      const isGameWS = url.includes('spribe') || url.includes('game') || url.includes('socket');

      ws.addEventListener('message', (ev) => {
        if (!isGameWS) return;
        try {
          let raw = ev.data;
          if (raw instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => processarMensagemWS(reader.result);
            reader.readAsText(raw);
            return;
          }
          if (raw instanceof ArrayBuffer) {
            raw = new TextDecoder().decode(raw);
          }
          if (typeof raw === 'string') {
            processarMensagemWS(raw);
          }
        } catch (_) {}
      });

      return ws;
    }
  });

  log('WebSocket interceptado');
})();

function processarMensagemWS(raw) {
  try {
    const msg = JSON.parse(raw);

    // Spribe envia diferentes tipos de mensagem
    // Formato 1: { "type": "game_end", "data": { "round_id": 123, "multiplier": 5.65 } }
    // Formato 2: { "type": "round_ended", "round_id": 123, "multiplier": 5.65 }
    // Formato 3: { "event": "complete", "round": { "id": 123, "multiplier": 5.65 } }

    let rodadaId = null;
    let multiplicador = null;

    // Tentar extrair de diferentes formatos Spribe
    if (msg.type === 'game_end' || msg.type === 'round_ended' || msg.type === 'end') {
      rodadaId = msg.data?.round_id || msg.round_id || msg.data?.id;
      multiplicador = msg.data?.multiplier || msg.multiplier || msg.data?.value;
    }
    else if (msg.event === 'complete' || msg.event === 'game_complete') {
      rodadaId = msg.round?.id || msg.round_id || msg.data?.round_id;
      multiplicador = msg.round?.multiplier || msg.multiplier || msg.data?.multiplier;
    }
    else if (msg.data?.round_id && msg.data?.multiplier !== undefined) {
      rodadaId = msg.data.round_id;
      multiplicador = msg.data.multiplier;
    }
    else if (msg.message?.round?.id && msg.message?.round?.multiplier !== undefined) {
      rodadaId = msg.message.round.id;
      multiplicador = msg.message.round.multiplier;
    }

    if (rodadaId && multiplicador !== null) {
      const mult = parseFloat(multiplicador);
      if (!isNaN(mult) && mult >= 1.0) {
        processarRodada(String(rodadaId), mult);
      }
    }

    // Também capturar o round_id das mensagens de inicio de rodada
    if (msg.type === 'game_start' || msg.type === 'start' || msg.event === 'start') {
      const rid = msg.data?.round_id || msg.round_id || msg.round?.id;
      if (rid) {
        log(`🚀 Rodada iniciada: #${rid}`);
      }
    }
  } catch (_) {}
}

// ===== 2. MONITORAMENTO DE DOM (FALLBACK + CAPTURA ADICIONAL) =====
// Monitora mudanças no DOM para capturar quando elementos aparecem
let domTimeout = null;
let ultimosTextos = new Set();

function escanearDOM() {
  // Seletores para encontrar dados da rodada no DOM da Betou/Spribe
  const elementos = document.querySelectorAll([
    '[class*="multiplier"]',
    '[class*="Multiplier"]',
    '[class*="round"]',
    '[class*="Round"]',
    '[class*="rodada"]',
    '[class*="bubble"]',
    '.bubble-multiplier',
    '.multiplier-value',
    '[class*="game-end"]',
    '[class*="game_end"]'
  ].join(','));

  elementos.forEach(el => {
    const texto = el.textContent.trim();
    if (!texto || ultimosTextos.has(texto)) return;

    // Tenta extrair multiplicador (ex: "5.65x" ou "5,65")
    const match = texto.match(/(\d+[.,]\d+)\s*x/i);
    if (match) {
      const valor = parseFloat(match[1].replace(',', '.'));
      if (valor >= 1.0 && valor < 10000) {
        // Gerar ID único baseado no valor + timestamp
        const key = `dom_${valor.toFixed(2)}_${Math.floor(Date.now() / 10000)}`;
        if (!rodadasVistas.has(key)) {
          rodadasVistas.add(key);
          // Tenta encontrar o round ID próximo
          const roundEl = el.closest('[class*="round"]') || el.parentElement;
          const roundText = roundEl?.textContent || '';
          const roundMatch = roundText.match(/rodada\s*[#:]?\s*(\d+)/i) || roundText.match(/round\s*[#:]?\s*(\d+)/i);
          const rid = roundMatch ? roundMatch[1] : `dom_${Date.now()}`;
          processarRodada(String(rid), valor);
        }
        ultimosTextos.add(texto);
      }
    } else if (texto.includes('Rodada') || texto.includes('rodada')) {
      // Capturar número da rodada
      const numMatch = texto.match(/(\d{5,})/);
      if (numMatch) {
        log(`📋 Rodada detectada no DOM: #${numMatch[1]}`);
        ultimosTextos.add(texto);
      }
    }
  });

  // Limpar cache de textos periodicamente
  if (ultimosTextos.size > 200) {
    ultimosTextos = new Set([...ultimosTextos].slice(-100));
  }
}

// MutationObserver para capturar mudanças no DOM
const observer = new MutationObserver(() => {
  if (domTimeout) return;
  domTimeout = setTimeout(() => {
    domTimeout = null;
    escanearDOM();
  }, DEBOUNCE_MS);
});

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: false
});

// Escaneamento periódico (fallback)
setInterval(escanearDOM, POLL_INTERVAL_MS);

// ---- Escaneamento inicial ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(escanearDOM, 2000);
  });
} else {
  setTimeout(escanearDOM, 2000);
}

// ===== 3. ENVIO PERIÓDICO DE HEALTH CHECK =====
setInterval(() => {
  if (lote.length > 0) enviarLote();

  // Health check a cada 30s
  fetch(`${SERVER_URL}/api/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.token, status: 'online' })
  }).catch(() => {});

  // Atualizar status periodicamente
  chrome.runtime.sendMessage({
    tipo: 'status',
    conectada: conectado,
    ultimaVela: ultimaVela,
    totalEnviadas: enviosOk,
    ultimaRodada: ultimaRodada
  }).catch(() => {});
}, 30000);

log('Content script v4.0 carregado');
