// ===== Content Script - Betou Coletor v3.2 =====
// Seletores confirmados pelo HTML real da Betou/Spribe

const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_MIN_ENVIO_MS = 2000;
const MAX_LOTE = 50;
const LOG = true;

function log(...args) {
  if (LOG) console.log('[BetouColetor v3.2]', ...args);
}

let lote = [];
let ultimoEnvioMs = 0;
let rodadasVistas = new Set();
let token = 'default';
let enviosOk = 0;
let enviando = false;

const isIframe = window.self !== window.top;

log(`iframe=${isIframe} | url=${window.location.href.substring(0,80)}`);

function getPainel() {
  try {
    const topUrl = window.top.location.href;
    return topUrl.includes('/aviator2') ? 1 : 2;
  } catch(_) {
    return document.referrer.includes('/aviator2') ? 1 : 2;
  }
}

chrome.storage.sync.get(['token'], (cfg) => {
  if (cfg.token) token = cfg.token;
  log('Token:', token);
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.token) token = changes.token.newValue || 'default';
});

async function blobParaTexto(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve('');
    r.readAsText(blob);
  });
}

// ===== INTERCEPTA WEBSOCKET =====
(function() {
  const NativeWS = window.WebSocket;
  if (!NativeWS) return;

  window.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) {
      const ws = new Target(...args);
      const url = (args[0] || '').toString();
      log('WS aberto:', url.substring(0, 100));

      ws.addEventListener('message', async (ev) => {
        try {
          let raw = ev.data;
          if (raw instanceof Blob)             raw = await blobParaTexto(raw);
          else if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
          if (typeof raw !== 'string' || !raw) return;
          processarMensagem(raw);
        } catch(e) { log('Erro msg:', e.message); }
      });

      ws.addEventListener('open',  () => log('WS conectado ✓'));
      ws.addEventListener('close', () => log('WS fechado'));
      return ws;
    }
  });
  log('WebSocket interceptado ✓');
})();

// ===== PROCESSAR MENSAGENS WS =====
function processarMensagem(raw) {
  if (raw.includes('MESSAGE\n') || raw.includes('MESSAGE\r\n')) {
    for (const frame of raw.split(/MESSAGE\r?\n/)) {
      const sep = frame.indexOf('\n\n');
      if (sep === -1) continue;
      const body = frame.substring(sep + 2).replace(/\0+$/, '').trim();
      if (body) tentarJSON(body);
    }
    return;
  }
  tentarJSON(raw);
}

function tentarJSON(texto) {
  try { processarObj(JSON.parse(texto)); return; } catch(_) {}
  const matches = texto.match(/\{[^{}]{5,}\}/g);
  if (matches) for (const m of matches) { try { processarObj(JSON.parse(m)); } catch(_) {} }
}

function processarObj(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(processarObj); return; }

  const mult = parseFloat(
    obj.multiplayer ?? obj.multiplier ?? obj.multiplicador ??
    obj.crashMultiplier ?? obj.value ?? obj.payout ??
    obj.coefficient ?? obj.coef ?? NaN
  );
  const rid = parseInt(
    obj.gameRoundId ?? obj.roundId ?? obj.round_id ?? obj.id ?? 0
  ) || Math.floor(Date.now() / 1000);
  const estado = (obj.state ?? obj.status ?? obj.event ?? obj.type ?? '').toString().toLowerCase();

  if (!isNaN(mult) && mult >= 1.0 && mult < 10000) {
    if (mult === 1.0 && !['ended','end','complete','finished','crash','busted','cashout'].includes(estado)) return;
    adicionarRodada(mult, rid, 'ws');
  }

  for (const c of ['data','result','payload','body','game','round','response','info']) {
    if (obj[c] && typeof obj[c] === 'object') processarObj(obj[c]);
  }
}

// ===== DOM - SELETORES CONFIRMADOS DO HTML REAL =====
// <span class="text-uppercase ng-tns-c45-3"> Rodada 3709961 </span>
// <div class="bubble-multiplier font-weight-bold"> 4.95x </div>
// <div class="header__info-time ng-tns-c45-3"> 17:42:46 </div>

let domCache = new Set();
let domDebounce = null;
let ultimaRodadaDOM = null; // guarda o último ID visto no span

function lerEstadoDOM() {
  // 1. Pega o ID da rodada atual
  const spanRodada = document.querySelector('.text-uppercase');
  let rodadaId = null;
  if (spanRodada) {
    const m = spanRodada.textContent.match(/(\d{5,})/);
    if (m) rodadaId = parseInt(m[1]);
  }

  // 2. Pega o horário
  let horario = '';
  const elHora = document.querySelector('.header__info-time');
  if (elHora) horario = elHora.textContent.trim();

  // 3. Pega o multiplicador
  const elMult = document.querySelector('.bubble-multiplier');
  if (!elMult) return;

  const txt = elMult.textContent.replace(/[x×]/gi, '').replace(',', '.').trim();
  const v = parseFloat(txt);
  if (!v || v < 1.0 || v >= 10000) return;

  // Usa rodadaId se disponível, senão usa fallback por tempo
  const rid = rodadaId || Math.floor(Date.now() / 1000);

  const chave = `${rid}_${v.toFixed(2)}`;
  if (domCache.has(chave)) return;
  domCache.add(chave);
  if (domCache.size > 500) domCache = new Set([...domCache].slice(-250));

  log(`[DOM] ✈ ${v.toFixed(2)}x #${rid} ${horario}`);
  adicionarRodada(v, rid, 'dom', horario);
}

// Observa mudanças especificamente no .bubble-multiplier
function observarDOM() {
  const alvo = document.documentElement;

  new MutationObserver((mutations) => {
    if (domDebounce) return;

    // Verifica se alguma mutação envolve o bubble-multiplier
    let relevante = false;
    for (const mut of mutations) {
      const node = mut.target;
      if (
        (node.classList && (node.classList.contains('bubble-multiplier') || node.classList.contains('text-uppercase'))) ||
        mut.addedNodes.length > 0
      ) {
        relevante = true;
        break;
      }
    }
    if (!relevante && mutations.length < 5) return;

    domDebounce = setTimeout(() => {
      domDebounce = null;
      lerEstadoDOM();
    }, 200);

  }).observe(alvo, { childList: true, subtree: true, characterData: true, attributes: true });

  log('MutationObserver DOM iniciado ✓');
}

// Polling de segurança a cada 3s — garante que nada passe batido
let ultimoMultDOM = null;
setInterval(() => {
  const el = document.querySelector('.bubble-multiplier');
  if (!el) return;
  const v = parseFloat(el.textContent.replace(/[x×]/gi,'').replace(',','.').trim());
  if (!v || v === ultimoMultDOM) return;
  ultimoMultDOM = v;
  lerEstadoDOM();
}, 3000);

observarDOM();
[1000, 2000, 4000, 7000, 10000].forEach(ms => setTimeout(lerEstadoDOM, ms));

// ===== ENVIO =====
function adicionarRodada(mult, rid, origem, horario = '') {
  const key = `${rid}_${mult.toFixed(2)}`;
  if (rodadasVistas.has(key)) return;
  rodadasVistas.add(key);
  if (rodadasVistas.size > 2000) rodadasVistas = new Set([...rodadasVistas].slice(-1000));

  log(`✈ ${mult.toFixed(2)}x #${rid} [${origem}]`);

  lote.push({
    rodada: rid,
    multiplicador: parseFloat(mult.toFixed(2)),
    timestamp: horario || new Date().toLocaleTimeString('pt-BR'),
    origem
  });

  if (lote.length > MAX_LOTE) lote = lote.slice(-MAX_LOTE);
  enviarLote();
}

async function enviarLote() {
  if (enviando || Date.now() - ultimoEnvioMs < INTERVALO_MIN_ENVIO_MS || !lote.length) return;
  enviando = true;
  ultimoEnvioMs = Date.now();
  const payload = { token, aviator: getPainel(), rodadas: lote.splice(0) };

  try {
    const r = await fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.json();
    enviosOk += payload.rodadas.length;
    const ult = payload.rodadas[payload.rodadas.length - 1];
    log(`✅ ${payload.rodadas.length} enviadas | total: ${enviosOk}`);
    notificar(true, `${ult.multiplicador.toFixed(2)}x (#${ult.rodada})`, enviosOk);
  } catch(e) {
    log('❌ Falha:', e.message);
    lote.unshift(...payload.rodadas);
    if (lote.length > MAX_LOTE) lote = lote.slice(-MAX_LOTE);
    notificar(false, null, enviosOk);
  } finally { enviando = false; }
}

function notificar(conectada, ultimaVela, totalEnviadas) {
  try {
    chrome.runtime.sendMessage({
      tipo: 'status', conectada, totalEnviadas,
      ...(ultimaVela ? { ultimaVela } : {})
    }).catch(()=>{});
  } catch(_) {}
}

setInterval(() => { if (lote.length) { ultimoEnvioMs = 0; enviarLote(); } }, 5000);

// Heartbeat
setInterval(() => {
  fetch(`${SERVER_URL}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, aviator: getPainel(), heartbeat: true, timestamp: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000)
  }).then(r => r.json()).then(() => notificar(true, null, enviosOk)).catch(() => notificar(false, null, enviosOk));
}, 30000);

// Status inicial
fetch(`${SERVER_URL}/api/webhook/status`, { signal: AbortSignal.timeout(5000) })
  .then(r => r.json())
  .then(s => log('Servidor:', JSON.stringify(s)))
  .catch(e => log('Servidor off:', e.message));

log(`=== BETOU COLETOR v3.2 | iframe=${isIframe} ===`);
