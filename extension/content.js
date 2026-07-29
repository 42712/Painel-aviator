// MARKIN CAPTURADOR - Qualquer casa Aviator
const API_URL = "https://painel-aviator.onrender.com/api/nova-vela";

function detectarCasa() {
    const host = window.location.hostname.replace('www.','');
    const mapa = {
        'sortenabet.bet.br': 'SorteNaBet',
        'betou.bet.br': 'Betou',
        'pixreals.com': 'PixReals',
        'bravo.bet.br': 'BravoBet',
        'betao.bet.br': 'Betao',
        'apostamax.bet.br': 'ApostaMax',
        'sebet67.com': 'Sebet',
        'vera.bet.br': 'Vera',
        'iaeagle.pro': 'PixReals',
    };
    return mapa[host] || ('Casa: '+host.split('.')[0]);
}

function detectarAviator() {
    return window.location.href.includes('aviator2') ? 2 : 1;
}

function calcularSoma(mult) {
    const str = mult.toFixed(2).replace('.', '');
    let soma = 0;
    for (let i = 0; i < str.length && i < 3; i++) soma += parseInt(str[i]) || 0;
    return soma;
}

// Dedup global: uma vela por (painel + rodada)
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
            soma: calcularSoma(multNum), fonte: detectarCasa()
        })
    }).then(r => r.json()).then(d => {
        if (d.ok) console.log(`✅ [AVIATOR ${painel}] ${multNum}x rodada ${rodada}`);
    }).catch(() => {});
}

// Cache de rodada: atualizado a cada 300ms para capturar antes do WS chegar
let rodadaCache = null;

function extrairRodada() {
    // 1. Span do fairness modal
    const modalSpan = document.querySelector('app-fairness span.text-uppercase');
    if (modalSpan) {
        const match = modalSpan.textContent.match(/Rodada\s+(\d+)/);
        if (match) return match[1];
    }
    // 2. TreeWalker no documento principal
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const match = node.textContent.match(/Rodada\s+(\d+)/);
        if (match) return match[1];
    }
    // 3. Tenta dentro de iframes (o jogo pode estar num iframe)
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
    // 4. Seletores genericos
    const roundEl = document.querySelector('[class*="round" i], [data-round], game-round-id');
    if (roundEl) return roundEl.getAttribute('data-round') || roundEl.textContent.trim();
    return null;
}

// Polling constante pra manter rodadaCache atualizado
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
    } catch (e) {
        return null;
    }
}

// ===== WEBSOCKET (fonte principal) =====
let ultimoEnvioWS = 0;

function conectarWS() {
    console.log("📡 Usando interceptacao do jogo (main-world)...");
}
conectarWS();

// ===== ESCUTA DADOS DO JOGO VIA MAIN-WORLD =====
window.addEventListener('aviator-ws-data', (ev) => {
    try {
        const raw = typeof ev.detail === 'string' ? ev.detail : JSON.stringify(ev.detail);
        // Procura crash_point no JSON da mensagem
        let data = null;
        try { data = JSON.parse(raw); } catch(e) {}
        
        if (data) {
            // Formato Spribe: array de eventos
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item.type === 'crash' && item.crash_point && item.round_id) {
                    const mult = parseFloat(item.crash_point);
                    if (mult >= 1) {
                        const casa = detectarCasa();
                        const ts = new Date().toLocaleTimeString('pt-BR');
                        console.log(`🎯 CRASH: ${mult}x | round=${item.round_id} | casa=${casa}`);
                        enviarVela(mult, item.round_id, ts, casa);
                    }
                }
            }
        }
    } catch(e) {}
});

// ===== FALLBACK: DOM SCANNER =====
let ultPayout = 0;
let maxPayoutRodada = 0;

setInterval(() => {
    const el = document.querySelector('.payout, .bubble-multiplier, [class*="multiplier"], [class*="payout"]');
    if (!el) return;
    const m = el.textContent.match(/(\d+\.?\d*)x/);
    if (!m) return;

    const mult = parseFloat(m[1]);
    if (isNaN(mult)) return;

    if (ultPayout >= 1.01 && mult <= 1.01 && maxPayoutRodada >= 1.01) {
        const rodada = rodadaCache || extrairRodada() || `dom-${Date.now()}`;
        console.log(`🎯 DOM: ${maxPayoutRodada}x rodada=${rodada}`);
        enviarVela(maxPayoutRodada, rodada, null, detectarCasa());
    }
    if (mult > maxPayoutRodada) maxPayoutRodada = mult;
    ultPayout = mult;
}, 1000);
