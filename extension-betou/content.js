// ===== Content Script - Betou Coletor v4.3 =====
(function() {
  if (window.__BETOU_COLETOR_ATIVO) return;
  window.__BETOU_COLETOR_ATIVO = true;

  const SERVER_URL = "https://painel-aviator.onrender.com";
  const LOG = true;

  function log(...args) { if (LOG) console.log('[Betou v4.3]', ...args); }

  // Estado
  let ultimaRodadaId = null;
  let ultimoRegistro = '';
  let rodadasEnviadas = new Set();
  let historicoCapturado = new Set();
  let configToken = 'default';

  // Carrega token
  try {
    chrome.storage.sync.get(['token'], (cfg) => {
      if (cfg.token) configToken = cfg.token;
      log('Token:', configToken);
    });
  } catch(e) {}

  log('Ativo |', window.location.href.substring(0, 100));

  // ===== ANTI-THROTTLE =====
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    gain.gain.value = 0; osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    setInterval(() => { if (ctx.state === "suspended") ctx.resume(); }, 20000);
  } catch(e) {}

  // ===== CAPTURA RODADA =====
  function capturarRodada() {
    try {
      const spans = document.querySelectorAll('span.text-uppercase[class*="ng-tns-c"], span.text-uppercase');
      for (const span of spans) {
        const txt = (span.innerText || span.textContent || "").trim();
        const m = txt.match(/[Rr]odada\s+(\d{4,})/);
        if (m) return m[1];
        const m2 = txt.match(/^(\d{5,})$/);
        if (m2) return m2[1];
      }
      const all = document.querySelectorAll("span, div, h1, h2, h3, p, label, b, strong");
      for (const el of all) {
        if (el.children.length > 0) continue;
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

  // ===== CAPTURA MULTIPLICADOR =====
  function capturarMultiplicador() {
    try {
      let el = document.querySelector('.bubble-multiplier');
      if (el) {
        const v = parseFloat(el.innerText.replace('x', '').replace(',', '.').trim());
        if (!isNaN(v) && v >= 1) return v;
      }
      let payouts = document.querySelectorAll(".payout");
      if (payouts.length) {
        const v = parseFloat(payouts[0].innerText.replace('x', '').replace(',', '.').trim());
        if (!isNaN(v) && v >= 1) return v;
      }
      const iframes = document.querySelectorAll("iframe");
      for (const fr of iframes) {
        try {
          const d = fr.contentDocument; if (!d) continue;
          el = d.querySelector('.bubble-multiplier');
          if (el) {
            const v = parseFloat(el.innerText.replace('x', '').replace(',', '.').trim());
            if (!isNaN(v) && v >= 1) return v;
          }
        } catch(e) {}
      }
    } catch(e) {}
    return null;
  }

  // ===== CAPTURA HORÁRIO =====
  function capturarHorario() {
    try {
      const timeEl = document.querySelector('.header__info-time, app-fairness .header__info-time');
      if (timeEl) {
        const t = timeEl.innerText.trim();
        if (t.match(/^\d{2}:\d{2}:\d{2}$/)) return t;
      }
      const todos = document.querySelectorAll('span, div, p, label');
      for (const el of todos) {
        if (el.children.length) continue;
        const texto = el.innerText || '';
        const m = texto.match(/(\d{2}:\d{2}:\d{2})/);
        if (m) return m[1];
      }
    } catch(e) {}
    return new Date().toLocaleTimeString('pt-BR');
  }

  // ===== IDENTIFICA PAINEL =====
  function identificarPainel() {
    try {
      return window.top.location.href.includes('/aviator2') ? 1 : 2;
    } catch(e) {
      return document.referrer.includes('/aviator2') ? 1 : 2;
    }
  }

  // ===== ENVIA WEBHOOK =====
  async function enviarRodada(rodadaId, multiplicador, horario) {
    const numId = parseInt(rodadaId);
    if (!numId || rodadasEnviadas.has(numId)) return;

    log(`📤 #${rodadaId} ${multiplicador.toFixed(2)}x ${horario}`);

    try {
      const r = await fetch(`${SERVER_URL}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: configToken,
          aviator: identificarPainel(),
          rodadas: [{
            rodada: numId,
            multiplicador: multiplicador,
            timestamp: horario,
            origem: 'dom',
            cor: null
          }]
        }),
        keepalive: true
      });

      if (r.ok) {
        rodadasEnviadas.add(numId);
        if (rodadasEnviadas.size > 500) {
          const arr = [...rodadasEnviadas];
          rodadasEnviadas = new Set(arr.slice(-250));
        }
        log(`✅ #${rodadaId} enviada`);
      }
    } catch(e) {
      log('❌ Erro:', e.message);
    }
  }

  // ===== CAPTURA HISTÓRICO (dropdown) =====
  function capturarHistorico() {
    try {
      const payouts = document.querySelectorAll('.payouts-wrapper .payouts-block .payout, app-stats-widget .payout');
      if (!payouts.length) return;

      payouts.forEach((el, idx) => {
        const raw = (el.innerText || el.textContent || "").trim();
        const value = parseFloat(raw.replace(/x/gi,"").replace(",",".").trim());
        if (!value || isNaN(value) || value < 1 || value > 100000) return;

        const rodadaBase = parseInt(ultimaRodadaId) || Math.floor(Date.now() / 1000);
        const rodadaHistorico = rodadaBase - (payouts.length - 1 - idx);
        if (rodadasEnviadas.has(rodadaHistorico)) return;

        const ts = document.querySelector('app-stats-dropdown .header__info-time');
        const horario = ts ? ts.textContent.trim() : capturarHorario();

        log(`📜 #${rodadaHistorico} ${value.toFixed(2)}x`);
        rodadasEnviadas.add(rodadaHistorico);

        fetch(`${SERVER_URL}/api/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: configToken,
            aviator: identificarPainel(),
            rodadas: [{ rodada: rodadaHistorico, multiplicador: value, timestamp: horario, origem: 'historico', cor: null }]
          }),
          keepalive: true
        }).catch(() => {});
      });
    } catch(e) {}
  }

  // ===== MONITOR PRINCIPAL =====
  async function monitorar() {
    const rodadaId = capturarRodada();
    const multiplicador = capturarMultiplicador();
    if (!rodadaId || !multiplicador) return;

    const registro = `${rodadaId}|${multiplicador}`;

    // Detecta mudança de rodada → envia a anterior
    if (rodadaId !== ultimaRodadaId && ultimaRodadaId !== null) {
      const [idAntigo, multAntigo] = ultimoRegistro.split('|');
      if (idAntigo && multAntigo) {
        await enviarRodada(idAntigo, parseFloat(multAntigo), capturarHorario());
      }
    }

    ultimaRodadaId = rodadaId;
    ultimoRegistro = registro;
  }

  // ===== DOM OBSERVER =====
  let domTimeout = null;
  try {
    const observer = new MutationObserver(() => {
      if (domTimeout) return;
      domTimeout = setTimeout(() => { domTimeout = null; monitorar(); }, 300);
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  } catch(e) {}

  // ===== START =====
  setInterval(monitorar, 800);
  setInterval(capturarHistorico, 5000);

  setTimeout(monitorar, 1000);
  setTimeout(monitorar, 2000);
  setTimeout(monitorar, 3000);

  log('=== BETOU v4.3 ATIVO ===');
})();
