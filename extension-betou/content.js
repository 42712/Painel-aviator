// ===== Content Script - Betou Coletor v4.1 =====
(function() {
  if (window.__BETOU_COLETOR_ATIVO) return;
  window.__BETOU_COLETOR_ATIVO = true;

  const SERVER_URL = "https://painel-aviator.onrender.com";
  const LOG = true;

  function log(...args) { if (LOG) console.log('[Betou v4]', ...args); }

  let lastValue = null;
  let lastRound = null;
  let configToken = 'default';

  // Carrega token do storage
  try {
    chrome.storage.sync.get(['token'], (cfg) => {
      if (cfg.token) configToken = cfg.token;
      log('Token carregado:', configToken);
    });
  } catch(e) {}

  log('Ativo | url=' + window.location.href.substring(0, 100));
  log('iframe=' + (window.self !== window.top));
  log('dominio=' + window.location.hostname);

  // ===== ANTI-THROTTLE (AudioContext) =====
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setInterval(() => { if (ctx.state === "suspended") ctx.resume(); }, 20000);
    log('Anti-throttle OK');
  } catch(e) {}

  // ===== COR RGB =====
  function extractRgb(el) {
    try {
      const c = el.style.color;
      if (c && c.startsWith("rgb")) return c.replace(/[^0-9,]/g,"").replace(/,$/,"");
      const comp = window.getComputedStyle(el).color;
      if (comp && comp.startsWith("rgb")) return comp.replace(/[^0-9,]/g,"").replace(/,$/,"");
    } catch(e) {}
    return null;
  }

  // ===== NÚMERO DA RODADA =====
  function extractRound() {
    try {
      const docs = [document];
      document.querySelectorAll("iframe").forEach(fr => {
        try { if (fr.contentDocument) docs.push(fr.contentDocument); } catch(e) {}
      });

      for (const doc of docs) {
        // Método 1: Betou - .text-uppercase[class*="ng-tns-c"]
        const spans = doc.querySelectorAll('span.text-uppercase[class*="ng-tns-c"]');
        for (const span of spans) {
          const txt = (span.innerText || span.textContent || "").trim();
          const m = txt.match(/[Rr]odada\s+(\d{4,})/);
          if (m) { log('Rodada:', m[1]); return m[1]; }
          const m2 = txt.match(/^(\d{5,})$/);
          if (m2) { log('Rodada:', m2[1]); return m2[1]; }
        }

        // Método 2: qualquer span/div com "Rodada XXXXX"
        const all = doc.querySelectorAll("span, div, h1, h2, h3, p, label");
        for (const el of all) {
          if (el.children.length > 0) continue;
          const txt = (el.innerText || el.textContent || "").trim();
          const m = txt.match(/[Rr]odada\s+(\d{4,})/);
          if (m) { log('Rodada:', m[1]); return m[1]; }
          const mR = txt.match(/[Rr]ound\s+(\d{4,})/);
          if (mR) { log('Round:', mR[1]); return mR[1]; }
        }

        // Método 3: modal header
        const headers = doc.querySelectorAll('[class*="modal-header"]');
        for (const h of headers) {
          const txt = (h.innerText || h.textContent || "").trim();
          const m = txt.match(/[Rr][Oo][Dd][Aa][Dd][Aa]\s+(\d{4,})/);
          if (m) { log('Rodada modal:', m[1]); return m[1]; }
        }
      }

      // Método 4: body text
      const bodyText = document.body ? (document.body.innerText || "") : "";
      const mBody = bodyText.match(/[Rr]odada\s+(\d{5,})/);
      if (mBody) { log('Rodada body:', mBody[1]); return mBody[1]; }

    } catch(e) { log('Erro round:', e.message); }
    return null;
  }

  // ===== CAPTURA POR SELETOR DINÂMICO =====
  function getAviatorPainel() {
    try {
      const topUrl = window.top.location.href;
      return topUrl.includes('/aviator2') ? 1 : 2;
    } catch(_) {
      return document.referrer.includes('/aviator2') ? 1 : 2;
    }
  }

  function encontrarElementoValor() {
    // Tenta .bubble-multiplier (betou.bet.br DOM direto)
    let el = document.querySelector('.bubble-multiplier');
    if (el) return { el, origem: 'bubble' };

    // Tenta .payout (spribegaming iframe)
    let payouts = document.querySelectorAll(".payout");
    if (payouts.length) return { el: payouts[0], origem: 'payout' };

    // Tenta dentro de iframes
    const iframes = document.querySelectorAll("iframe");
    for (const fr of iframes) {
      try {
        const d = fr.contentDocument;
        if (!d) continue;
        el = d.querySelector('.bubble-multiplier');
        if (el) return { el, origem: 'bubble' };
        payouts = d.querySelectorAll(".payout");
        if (payouts.length) return { el: payouts[0], origem: 'payout' };
      } catch(e) {}
    }

    return null;
  }

  function extrairValor(el, origem) {
    const raw = (el.innerText || el.textContent || "").trim();
    const value = parseFloat(raw.replace(/x/gi,"").replace(",",".").trim());
    if (!value || isNaN(value) || value < 1 || value > 100000) return null;
    return value;
  }

  let rodadasEnviadas = 0;

  function capture() {
    const found = encontrarElementoValor();
    if (!found) return;

    const { el, origem } = found;
    const value = extrairValor(el, origem);
    if (!value) return;
    if (value === lastValue) return;
    lastValue = value;

    const rgb = extractRgb(el);
    const round = extractRound() || lastRound;
    if (round) lastRound = round;

    const rodadaNum = parseInt(round) || Math.floor(Date.now() / 1000);
    rodadasEnviadas++;
    log(`✈ ${value.toFixed(2)}x #${rodadaNum} rgb=${rgb} origem=${origem}`);

    // Envia para o servidor
    fetch(`${SERVER_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: configToken,
        aviator: getAviatorPainel(),
        rodadas: [{
          rodada: rodadaNum,
          multiplicador: value,
          timestamp: new Date().toLocaleTimeString('pt-BR'),
          origem: origem,
          cor: rgb
        }]
      }),
      keepalive: true
    })
    .then(r => r.json().then(d => log('Enviado! Total:', d)))
    .catch(e => log('Falha:', e.message));

    // Notifica background
    try {
      chrome.runtime.sendMessage({
        tipo: 'status',
        conectada: true,
        ultimaVela: `${value.toFixed(2)}x`,
        totalEnviadas: rodadasEnviadas
      }).catch(()=>{});
    } catch(_) {}
  }

  // ===== WEBSOCKET INTERCEPT =====
  try {
    const NativeWS = window.WebSocket;
    window.WebSocket = new Proxy(NativeWS, {
      construct(target, args) {
        const ws = new target(...args);
        const url = args[0] || '';
        // Intercepta LiveChat e qualquer WS que contenha dados de jogo
        if (url.includes('livechatinc.com') || url.includes('spribe')) {
          log('WS interceptado:', url.substring(0, 100));
          ws.addEventListener('message', (event) => {
            try {
              const data = JSON.parse(event.data);
              // Procura dados de rodada na mensagem
              if (data && typeof data === 'object') {
                // Verifica campos que podem conter multiplicador
                const payload = data.payload || data;
                if (payload.multiplier || payload.mult) {
                  const mult = parseFloat(payload.multiplier || payload.mult);
                  const rodId = payload.round || payload.rodada || payload.id || payload.r;
                  if (mult && mult > 0 && mult < 100000) {
                    log('WS mult:', mult, 'rod:', rodId);
                    lastValue = mult;
                    if (rodId) lastRound = String(rodId);
                    rodadasEnviadas++;
                    const rgb = null;
                    fetch(`${SERVER_URL}/api/webhook`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        token: configToken,
                        aviator: getAviatorPainel(),
                        rodadas: [{
                          rodada: rodId || Math.floor(Date.now() / 1000),
                          multiplicador: mult,
                          timestamp: new Date().toLocaleTimeString('pt-BR'),
                          origem: 'websocket',
                          cor: rgb
                        }]
                      }),
                      keepalive: true
                    }).catch(() => {});
                  }
                }
              }
            } catch(e) {}
          });
        }
        return ws;
      }
    });
    log('WS intercept ativo');
  } catch(e) {
    log('WS intercept erro:', e.message);
  }

  // ===== HEARTBEAT =====
  function pingServer() {
    fetch(`${SERVER_URL}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: configToken,
        aviator: getAviatorPainel(),
        heartbeat: true,
        timestamp: new Date().toISOString()
      }),
      keepalive: true
    }).catch(() => {});
  }

  // ===== OBSERVER DOM (reage a mudanças) =====
  let domTimeout = null;
  try {
    const observer = new MutationObserver(() => {
      if (domTimeout) return;
      domTimeout = setTimeout(() => {
        domTimeout = null;
        capture();
      }, 300);
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
    log('Observer OK');
  } catch(e) {}

  // ===== START =====
  setInterval(capture, 800);
  setInterval(pingServer, 60000);

  // Captura inicial
  setTimeout(capture, 1000);
  setTimeout(capture, 2000);
  setTimeout(capture, 3000);

  log('=== BETOU v4.1 ATIVO ===');
})();
