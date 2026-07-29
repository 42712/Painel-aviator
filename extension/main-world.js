// ===== MAIN WORLD - WebSocket Proxy =====
// Injeta no contexto da página para interceptar WS mesmo em iframes
(function() {
  if (window.__aviatorWSProxy) return;
  window.__aviatorWSProxy = true;

  const NativeWS = window.WebSocket;
  if (!NativeWS) return;

  window.WebSocket = new Proxy(NativeWS, {
    construct(Target, args) {
      const ws = new Target(...args);
      const url = (args[0] || '').toString().toLowerCase();

      ws.addEventListener('message', function onMsg(ev) {
        try {
          let raw = ev.data;
          if (raw instanceof Blob) {
            const r = new FileReader();
            r.onload = () => {
              window.dispatchEvent(new CustomEvent('aviator-ws-data', { detail: r.result }));
            };
            r.readAsText(raw);
            return;
          }
          if (raw instanceof ArrayBuffer) {
            raw = new TextDecoder().decode(raw);
          }
          if (typeof raw === 'string') {
            window.dispatchEvent(new CustomEvent('aviator-ws-data', { detail: raw }));
          }
        } catch(e) { /* ignorar */ }
      });

      return ws;
    }
  });

  // DOM scan trigger no MAIN world
  setInterval(() => {
    const sel = [
      '[class*="multiplier"],[class*="Multiplier"]',
      '[class*="bubble"],[class*="Bubble"]',
      '.bubble-multiplier',
      '[class*="game-end"],[class*="game_end"]',
      '[class*="round"],[class*="Round"]',
      '[data-testid*="multiplier"]',
      '[class*="value"],[class*="Value"]'
    ].join(',');
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const txt = el.textContent.trim();
      if (!txt) continue;
      window.dispatchEvent(new CustomEvent('aviator-dom-text', { detail: txt }));
    }
  }, 1500);

  console.log('[Aviator MAIN] WS Proxy + DOM scanner ativo');
})();
