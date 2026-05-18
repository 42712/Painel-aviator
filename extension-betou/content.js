// ===== Content Script - Betou Coletor v4.1 =====
(function() {
  if (window.__BETOU_COLETOR_ATIVO) return;
  window.__BETOU_COLETOR_ATIVO = true;

  const SERVER_URL = "https://painel-aviator.onrender.com";
  const LOG = true;
  const isIframe = window.self !== window.top;
  const hostname = window.location.hostname;

  function log(...args) { if (LOG) console.log('[Betou v4]', ...args); }

  let lastValue = null;
  let lastRound = null;
  let lastSentRound = null;
  let lastSentValue = null;
  let historicoCapturado = new Set();
  let configToken = 'default';

  // Carrega token do storage
  try {
    chrome.storage.sync.get(['token'], (cfg) => {
      if (cfg.token) configToken = cfg.token;
      log('Token carregado:', configToken);
    });
  } catch(e) {}

  log('Ativo | url=' + window.location.href.substring(0, 100));
  log('iframe=' + isIframe);
  log('dominio=' + hostname);

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

  // ===== COMPARTILHAMENTO DO NÚMERO DA RODADA ENTRE FRAMES =====
  // No iframe Spribe não enxerga o DOM da Betou.
  // Quem achar a rodada primeiro salva no storage.local para todos usarem.

  function salvarRodadaGlobal(round) {
    if (!round) return;
    try {
      chrome.storage.local.set({ rodadaCompartilhada: round, rodadaAtualizadaEm: Date.now() });
    } catch(e) {}
  }

  function carregarRodadaGlobal() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['rodadaCompartilhada', 'rodadaAtualizadaEm'], (r) => {
          if (r.rodadaCompartilhada && r.rodadaAtualizadaEm && Date.now() - r.rodadaAtualizadaEm < 30000) {
            resolve(String(r.rodadaCompartilhada));
          } else {
            resolve(null);
          }
        });
      } catch(e) { resolve(null); }
    });
  }

  // ===== NÚMERO DA RODADA =====
  async function extractRound() {
    // Se for iframe Spribe, tenta ler rodada compartilhada primeiro
    if (isIframe && hostname.includes('spribegaming')) {
      const r = await carregarRodadaGlobal();
      if (r) { log('Rodada compartilhada:', r); return r; }
    }

    try {
      // Se for página Betou (top), busca no DOM direto
      if (!isIframe || hostname.includes('betou')) {
        // Método 1: Betou - span.text-uppercase com número da rodada
        const spans = document.querySelectorAll('span.text-uppercase[class*="ng-tns-c"], span.text-uppercase');
        for (const span of spans) {
          const txt = (span.innerText || span.textContent || "").trim();
          const m = txt.match(/[Rr]odada\s+(\d{4,})/);
          if (m) { salvarRodadaGlobal(m[1]); log('Rodada:', m[1]); return m[1]; }
          const m2 = txt.match(/^(\d{5,})$/);
          if (m2) { salvarRodadaGlobal(m2[1]); log('Rodada:', m2[1]); return m2[1]; }
        }

        // Método 2: qualquer span/div com "Rodada XXXXX"
        const all = document.querySelectorAll("span, div, h1, h2, h3, p, label, b, strong");
        for (const el of all) {
          if (el.children.length > 0) continue;
          const txt = (el.innerText || el.textContent || "").trim();
          const m = txt.match(/[Rr]odada\s+(\d{4,})/);
          if (m) { salvarRodadaGlobal(m[1]); log('Rodada:', m[1]); return m[1]; }
          const mR = txt.match(/[Rr]ound\s+(\d{4,})/);
          if (mR) { salvarRodadaGlobal(mR[1]); log('Round:', mR[1]); return mR[1]; }
        }

        // Método 3: body text
        const bodyText = document.body ? (document.body.innerText || "") : "";
        const mBody = bodyText.match(/[Rr]odada\s+(\d{5,})/);
        if (mBody) { salvarRodadaGlobal(mBody[1]); log('Rodada body:', mBody[1]); return mBody[1]; }
      }

    } catch(e) { log('Erro round:', e.message); }

    // Último fallback: tenta ler do storage
    const r = await carregarRodadaGlobal();
    if (r) return r;

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

  function extractTimestamp() {
    try {
      // Tenta .header__info-time (modal fairness da Betou)
      const timeEl = document.querySelector('.header__info-time, app-fairness .header__info-time');
      if (timeEl) {
        const t = (timeEl.innerText || timeEl.textContent || "").trim();
        if (t && /^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
      }
      // Tenta qualquer elemento com horário HH:MM:SS próximo ao jogo
      const all = document.querySelectorAll('span, div, p, label');
      for (const el of all) {
        if (el.children.length > 0) continue;
        const txt = (el.innerText || el.textContent || "").trim();
        const m = txt.match(/(\d{2}:\d{2}:\d{2})/);
        if (m) return m[1];
      }
    } catch(e) {}
    // Fallback: hora atual
    return new Date().toLocaleTimeString('pt-BR');
  }

  let rodadasEnviadas = 0;

  async function capture() {
    const found = encontrarElementoValor();
    if (!found) return;

    const { el, origem } = found;
    const value = extrairValor(el, origem);
    if (!value) return;

    const rgb = extractRgb(el);
    const round = await extractRound() || lastRound;
    if (round) lastRound = round;

    // Dedup: mesma rodada E mesmo valor = já foi enviado
    if (value === lastValue && round && round === lastSentRound) return;
    if (!round && value === lastValue) return;
    lastValue = value;
    lastSentRound = round;

    const rodadaNum = parseInt(round) || Math.floor(Date.now() / 1000);
    rodadasEnviadas++;
    const timestampReal = extractTimestamp();
    log(`✈ ${value.toFixed(2)}x #${rodadaNum} hora=${timestampReal} rgb=${rgb} origem=${origem}`);

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
          timestamp: timestampReal,
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
                    const wsTimestamp = extractTimestamp();
                    fetch(`${SERVER_URL}/api/webhook`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        token: configToken,
                        aviator: getAviatorPainel(),
                        rodadas: [{
                          rodada: rodId || Math.floor(Date.now() / 1000),
                          multiplicador: mult,
                          timestamp: wsTimestamp,
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

  // ===== CAPTURA DE HISTÓRICO (velas já finalizadas) =====
  function capturarHistorico() {
    try {
      // Busca todos os .payout dentro do histórico do jogo
      const payouts = document.querySelectorAll('.payouts-wrapper .payouts-block .payout, app-stats-widget .payout');
      if (!payouts.length) return;

      const roundAtual = lastRound || '';
      payouts.forEach((el, idx) => {
        const raw = (el.innerText || el.textContent || "").trim();
        const value = parseFloat(raw.replace(/x/gi,"").replace(",",".").trim());
        if (!value || isNaN(value) || value < 1 || value > 100000) return;

        // Chave única: posição + valor + rodada atual
        const chave = idx + '_' + value.toFixed(2) + '_' + roundAtual;
        if (historicoCapturado.has(chave)) return;
        historicoCapturado.add(chave);

        const timestampReal = extractTimestamp();
        const rodadaNum = parseInt(lastRound) || Math.floor(Date.now() / 1000);
        log(`📜 Histórico #${rodadaNum} ${value.toFixed(2)}x idx=${idx}`);

        fetch(`${SERVER_URL}/api/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: configToken,
            aviator: getAviatorPainel(),
            rodadas: [{
              rodada: rodadaNum - (payouts.length - 1 - idx),
              multiplicador: value,
              timestamp: timestampReal,
              origem: 'historico',
              cor: null
            }]
          }),
          keepalive: true
        }).catch(() => {});
      });
    } catch(e) {
      log('Erro historico:', e.message);
    }
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
  setInterval(capturarHistorico, 5000);
  setInterval(pingServer, 60000);

  // Captura inicial
  setTimeout(capture, 1000);
  setTimeout(capture, 2000);
  setTimeout(capture, 3000);

  log('=== BETOU v4.1 ATIVO ===');
})();
