// ===== Content Script - Betou Coletor v6.0 (MAIN world injection + Canvas) =====
const SERVER_URL = "https://painel-aviator.onrender.com";
const INTERVALO_ENVIO = 3;

const isSpribe = location.hostname.includes('spribegaming');
const isBetou = location.hostname.includes('betou');

let ultimasVelas = [];
let ultimoEnvio = 0;
let rodadasVistas = new Set();
let config = { token: 'default', aviator: 1 };
let lastMultiplier = null;

chrome.storage.sync.get(['token', 'aviator'], (cfg) => {
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
const injectCode = `
(function() {
  if (window.__BETOU_INJECTED) return;
  window.__BETOU_INJECTED = true;

  const NativeWS = window.WebSocket;
  window.WebSocket = new Proxy(NativeWS, {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener('message', async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) data = await data.text();
          if (typeof data === 'string' && data.length > 0) {
            window.postMessage({ type: '__BETOU_WS', data: data }, '*');
          }
        } catch(e) {}
      });
      return ws;
    }
  });
  console.log('[Betou] ✅ inject MAIN world');
})();
`;

const injectScript = document.createElement('script');
injectScript.textContent = injectCode;
document.documentElement.appendChild(injectScript);
injectScript.remove();

// ===== RECEBE DADOS DO MAIN WORLD (via postMessage) =====
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data.type !== '__BETOU_WS') return;
  processarRawData(event.data.data);
});

function processarRawData(raw) {
  try {
    // SockJS: a["...","..."]
    if (raw.startsWith('a[')) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach(function(m) {
          if (typeof m === 'string') processarString(m);
        });
      }
      return;
    }
    processarString(raw);
  } catch(e) {}
}

function processarString(msg) {
  try {
    var clean = msg.replace(/\\x00/g, '').trim();
    // JSON direto
    if (clean.startsWith('{')) {
      var json = JSON.parse(clean);
      var rodada = extrairRodada(json);
      if (rodada) {
        console.log('[Betou] WS:', rodada.rodada, rodada.mult?.toFixed(2)+'x');
        adicionarVela(rodada);
      }
      return;
    }
    // STOMP frame: body apos \n\n
    var idx = clean.indexOf('\n\n');
    if (idx > 0) {
      var body = clean.substring(idx + 2).replace(/\\x00/g, '').trim();
      if (body.startsWith('{')) {
        var json = JSON.parse(body);
        var rodada = extrairRodada(json);
        if (rodada) {
          console.log('[Betou] STOMP:', rodada.rodada, rodada.mult?.toFixed(2)+'x');
          adicionarVela(rodada);
        }
      }
    }
  } catch(e) {}
}

// ===================================================================
// FALLBACK 1: CAPTURA DE CANVAS (lê o canvas do jogo)
// ===================================================================
let canvasCache = null;
let canvasInterval = null;
let ultimoCanvasHash = null;
let canvasEstavel = 0;
let canvasMultiplier = null;

function iniciarCanvasCapture() {
  if (canvasInterval) return;
  canvasInterval = setInterval(function() {
    try {
      // Procura canvas ativo (maior canvas visivel)
      var canvases = document.querySelectorAll('canvas');
      var target = null;
      var maxArea = 0;
      for (var i = 0; i < canvases.length; i++) {
        var c = canvases[i];
        if (c.width > 100 && c.height > 50) {
          var area = c.width * c.height;
          if (area > maxArea) {
            var rect = c.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 50) {
              maxArea = area;
              target = c;
            }
          }
        }
      }
      if (!target) return;

      var ctx = target.getContext('2d');
      if (!ctx) return;

      // Captura pixels do centro inferior (onde aparece o multiplicador)
      var w = target.width;
      var h = target.height;
      // Regiao: centro, 60% da largura, 15% da altura (tipica area do multiplier)
      var rx = Math.floor(w * 0.2);
      var ry = Math.floor(h * 0.25);
      var rw = Math.floor(w * 0.6);
      var rh = Math.floor(h * 0.4);
      var imageData = ctx.getImageData(rx, ry, rw, rh);

      // Gera hash dos pixels
      var hash = 0;
      var pixels = imageData.data;
      // Amostra a cada 20 pixels pra performance
      for (var i = 0; i < pixels.length; i += 80) {
        hash = ((hash << 5) - hash) + pixels[i];
        hash = hash & hash;
      }

      if (hash === ultimoCanvasHash) {
        canvasEstavel++;
      } else {
        canvasEstavel = 0;
        ultimoCanvasHash = hash;
      }

      // Tenta extrair o multiplicador do canvas lendo pixels claros
      // (numeros sao geralmente brancos/amarelos em fundo escuro)
      var brightPixels = 0;
      var totalSampled = 0;
      for (var i = 0; i < pixels.length; i += 16) {
        var r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        var brightness = (r + g + b) / 3;
        if (brightness > 200) brightPixels++;
        totalSampled++;
      }
      var ratio = brightPixels / totalSampled;

      // Se estabilizou e tem pixels claros (texto apareceu)
      if (canvasEstavel > 3 && ratio > 0.01 && ratio < 0.5) {
        var key = 'canvas_' + hash;
        if (!rodadasVistas.has(key)) {
          rodadasVistas.add(key);
          console.log('[Betou] 🎨 Canvas estavel, ratio:', ratio.toFixed(4));
          // Dispara busca DOM pra pegar o valor final
          capturarDOMExaustivo();
        }
      }

      // Se o canvas ficou escuro (nova rodada, fundo limpo)
      if (ratio < 0.005 && canvasEstavel > 2 && canvasCache) {
        console.log('[Betou] 🎨 Nova rodada detectada (canvas limpo)');
        canvasCache = null;
        canvasMultiplier = null;
      }
    } catch(e) {}
  }, 500);
}

// ===================================================================
// FALLBACK 2: DOM POLLING + MutationObserver
// ===================================================================
function capturarDOMExaustivo() {
  try {
    // Procura em TODOS os elementos por texto com numero decimal (multiplicador)
    var todos = document.querySelectorAll('*');
    var melhorValor = null;
    var melhorRodada = null;

    for (var i = 0; i < todos.length; i++) {
      var el = todos[i];
      if (el.children && el.children.length > 0) continue;
      var txt = (el.innerText || el.textContent || '').trim();
      if (!txt || txt.length > 30) continue;

      // Procura "Rodada 12345"
      var mR = txt.match(/[Rr]odada\s+(\d{4,})/);
      if (mR) melhorRodada = mR[1];

      // Procura multiplicador: numero com ate 2 casas decimais, opcional "x"
      var mV = txt.match(/(\d{1,4}\.\d{1,2})/);
      if (mV) {
        var v = parseFloat(mV[1]);
        if (v >= 1 && v < 100000 && (!melhorValor || v > melhorValor.valor)) {
          melhorValor = { valor: v, raw: txt };
        }
      }
    }

    if (melhorValor && melhorValor.valor !== lastMultiplier) {
      lastMultiplier = melhorValor.valor;
      var key = 'dom_exaustivo_' + melhorValor.valor.toFixed(2) + '_' + Date.now();
      if (!rodadasVistas.has(key)) {
        rodadasVistas.add(key);
        console.log('[Betou] 🔍 DOM exaustivo:', melhorValor.valor.toFixed(2)+'x', 'rodada:', melhorRodada);
        adicionarVela({
          rodada: melhorRodada ? parseInt(melhorRodada) : undefined,
          multiplicador: melhorValor.valor,
          timestamp: getTimeNow(),
          origem: 'dom_exaustivo'
        });
      }
    }
  } catch(e) {}
}

// MutationObserver
let timeoutDOM = null;
const observer = new MutationObserver(function() {
  if (timeoutDOM) return;
  timeoutDOM = setTimeout(function() {
    timeoutDOM = null;
    capturarDOMExaustivo();
  }, 800);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', function() {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Polling DOM periodico
setInterval(capturarDOMExaustivo, 1000);

// Polling .payout a cada 500ms
setInterval(function() {
  try {
    var payouts = document.querySelectorAll('.payout');
    if (payouts.length) {
      var txt = payouts[0].innerText.trim();
      var mult = parseFloat(txt.replace('x', '').replace(',', '.'));
      if (!isNaN(mult) && mult > 0 && mult < 100000 && mult !== lastMultiplier) {
        lastMultiplier = mult;
        var key = 'payout_' + mult.toFixed(2) + '_' + Date.now();
        if (rodadasVistas.has(key)) return;
        rodadasVistas.add(key);
        console.log('[Betou] 💰 payout:', mult.toFixed(2)+'x');
        adicionarVela({
          multiplicador: mult,
          timestamp: getTimeNow(),
          origem: 'payout'
        });
      }
    }
  } catch(e) {}
}, 500);

// Inicia captura de canvas apos 2s
setTimeout(iniciarCanvasCapture, 2000);

// ===================================================================
// EXTRAIR RODADA DE JSON
// ===================================================================
function extrairRodada(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.round && data.multiplier !== undefined) return { rodada: data.round, mult: parseFloat(data.multiplier) };
  if (data.rodada && data.mult !== undefined) return { rodada: data.rodada, mult: parseFloat(data.mult) };
  if (data.roundId && data.multiplier !== undefined) return { rodada: data.roundId, mult: parseFloat(data.multiplier) };
  if (data.id && data.value !== undefined) return { rodada: data.id, mult: parseFloat(data.value) };
  if (data.r && data.m !== undefined) return { rodada: data.r, mult: parseFloat(data.m) };
  if (data.rodada && data.multiplicador !== undefined) return { rodada: data.rodada, mult: parseFloat(data.multiplicador) };
  if (Array.isArray(data)) return extrairRodada(data[0]);
  if (data.data && typeof data.data === 'object') return extrairRodada(data.data);
  if (data.payload) return extrairRodada(data.payload);
  if (data.result) return extrairRodada(data.result);
  if (data.args) return extrairRodada(data.args);
  if (data.body) return extrairRodada(data.body);
  return null;
}

// ===================================================================
// ENVIO
// ===================================================================
function adicionarVela(rodada) {
  var id = rodada.rodada || rodada.capturado_em || Date.now();
  if (rodadasVistas.has(id)) return;
  rodadasVistas.add(id);
  if (rodadasVistas.size > 2000) rodadasVistas = new Set([...rodadasVistas].slice(-1000));

  ultimasVelas.push({ ...rodada, capturado_em: Date.now() });
  if (ultimasVelas.length > 30) ultimasVelas = ultimasVelas.slice(-30);
  enviarLote();
}

function enviarLote() {
  var agora = Date.now();
  if (agora - ultimoEnvio < INTERVALO_ENVIO * 1000) return;
  if (ultimasVelas.length === 0) return;
  ultimoEnvio = agora;
  var lote = [...ultimasVelas];
  ultimasVelas = [];

  var rodadas = lote.map(function(v) {
    return {
      rodada: v.rodada || 0,
      multiplicador: v.mult || v.multiplicador || 0,
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
    chrome.runtime.sendMessage({
      tipo: 'status',
      conectada: true,
      ultimaVela: lote.length > 0 ? lote[lote.length-1].multiplicador.toFixed(2) + 'x' : '—',
      totalEnviadas: lote.length
    }).catch(function(){});
  }).catch(function() {
    ultimasVelas.unshift.apply(ultimasVelas, lote);
    if (ultimasVelas.length > 50) ultimasVelas = ultimasVelas.slice(-50);
  });
}

// Heartbeat
setInterval(function() {
  fetch(SERVER_URL + '/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fonte: 'extensao_betou',
      token: config.token,
      aviator: getPainel(),
      heartbeat: true,
      timestamp: new Date().toISOString()
    })
  }).then(function() {
    chrome.runtime.sendMessage({ tipo: 'status', conectada: true }).catch(function(){});
  }).catch(function(){});
}, 30000);

// Envio forcado a cada 5s
setInterval(function() {
  if (ultimasVelas.length > 0) {
    ultimoEnvio = 0;
    enviarLote();
  }
}, 5000);

// Anti-throttle
try {
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  setInterval(function() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, 10000);
} catch(e) {}

console.log('[Betou v6.0] Ativo |', location.hostname, '| Painel', getPainel());
