// ===== FONTE 1: INTERCEPTACAO DO JOGO (main-world) - RODADA REAL =====
window.addEventListener('aviator-ws-data', (ev) => {
    try {
        const raw = typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail);
        let data = null;
        try { data = JSON.parse(raw); } catch(e) { return; }
        if (!data) return;
        
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
            // Multiplos formatos de crash do Spribe
            const tipo = item.type || item.t || '';
            const crash = item.crash_point || item.crashPoint || item.multiplier || item.valor;
            const rid = item.round_id || item.roundId || item.id;
            // Timestamp do jogo ou hora local
            const its = item.timestamp || item.createdAt || item.time || '';
            
            if ((tipo === 'crash' || tipo === 'result') && crash && rid) {
                const mult = parseFloat(crash);
                if (mult >= 1) {
                    let ts;
                    if (its) {
                        try { ts = new Date(its).toLocaleTimeString('pt-BR', {timeZone:'America/Sao_Paulo',hour12:false}); } catch(e){}
                    }
                    if (!ts) ts = new Date().toLocaleTimeString('pt-BR');
                    window.__ultimaRodadaReal = String(rid);
                    console.log('🎯 JOGO WS: ' + mult + 'x | round_id=' + rid + ' | ' + ts);
                    enviarVela(mult, rid, ts, "spribe");
                }
            }
        }
    } catch(e) {}
});

// ===== CAPTURA RODADA DO DOM (fairness modal + outros) =====
function extrairRodada() {
    // 1. Span do fairness (da sua descoberta no TUTORIAL)
    const modalSpan = document.querySelector('app-fairness span.text-uppercase');
    if (modalSpan) {
        const match = modalSpan.textContent.match(/Rodada\s+(\d+)/i);
        if (match) return match[1];
    }
    // 2. TreeWalker no documento principal
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const match = node.textContent.match(/Rodada\s+(\d+)/i);
        if (match) return match[1];
    }
    // 3. Dentro de iframes (o jogo pode estar num iframe)
    for (const iframe of document.querySelectorAll('iframe')) {
        try {
            if (!iframe.contentDocument) continue;
            const w = iframe.contentDocument.createTreeWalker(iframe.contentDocument.body, NodeFilter.SHOW_TEXT, null, false);
            let n;
            while ((n = w.nextNode())) {
                const m = n.textContent.match(/Rodada\s+(\d+)/i);
                if (m) return m[1];
            }
        } catch(e) {}
    }
    // 4. round_id do WebSocket (cache)
    if (window.__ultimaRodadaReal) return window.__ultimaRodadaReal;
    // 5. Seletores genericos
    const roundEl = document.querySelector('[class*="round" i], [data-round], game-round-id');
    if (roundEl) return roundEl.getAttribute('data-round') || roundEl.textContent.trim();
    return null;
}

// Atualiza cache da rodada periodicamente
setInterval(() => {
    const r = extrairRodada();
    if (r) window.__ultimaRodadaReal = r;
}, 300);
