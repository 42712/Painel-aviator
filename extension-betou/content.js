// ===== Content Script - Coletor Betou Aviator v2.1 =====
// Mapeamento: Betou /aviator → Painel 2 | Betou /aviator2 → Painel 1

const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_ENVIO = 2;
const LOG = true;

function log(...args) { if (LOG) console.log('[BetouColetor]', ...args); }

let lote = [];
let ultimoEnvio = 0;
let rodadasVistas = new Set();
let config = { token: 'default' };
let enviosComSucesso = 0;
let enviosComFalha = 0;

function getAviatorPainel() {
  return window.location.pathname.includes('/aviator2') ? 1 : 2;
}

chrome.storage.sync.get(['token'], (cfg) => {
  if (cfg.token) config.token = cfg.token;
  log('Token:', config.token);
});

// ===== UTIL =====
async function blobToText(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });
}

// ===== 1. WEBSOCKET - STOMP / Spribe =====
const NativeWS = window.WebSocket;
window.WebSocket = new Proxy(NativeWS, {
  construct(target, args) {
    const ws = new target(...args);
    const url = args[0] || '';
    log('WebSocket:', url.substring(0, 80) + '...');

    ws.addEventListener('message', async (event) => {
      try {
        let raw = event.data;
        if (raw instanceof Blob) raw = await blobToText(raw);
        else if (raw instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(raw);
        }
        if (typeof raw !== 'string') return;
        if (raw.length > 5000) {
          // Tenta processar só o final (onde vem o resultado)
          processarSTOMP(raw);
        } else {
          processarSTOMP(raw);
        }
      } catch (e) {
        log('Erro WS:', e.message.substring(0, 80));
      }
    });

    ws.addEventListener('open', () => log('WS conectado'));
    ws.addEventListener('close', () => log('WS fechado'));

    return ws;
  }
});

function processarSTOMP(raw) {
  // STOMP frame: headers\n\nbody\0
  // Vários frames podem vir concatenados
  if (raw.includes('MESSAGE\n')) {
    const frames = raw.split('MESSAGE\n');
    for (const frame of frames) {
      if (!frame.trim()) continue;
      const bodyStart = frame.indexOf('\n\n');
      if (bodyStart === -1) continue;
      let body = frame.substring(bodyStart + 2).replace(/\0$/, '').trim();
      if (!body) continue;
      try {
        const obj = JSON.parse(body);
        processarMsgSpribe(obj);
      } catch (_) {
        // Tenta extrair JSON do corpo
        const m = body.match(/\{.*\}/);
        if (m) try {
          processarMsgSpribe(JSON.parse(m[0]));
        } catch(_2) {}
      }
    }
    return;
  }

  // Mensagens curtas: tenta JSON direto
  if (raw.length < 2000) {
    try {
      const obj = JSON.parse(raw);
      processarMsgSpribe(obj);
      return;
    } catch (_) {}
  }

  // Fallback: procura JSON no corpo
  const jsonMatch = raw.match(/\n\n(\{.*?\})(?:\0|$)/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[1]);
      processarMsgSpribe(obj);
    } catch (_) {}
  }
}

function processarMsgSpribe(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach(o => processarMsgSpribe(o));
    return;
  }

  // Spribe Aviator envia mensagens como:
  // {"multiplayer":1.24,"gameRoundId":3709833,...}
  let mult = obj.multiplayer ?? obj.multiplier ?? obj.multiplicador ?? obj.crashMultiplier ?? obj.value ?? null;
  let rid = obj.gameRoundId ?? obj.roundId ?? obj.round ?? obj.id ?? null;
  let estado = obj.state ?? obj.status ?? obj.event ?? null;

  // Só processa se tiver multiplicador > 1 (ou se for o estado final "ended")
  if (mult !== null) {
    mult = parseFloat(mult);
    if (mult > 0 && mult < 1000) {
      if (!rid) rid = Math.floor(Math.random() * 9000000) + 1000000;
      // Ignora multiplicadores 1.00 que ainda estão rodando
      if (mult === 1.00 && estado !== 'ended' && estado !== 'complete') return;
      adicionarRodada(mult, parseInt(rid), 'ws');
      return;
    }
  }

  // Aninhado
  if (obj.data) processarMsgSpribe(obj.data);
}

// ===== 2. DOM - Fallback baseado no HTML real da Betou =====
// HTML: <span class="text-uppercase"> Rodada 3709833 </span>
//        <div class="bubble-multiplier font-weight-bold"> 1.24x</div>
//        <div class="header__info-time"> 16:55:35 </div>

let domTimeout = null;
let domCache = new Set();

function capturarDOM() {
  const bolhas = document.querySelectorAll('.bubble-multiplier');
  if (!bolhas.length) {
    // Tenta seletores alternativos se não achar
    const alt = document.querySelectorAll('[class*="multiplier"],[class*="bubble"],[class*="payout"]');
    for (const el of alt) {
      const txt = el.textContent.replace('x', '').replace(',', '.').trim();
      const v = parseFloat(txt);
      if (v && v > 0 && v < 1000) {
        const ts = Math.floor(Date.now() / 3000);
        const key = `alt_${ts}_${v.toFixed(2)}`;
        if (domCache.has(key)) continue;
        domCache.add(key);
        // Tenta achar rodada ID
        let rid = Math.floor(Date.now() / 1000);
        const span = document.querySelector('.text-uppercase');
        if (span) {
          const m = span.textContent.match(/(\d+)/);
          if (m) rid = parseInt(m[1]);
        }
        adicionarRodada(v, rid, 'dom');
      }
    }
    return;
  }

  for (const el of bolhas) {
    const txt = el.textContent.replace('x', '').replace(',', '.').trim();
    const v = parseFloat(txt);
    if (!v || v <= 0 || v >= 1000) continue;

    // Extrai rodada ID do span .text-uppercase
    let rid = Math.floor(Date.now() / 1000);
    const spanRodada = document.querySelector('.text-uppercase');
    if (spanRodada) {
      const m = spanRodada.textContent.match(/(\d+)/);
      if (m) rid = parseInt(m[1]);
    }

    // Horário
    let horario = '';
    const elTime = document.querySelector('.header__info-time');
    if (elTime) horario = elTime.textContent.trim();

    const key = `${rid}_${v.toFixed(2)}`;
    if (domCache.has(key)) continue;
    domCache.add(key);
    if (domCache.size > 500) domCache = new Set([...domCache].slice(-250));

    adicionarRodada(v, rid, 'dom', horario);
  }
}

// MutationObserver p/ capturar novas bolhas
new MutationObserver(() => {
  if (domTimeout) return;
  domTimeout = setTimeout(() => {
    domTimeout = null;
    capturarDOM();
  }, 300);
}).observe(document.body || document.documentElement, {
  childList: true, subtree: true
});

// Captura inicial
setTimeout(capturarDOM, 2000);
setTimeout(capturarDOM, 4000);
setTimeout(capturarDOM, 6000);

// ===== 3. ENVIO AO SERVIDOR =====
function adicionarRodada(multiplicador, rodadaId, origem = 'ws', horario = '') {
  const key = `${rodadaId}_${multiplicador.toFixed(2)}`;
  if (rodadasVistas.has(key)) return;
  rodadasVistas.add(key);
  if (rodadasVistas.size > 1000) {
    rodadasVistas = new Set([...rodadasVistas].slice(-500));
  }

  log(`[${origem}] ${multiplicador.toFixed(2)}x #${rodadaId}`);

  lote.push({
    rodada: rodadaId,
    multiplicador: multiplicador,
    timestamp: horario || new Date().toLocaleTimeString('pt-BR'),
    origem
  });

  enviarLote();
}

async function enviarLote() {
  const agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_ENVIO * 1000) return;
  if (lote.length === 0) return;

  ultimoEnvio = agora;
  const payload = {
    token: config.token,
    aviator: getAviatorPainel(),
    rodadas: lote.splice(0)
  };

  try {
    const resp = await fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await resp.json();
    enviosComSucesso += payload.rodadas.length;
    log(`Enviado ${payload.rodadas.length} rodadas (total: ${enviosComSucesso})`);

    const ult = payload.rodadas[payload.rodadas.length - 1];
    chrome.runtime.sendMessage({
      tipo: 'status', conectada: true,
      ultimaVela: `${ult.multiplicador.toFixed(2)}x (#${ult.rodada})`,
      totalEnviadas: enviosComSucesso
    }).catch(() => {});
  } catch (err) {
    enviosComFalha++;
    log('Falha envio:', err.message);
    lote.push(...payload.rodadas);
    if (lote.length > 100) lote = lote.slice(-50);
  }
}

// Flush de segurança
setInterval(() => {
  if (lote.length > 0) {
    ultimoEnvio = 0;
    enviarLote();
  }
}, 5000);

// Heartbeat 30s
setInterval(() => {
  fetch(`${SERVER_URL}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.token, aviator: getAviatorPainel(),
      heartbeat: true, timestamp: new Date().toISOString()
    })
  }).then(r => r.json()).catch(() => {});
}, 30000);

// Status inicial
fetch(`${SERVER_URL}/api/webhook/status`)
  .then(r => r.json())
  .then(s => log('Servidor:', JSON.stringify(s)))
  .catch(e => log('Servidor off?', e.message));

log('=== BETOU COLETOR v2.1 ATIVO ===');
log('URL:', window.location.href);
