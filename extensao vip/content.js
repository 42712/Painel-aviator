const API_URL = "https://painel-aviator.onrender.com/api/nova-vela";

function detectarAviator() {
    return window.location.href.includes('aviator2') ? 2 : 1;
}

function calcularSoma(mult) {
    const str = mult.toFixed(2).replace('.', '');
    let soma = 0;
    for (let i = 0; i < str.length && i < 3; i++) soma += parseInt(str[i]) || 0;
    return soma;
}

const enviadas = new Set();

function enviarVela(mult, rodada, timestamp, origem) {
    const multNum = parseFloat(mult);
    if (isNaN(multNum) || multNum <= 0) return;
    const painel = detectarAviator();
    const chave = painel + '_' + rodada;
    if (enviadas.has(chave)) return;
    enviadas.add(chave);

    const horario = timestamp || new Date().toLocaleTimeString('pt-BR');

    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            painel, multiplicador: multNum,
            rodada: rodada.toString(), timestamp: horario,
            soma: calcularSoma(multNum), fonte: origem || "sortenabet"
        })
    }).then(r => r.json()).then(d => {
        if (d.ok) console.log(`✅ [AVIATOR ${painel}] ${multNum}x rodada ${rodada}`);
    }).catch(() => {});
}

let rodadaCache = null;

function extrairRodada() {
    const modalSpan = document.querySelector('app-fairness span.text-uppercase');
    if (modalSpan) {
        const match = modalSpan.textContent.match(/Rodada\s+(\d+)/);
        if (match) return match[1];
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const match = node.textContent.match(/Rodada\s+(\d+)/);
        if (match) return match[1];
    }
    for (const iframe of document.querySelectorAll('iframe')) {
        try {
            if (!iframe.contentDocument) continue;
            const w = iframe.contentDocument.createTreeWalker(iframe.contentDocument.body, NodeFilter.SHOW_TEXT, null, false);
            let n;
            while ((n = w.nextNode())) {
                const m = n.textContent.match(/Rodada\s+(\d+)/);
                if (m) return m[1];
            }
        } catch(e) {}
    }
    const roundEl = document.querySelector('[class*="round" i], [data-round], game-round-id');
    if (roundEl) return roundEl.getAttribute('data-round') || roundEl.textContent.trim();
    return null;
}

function atualizarCacheRodada() {
    const r = extrairRodada();
    if (r) rodadaCache = r;
}
setInterval(atualizarCacheRodada, 300);
atualizarCacheRodada();

function formatarTimestamp(isoStr) {
    if (!isoStr) return null;
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    } catch (e) { return null; }
}

// ===== INTERCEPTACAO DO JOGO (main-world) - RODADA REAL =====
window.addEventListener('aviator-ws-data', (ev) => {
    try {
        const raw = typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail);
        let data = null;
        try { data = JSON.parse(raw); } catch(e) { return; }
        if (!data) return;
        
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
            if (item.type === 'crash' && item.crash_point && item.round_id) {
                const mult = parseFloat(item.crash_point);
                if (mult >= 1) {
                    const ts = new Date().toLocaleTimeString('pt-BR');
                    // Prioridade: usa round_id do proprio WebSocket do jogo
                    rodadaCache = String(item.round_id);
                    console.log(`🎯 JOGO: ${mult}x | round_id=${item.round_id}`);
                    enviarVela(mult, item.round_id, ts, "spribe");
                }
            }
        }
    } catch(e) {}
});

// ===== WEBSOCKET RELAY (fonte secundaria) =====
let ultimoEnvioWS = 0;

function conectarWS() {
    try {
        const ws = new WebSocket("wss://apiglobal.appbackend.tech/ws/signals/v2/aviator");
        ws.onopen = () => console.log("✅ WS conectado");
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.casa !== 'sortenabet') return;
                const mult = parseFloat(msg.data?.valor);
                if (isNaN(mult) || mult <= 0) return;
                const rodada = rodadaCache || extrairRodada() || `ws-${Date.now()}`;
                const timestamp = formatarTimestamp(msg.data.createdAt);
                console.log(`🎯 SINAL WS: ${mult}x rodada ${rodada}`);
                enviarVela(mult, rodada, timestamp, "ws-sortenabet");
                ultimoEnvioWS = Date.now();
            } catch (ex) {}
        };
        ws.onclose = () => { setTimeout(conectarWS, 5000); };
        ws.onerror = () => ws.close();
    } catch (e) { setTimeout(conectarWS, 5000); }
}
conectarWS();

// ===== DOM SCANNER (fallback) =====
let ultPayout = 0;
let maxPayoutRodada = 0;

setInterval(() => {
    if (Date.now() - ultimoEnvioWS <= 10000) return;
    const el = document.querySelector('.payout');
    if (!el) return;
    const m = el.textContent.match(/(\d+\.?\d*)x/);
    if (!m) return;
    const mult = parseFloat(m[1]);
    if (isNaN(mult)) return;
    if (ultPayout >= 1.01 && mult <= 1.01 && maxPayoutRodada >= 1.01) {
        const rodada = rodadaCache || extrairRodada() || `dom-${Date.now()}`;
        enviarVela(maxPayoutRodada, rodada, null, "dom");
        maxPayoutRodada = 0; // reseta para próxima rodada
    }
    if (mult > maxPayoutRodada) maxPayoutRodada = mult;
    ultPayout = mult;
}, 1000);
