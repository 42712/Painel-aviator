// ===== Content Script - Betou Coletor v6.1 =====
const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_ENVIO = 3;

const isSpribe = location.hostname.includes('spribegaming');
const isBetou = location.hostname.includes('betou');

let ultimasVelas = [];
let ultimoEnvio = Date.now();
let rodadasVistas = new Set();
let config = { token: 'default', aviator: 1 };
let ultimoMult = null;
let ultimaRodadaLida = null;

chrome.storage.sync.get(['token', 'aviator'], function(cfg) {
  if (cfg.token) config.token = cfg.token;
  if (cfg.aviator) config.aviator = parseInt(cfg.aviator);
});

function getPainel() {
  try {
    if (isBetou && location.href.includes('/aviator2')) return 1;
    return config.aviator || 1;
  } catch(e) { return config.aviator || 1; }
}

function getTimeNow() {
  return new Date().toLocaleTimeString('pt-BR');
}

// ===================================================================
// INJETA SCRIPT NO MAIN WORLD (WebSocket REAL do jogo)
// ===================================================================
var injectScript = document.createElement('script');
injectScript.textContent = '(function(){if(window.__BETOU_WS)return;window.__BETOU_WS=true;var W=window.WebSocket;window.WebSocket=new Proxy(W,{construct:function(t,a){var w=new t(...a);w.addEventListener("message",async function(e){try{var d=e.data;if(d instanceof Blob)d=await d.text();if(typeof d==="string"&&d.length>0){window.postMessage({type:"__BETOU_WS",data:d},"*")}}catch(e){}});return w}});console.log("[Betou] injetado")})();';
document.documentElement.appendChild(injectScript);
injectScript.remove();

// ===== RECEBE DADOS DO MAIN WORLD =====
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (event.data.type !== '__BETOU_WS') return;
  processarRaw(event.data.data);
});

function processarRaw(raw) {
  try {
    if (raw.startsWith('a[')) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          if (typeof arr[i] === 'string') processarMsg(arr[i]);
        }
      }
      return;
    }
    processarMsg(raw);
  } catch(e) {}
}

function processarMsg(msg) {
  try {
    var clean = msg.replace(/\x00/g, '').trim();
    if (clean.startsWith('{')) {
      var json = JSON.parse(clean);
      var r = extrair(json);
      if (r) { console.log('[Betou] WS:', r.r, r.m.toFixed(2)+'x'); addVela(r); }
      return;
    }
    var idx = clean.indexOf('\n\n');
    if (idx > 0) {
      var body = clean.substring(idx + 2).replace(/\x00/g, '').trim();
      if (body.startsWith('{')) {
        var json = JSON.parse(body);
        var r = extrair(json);
        if (r) { console.log('[Betou] STOMP:', r.r, r.m.toFixed(2)+'x'); addVela(r); }
      }
    }
  } catch(e) {}
}

// ===================================================================
// DOM CAPTURE (seletores exatos que funcionam no Betou)
// ===================================================================
function capturarDOM() {
  try {
    // Multiplicador
    var elMult = document.querySelector('.bubble-multiplier');
    if (!elMult) return;
    var txt = elMult.innerText.trim();
    var mult = parseFloat(txt.replace('x', '').replace(',', '.'));
    if (isNaN(mult) || mult < 1 || mult > 100000) return;

    // Horario
    var elTime = document.querySelector('.header__info-time');
    var horario = elTime ? elTime.innerText.trim() : getTimeNow();

    // Rodada
    var elRodada = document.querySelector('span.text-uppercase');
    var rodadaNum = null;
    if (elRodada) {
      var m = elRodada.innerText.trim().match(/\d{4,}/);
      if (m) rodadaNum = m[0];
    }

    if (mult !== ultimoMult) {
      ultimoMult = mult;
      if (rodadaNum) ultimaRodadaLida = rodadaNum;
      var key = 'dom_' + mult.toFixed(2) + '_' + (rodadaNum || Date.now());
      if (rodadasVistas.has(key)) return;
      rodadasVistas.add(key);
      console.log('[Betou] DOM:', mult.toFixed(2)+'x', horario, rodadaNum ? '#'+rodadaNum : '');
      addVela({
        rodada: rodadaNum ? parseInt(rodadaNum) : undefined,
        multiplicador: mult,
        timestamp: horario,
        origem: 'dom'
      });
    }
  } catch(e) {}
}

// ===== .payout fallback =====
function capturarPayout() {
  try {
    var els = document.querySelectorAll('.payout');
    if (!els.length) return;
    var txt = els[0].innerText.trim();
    var mult = parseFloat(txt.replace('x', '').replace(',', '.'));
    if (isNaN(mult) || mult < 1 || mult > 100000 || mult === ultimoMult) return;
    ultimoMult = mult;
    var key = 'payout_' + mult.toFixed(2) + '_' + Date.now();
    if (rodadasVistas.has(key)) return;
    rodadasVistas.add(key);
    console.log('[Betou] payout:', mult.toFixed(2)+'x');
    addVela({ multiplicador: mult, timestamp: getTimeNow(), origem: 'payout' });
  } catch(e) {}
}

// ===== MutationObserver (leve, so nos seletores certos) =====
var obsTimeout = null;
var observer = new MutationObserver(function() {
  if (obsTimeout) return;
  obsTimeout = setTimeout(function() {
    obsTimeout = null;
    capturarDOM();
  }, 500);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true, attributes: false });
} else {
  document.addEventListener('DOMContentLoaded', function() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
  });
}

// Timers
setInterval(capturarDOM, 800);
setInterval(capturarPayout, 500);

// ===================================================================
// EXTRAIR RODADA DE JSON
// ===================================================================
function extrair(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.round && data.multiplier !== undefined) return { r: data.round, m: parseFloat(data.multiplier) };
  if (data.rodada && data.mult !== undefined) return { r: data.rodada, m: parseFloat(data.mult) };
  if (data.roundId && data.multiplier !== undefined) return { r: data.roundId, m: parseFloat(data.multiplier) };
  if (data.id && data.value !== undefined) return { r: data.id, m: parseFloat(data.value) };
  if (data.r && data.m !== undefined) return { r: data.r, m: parseFloat(data.m) };
  if (data.rodada && data.multiplicador !== undefined) return { r: data.rodada, m: parseFloat(data.multiplicador) };
  if (data.vela && !isNaN(parseFloat(data.vela))) return { r: data.rodada || 0, m: parseFloat(data.vela) };
  if (Array.isArray(data)) return extrair(data[0]);
  if (data.data && typeof data.data === 'object') return extrair(data.data);
  if (data.payload) return extrair(data.payload);
  if (data.result) return extrair(data.result);
  if (data.args) return extrair(data.args);
  if (data.body) return extrair(data.body);
  return null;
}

// ===================================================================
// ENVIO
// ===================================================================
function addVela(rodada) {
  var id = rodada.rodada || rodada.r || rodada.capturado_em || Date.now();
  if (rodadasVistas.has(id)) return;
  rodadasVistas.add(id);
  if (rodadasVistas.size > 2000) rodadasVistas = new Set([...rodadasVistas].slice(-1000));

  ultimasVelas.push({
    rodada: rodada.rodada || rodada.r || 0,
    multiplicador: rodada.multiplicador || rodada.m || rodada.mult || 0,
    timestamp: rodada.timestamp || getTimeNow(),
    origem: rodada.origem || 'extensao'
  });
  if (ultimasVelas.length > 30) ultimasVelas = ultimasVelas.slice(-30);
  enviar();
}

function enviar() {
  var agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_ENVIO * 1000) return;
  if (ultimasVelas.length === 0) return;
  ultimoEnvio = agora;
  var lote = ultimasVelas.slice();
  ultimasVelas = [];

  var rodadas = lote.map(function(v) {
    return {
      rodada: v.rodada || 0,
      multiplicador: v.multiplicador || 0,
      timestamp: v.timestamp || getTimeNow(),
      origem: v.origem || 'extensao'
    };
  });

  fetch(SERVER_URL + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou',
      token: config.token,
      aviator: getPainel(),
      rodadas: rodadas,
      timestamp: new Date().toISOString()
    })
  }).then(function() {
    chrome.runtime.sendMessage({ tipo: 'status', conectada: true, ultimaVela: lote[lote.length-1].multiplicador.toFixed(2) + 'x', totalEnviadas: lote.length }).catch(function(){});
  }).catch(function() {
    ultimasVelas = lote.concat(ultimasVelas);
    if (ultimasVelas.length > 50) ultimasVelas = ultimasVelas.slice(-50);
  });
}

// Heartbeat
setInterval(function() {
  fetch(SERVER_URL + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fonte: 'extensao_betou', token: config.token, aviator: getPainel(), heartbeat: true, timestamp: new Date().toISOString() })
  }).then(function() {
    chrome.runtime.sendMessage({ tipo: 'status', conectada: true }).catch(function(){});
  }).catch(function(){});
}, 30000);

// Envio forcado
setInterval(function() {
  if (ultimasVelas.length > 0) { ultimoEnvio = 0; enviar(); }
}, 5000);

// Anti-throttle
try {
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  setInterval(function() { if (audioCtx.state === 'suspended') audioCtx.resume(); }, 10000);
} catch(e) {}

console.log('[Betou v6.1] Ativo |', location.hostname, '| Painel', getPainel());
