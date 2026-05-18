// ===== Content Script - Betou Coletor v4.3 =====
(function() {
  if (window.__BETOU_ATIVO) return;
  window.__BETOU_ATIVO = true;

  const SERVER_URL = "https://painel-aviator.onrender.com";
  const isSpribe = location.hostname.includes('spribegaming');
  const isBetou = location.hostname.includes('betou');

  function log(...a) { console.log('[Betou v4.3]', ...a); }
  log('Ativo |', location.hostname, location.href.substring(0,80));

  // ===== IDENTIFICA PAINEL (invertido: /aviator2 = painel 1) =====
  function getPainel() {
    try {
      return (isBetou && location.href.includes('/aviator2')) ? 1 : 2;
    } catch(e) { return 2; }
  }

  // ===== ENVIA PRO SERVIDOR =====
  function enviar(rodada, mult, timestamp, origem) {
    const numId = parseInt(rodada);
    if (!numId || !mult || mult < 1) return;
    fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        token: 'default',
        aviator: getPainel(),
        rodadas: [{ rodada: numId, multiplicador: mult, timestamp: timestamp || new Date().toLocaleTimeString('pt-BR'), origem: origem || 'dom', cor: null }]
      }),
      keepalive: true
    }).catch(() => {});
  }

  // ===================================================================
  // SPRIBEGAMING (iframe) — intercepta WebSocket
  // ===================================================================
  if (isSpribe) {
    log('Modo WebSocket');
    let enviados = new Set();
    const WS = window.WebSocket;
    window.WebSocket = function(url, protos) {
      const ws = new WS(url, protos);
      try {
        if (url.includes('spribe') || url.includes('spr')) {
          ws.addEventListener('message', function(e) {
            try {
              const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
              if (!data) return;
              let mult = null, round = null;
              function scan(obj, depth) {
                if (!obj || depth > 5) return;
                if (Array.isArray(obj)) { obj.forEach(v => scan(v, depth+1)); return; }
                if (typeof obj !== 'object') return;
                for (const k of Object.keys(obj)) {
                  if ((k === 'multiplier' || k === 'mult' || k === 'value' || k === 'multiplicador') && typeof obj[k] === 'number' && obj[k] > 0 && obj[k] < 100000) mult = obj[k];
                  if ((k === 'round' || k === 'rodada' || k === 'r' || k === 'roundId') && typeof obj[k] === 'number') round = obj[k];
                }
                for (const k of Object.keys(obj)) {
                  if (k === 'payload' || k === 'data' || k === 'result' || k === 'args') scan(obj[k], depth+1);
                }
              }
              scan(data, 0);
              if (mult && round && !enviados.has(round)) {
                enviados.add(round);
                if (enviados.size > 500) enviados = new Set([...enviados].slice(-250));
                log('📡 WS:', round, mult.toFixed(2)+'x');
                enviar(round, mult, null, 'websocket');
              }
            } catch(er) {}
          });
        }
      } catch(e) {}
      return ws;
    };
    window.WebSocket.prototype = WS.prototype;
    window.WebSocket.CONNECTING = WS.CONNECTING;
    window.WebSocket.OPEN = WS.OPEN;
    window.WebSocket.CLOSING = WS.CLOSING;
    window.WebSocket.CLOSED = WS.CLOSED;
    return;
  }

  // ===================================================================
  // BETOU.BET.BR (frame principal) — DOM polling + timer
  // ===================================================================
  if (!isBetou) return;
  log('Modo DOM');

  let ultimaRodadaId = null;
  let ultimoMultiplicador = null;
  let enviadas = new Set();
  let historicoSet = new Set();
  let horarioAnterior = null;

  // ===== TIMER REAL (observa o cronômetro do jogo) =====
  function capturarTimer() {
    try {
      // Betou mostra o timer em vários formatos
      const els = document.querySelectorAll('.header__info-time, .time-left, .cda-time, [class*="timer"], [class*="cron"]');
      for (const el of els) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (txt.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) return txt;
      }
    } catch(e) {}
    return null;
  }

  function capturarRodada() {
    try {
      const spans = document.querySelectorAll('span.text-uppercase[class*="ng-tns-c"], span.text-uppercase');
      for (const s of spans) {
        const txt = (s.innerText || s.textContent || "").trim();
        const m = txt.match(/[Rr]odada\s+(\d{4,})/);
        if (m) return m[1];
        const m2 = txt.match(/^(\d{5,})$/);
        if (m2) return m2[1];
      }
      const todos = document.querySelectorAll("span, div, h1, h2, h3, p, label, b, strong");
      for (const el of todos) {
        if (el.children.length) continue;
        const txt = (el.innerText || el.textContent || "").trim();
        const m = txt.match(/[Rr]odada\s+(\d{4,})/);
        if (m) return m[1];
        const mR = txt.match(/[Rr]ound\s+(\d{4,})/);
        if (mR) return mR[1];
      }
      const bodyText = document.body ? (document.body.innerText || "") : "";
      const mBody = bodyText.match(/[Rr]odada\s+(\d{5,})/);
      if (mBody) return mBody[1];
    } catch(e) {}
    return null;
  }

  function capturarMultiplicador() {
    try {
      let el = document.querySelector('.bubble-multiplier');
      if (el) {
        const v = parseFloat(el.innerText.replace('x','').replace(',','.').trim());
        if (!isNaN(v) && v >= 1) return v;
      }
      const payouts = document.querySelectorAll(".payout");
      if (payouts.length) {
        const v = parseFloat(payouts[0].innerText.replace('x','').replace(',','.').trim());
        if (!isNaN(v) && v >= 1) return v;
      }
    } catch(e) {}
    return null;
  }

  function capturarHorario() {
    try {
      const timeEl = document.querySelector('.header__info-time, app-fairness .header__info-time');
      if (timeEl) {
        const t = timeEl.innerText.trim();
        if (t.match(/^\d{2}:\d{2}:\d{2}$/)) { horarioAnterior = t; return t; }
      }
      if (horarioAnterior) return horarioAnterior;
    } catch(e) {}
    return new Date().toLocaleTimeString('pt-BR');
  }

  function monitorar() {
    const rodadaId = capturarRodada();
    const mult = capturarMultiplicador();
    if (!rodadaId || !mult) return;

    // Se mudou a rodada, envia a anterior
    if (ultimaRodadaId !== null && rodadaId !== ultimaRodadaId && ultimoMultiplicador !== null) {
      if (!enviadas.has(ultimaRodadaId)) {
        enviadas.add(ultimaRodadaId);
        if (enviadas.size > 500) enviadas = new Set([...enviadas].slice(-250));
        const horario = capturarHorario();
        log('✅ #'+ultimaRodadaId, ultimoMultiplicador.toFixed(2)+'x', horario);
        enviar(ultimaRodadaId, ultimoMultiplicador, horario, 'dom');
      }
    }

    if (rodadaId !== ultimaRodadaId) {
      // Rodada nova: reseta rastreamento
      ultimaRodadaId = rodadaId;
      ultimoMultiplicador = mult;
    } else {
      // Mesma rodada: atualiza pro maior valor (pode ser bubble subindo)
      ultimoMultiplicador = Math.max(ultimoMultiplicador, mult);
    }
  }

  // ===== HISTÓRICO =====
  function capturarHistorico() {
    try {
      const payouts = document.querySelectorAll('.payouts-wrapper .payouts-block .payout, app-stats-widget .payout');
      if (!payouts.length) return;

      const rodadaBase = parseInt(ultimaRodadaId) || Math.floor(Date.now() / 1000);
      const tsEl = document.querySelector('app-stats-dropdown .header__info-time');
      const horario = tsEl ? tsEl.textContent.trim() : capturarHorario();

      payouts.forEach((el, idx) => {
        const raw = (el.innerText || el.textContent || "").trim();
        const value = parseFloat(raw.replace(/x/gi,"").replace(",",".").trim());
        if (!value || isNaN(value) || value < 1 || value > 100000) return;

        const rodadaHistorico = rodadaBase - (payouts.length - 1 - idx);
        const chave = idx + '_' + rodadaHistorico;
        if (historicoSet.has(chave) || enviadas.has(rodadaHistorico)) return;
        historicoSet.add(chave);

        log('📜 #'+rodadaHistorico, value.toFixed(2)+'x');
        enviar(rodadaHistorico, value, horario, 'historico');
      });
    } catch(e) {}
  }

  // ===== HEARTBEAT =====
  function heartbeat() {
    fetch(`${SERVER_URL}/api/webhook`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ heartbeat: true, token: 'default', aviator: getPainel(), timestamp: new Date().toISOString() }),
      keepalive: true
    }).catch(() => {});
  }

  // ===== START =====
  setInterval(monitorar, 600);
  setInterval(capturarHistorico, 5000);
  setInterval(heartbeat, 30000);

  setTimeout(monitorar, 300);
  setTimeout(monitorar, 1000);
  setTimeout(monitorar, 2000);

  log('=== BETOU v4.3 ATIVO ===');
})();
