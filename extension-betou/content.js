// ===== Content Script - Betou Coletor v6.3 =====
const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_ENVIO = 3;

const isBetou = location.hostname.includes('betou');
const isSpribe = location.hostname.includes('spribegaming');

var ultimasVelas = [];
var ultimoEnvio = Date.now();
var dedupSet = new Set();
var config = { token: 'default', aviator: 1 };
var ultimoMult = null;
var rodadaAtual = null;
var rodadaUltimaCaptura = null;
var totalEnviadas = 0;

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

// ===== INJETA main.js NO MAIN WORLD =====
try {
  var s = document.createElement('script');
  s.src = chrome.runtime.getURL('main.js');
  s.onload = function() { s.remove(); };
  document.documentElement.appendChild(s);
} catch(e) {}

// ===== RECEBE DADOS DO MAIN WORLD =====
window.addEventListener('message', function(event) {
  if (event.source !== window || event.data.type !== '__BETOU_WS') return;
  try {
    var raw = event.data.data;
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
});

function processarMsg(msg) {
  try {
    var clean = msg.replace(/\x00/g, '').trim();
    if (clean.startsWith('{')) {
      var json = JSON.parse(clean);
      var r = extrair(json);
      if (r) { addVela({ rodada: r.r, multiplicador: r.m, timestamp: getTimeNow(), origem: 'ws' }); }
      return;
    }
    var idx = clean.indexOf('\n\n');
    if (idx > 0) {
      var body = clean.substring(idx + 2).replace(/\x00/g, '').trim();
      if (body.startsWith('{')) {
        var json = JSON.parse(body);
        var r = extrair(json);
        if (r) { addVela({ rodada: r.r, multiplicador: r.m, timestamp: getTimeNow(), origem: 'stomp' }); }
      }
    }
  } catch(e) {}
}

// ===== CAPTURA RODADA ATUAL =====
function capturarRodada() {
  try {
    var spans = document.querySelectorAll('span.text-uppercase');
    for (var i = 0; i < spans.length; i++) {
      var txt = spans[i].innerText.trim();
      var m = txt.match(/(\d{6,})/);
      if (m) {
        var num = parseInt(m[1]);
        if (num > 100000) {
          rodadaAtual = num;
          return num;
        }
      }
    }
    // Fallback: qualquer texto com numero grande
    var todos = document.querySelectorAll('span, div');
    for (var i = 0; i < todos.length; i++) {
      if (todos[i].children.length) continue;
      var txt = (todos[i].innerText || todos[i].textContent || '').trim();
      var m = txt.match(/[Rr]odada\s+(\d{6,})/);
      if (m) {
        var num = parseInt(m[1]);
        if (num > 100000) { rodadaAtual = num; return num; }
      }
    }
  } catch(e) {}
  return rodadaAtual;
}

// ===== CAPTURA MULTIPLICADOR DO JOGO =====
function capturarDOM() {
  try {
    var elMult = document.querySelector('.bubble-multiplier');
    if (!elMult) return;
    var txt = elMult.innerText.trim();
    var mult = parseFloat(txt.replace('x', '').replace(',', '.'));
    if (isNaN(mult) || mult < 1 || mult > 100000) return;

    var elTime = document.querySelector('.header__info-time');
    var horario = elTime ? elTime.innerText.trim() : getTimeNow();

    var rodada = capturarRodada();

    if (mult !== ultimoMult) {
      ultimoMult = mult;
      var key = (rodada || '') + '_' + mult.toFixed(2);
      if (dedupSet.has(key)) return;
      dedupSet.add(key);
      console.log('[Betou] DOM:', mult.toFixed(2)+'x', horario, rodada ? '#'+rodada : '');
      addVela({ rodada: rodada, multiplicador: mult, timestamp: horario, origem: 'dom' });
    }
  } catch(e) {}
}

// ===== CAPTURA HISTORICO (payouts) =====
function capturarPayout() {
  try {
    var payouts = document.querySelectorAll('.payout');
    if (!payouts.length) return;

    // Atualiza rodada atual
    capturarRodada();

    payouts.forEach(function(el, idx) {
      var txt = el.innerText.trim();
      var mult = parseFloat(txt.replace('x', '').replace(',', '.'));
      if (isNaN(mult) || mult < 1 || mult > 100000) return;

      // Estima a rodada pelo indice no historico
      var rodadaEstimada = rodadaAtual ? (rodadaAtual - (payouts.length - 1 - idx)) : null;

      var key = (rodadaEstimada || 'hist_') + '_' + mult.toFixed(2) + '_' + idx;
      if (dedupSet.has(key)) return;
      dedupSet.add(key);

      var horario = getTimeNow();
      console.log('[Betou] 📜 #' + (rodadaEstimada || '?') + ' ' + mult.toFixed(2) + 'x');
      addVela({ rodada: rodadaEstimada, multiplicador: mult, timestamp: horario, origem: 'historico' });
    });
  } catch(e) {}
}

// MutationObserver
var obsTimeout = null;
var observer = new MutationObserver(function() {
  if (obsTimeout) return;
  obsTimeout = setTimeout(function() { obsTimeout = null; capturarRodada(); capturarDOM(); }, 500);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true, attributes: false });
} else {
  document.addEventListener('DOMContentLoaded', function() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
  });
}

setInterval(capturarRodada, 2000);
setInterval(capturarDOM, 800);
setInterval(capturarPayout, 5000);

// ===== EXTRAIR =====
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

// ===== ENVIO =====
function addVela(rodada) {
  var rodId = rodada.rodada || rodada.r || 0;
  if (rodId && dedupSet.has('r_' + rodId)) return;
  if (rodId) dedupSet.add('r_' + rodId);

  if (dedupSet.size > 5000) dedupSet = new Set([...dedupSet].slice(-2500));

  ultimasVelas.push({
    rodada: rodId,
    multiplicador: rodada.multiplicador || rodada.m || rodada.mult || 0,
    timestamp: rodada.timestamp || getTimeNow(),
    origem: rodada.origem || 'extensao'
  });
  if (ultimasVelas.length > 50) ultimasVelas = ultimasVelas.slice(-50);
  enviar();
}

function enviar() {
  var agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_ENVIO * 1000) return;
  if (ultimasVelas.length === 0) return;
  ultimoEnvio = agora;
  var lote = ultimasVelas.slice();
  ultimasVelas = [];

  totalEnviadas += lote.length;
  var ultima = lote[lote.length - 1];

  fetch(SERVER_URL + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou',
      token: config.token,
      aviator: getPainel(),
      rodadas: lote,
      timestamp: new Date().toISOString()
    })
  }).then(function() {
    chrome.runtime.sendMessage({
      tipo: 'status', conectada: true,
      ultimaVela: (ultima.multiplicador || 0).toFixed(2) + 'x',
      totalEnviadas: totalEnviadas
    }).catch(function(){});
  }).catch(function() {
    ultimasVelas = lote.concat(ultimasVelas);
    if (ultimasVelas.length > 100) ultimasVelas = ultimasVelas.slice(-100);
  });
}

// Heartbeat
setInterval(function() {
  fetch(SERVER_URL + '/api/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou', token: config.token,
      aviator: getPainel(), heartbeat: true, timestamp: new Date().toISOString()
    })
  }).then(function() {
    chrome.runtime.sendMessage({ tipo: 'status', conectada: true }).catch(function(){});
  }).catch(function(){});
}, 30000);

setInterval(function() {
  if (ultimasVelas.length > 0) { ultimoEnvio = 0; enviar(); }
}, 5000);

try {
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  setInterval(function() { if (audioCtx.state === 'suspended') audioCtx.resume(); }, 10000);
} catch(e) {}

console.log('[Betou v6.3] Ativo |', location.hostname, '| Painel', getPainel());
