// MARKIN CAPTURADOR - Intercepta WebSocket do jogo + relay + DOM
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
    return mapa[host] || (host.split('.')[0]);
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

const enviadas = new Set();

function enviarVela(mult, rodada, timestamp, origem) {
    const multNum = parseFloat(mult);
    if (isNaN(multNum) || multNum <= 0) return;
    const painel = detectarAviator();
    const chave = painel + '_' + rodada;
    if (enviadas.has(chave)) return;
    enviadas.add(chave);

    const horario = timestamp || new Date().toLocaleTimeString('pt-BR');
    const casa = detectarCasa();

    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            painel, multiplicador: multNum,
            rodada: String(rodada), timestamp: horario,
            soma: calcularSoma(multNum), fonte: origem ? (origem + '|' + casa) : casa
        })
    }).then(r => r.json()).then(d => {
        if (d.ok) console.log('✅ [' + casa + ' AVIATOR ' + painel + '] ' + multNum + 'x rodada ' + rodada);
    }).catch(() => {});
}

// ===== FONTE 1: INTERCEPTACAO DO JOGO (main-world) - RODADA REAL =====
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
                    enviarVela(mult, item.round_id, ts, "spribe");
                }
            }
        }
    } catch(e) {}
});

// ===== FONTE 2: RELAY EXTERNO (fallback) =====
function conectarWS() {
    try {
        const ws = new WebSocket("wss://apiglobal.appbackend.tech/ws/signals/v2/aviator");
        ws.onopen = () => console.log("📡 Relay conectado");
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type !== "signal") return;
                const mult = parseFloat(msg.data?.valor);
                if (isNaN(mult) || mult < 1) return;
                const rodada = `r-${Date.now()}`;
                const ts = msg.data?.createdAt
                    ? new Date(msg.data.createdAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false })
                    : new Date().toLocaleTimeString('pt-BR');
                enviarVela(mult, rodada, ts, "relay");
            } catch(ex) {}
        };
        ws.onclose = () => setTimeout(conectarWS, 5000);
        ws.onerror = () => {};
    } catch(e) { setTimeout(conectarWS, 5000); }
}
conectarWS();

// ===== FONTE 3: DOM SCANNER (ultimo fallback) =====
let ultPayout = 0, maxPayoutRodada = 0;
setInterval(() => {
    const el = document.querySelector('.payout, .bubble-multiplier, [class*="multiplier"], [class*="payout"]');
    if (!el) return;
    const m = el.textContent.match(/(\d+\.?\d*)x/);
    if (!m) return;
    const mult = parseFloat(m[1]);
    if (isNaN(mult)) return;
    if (ultPayout >= 1.01 && mult <= 1.01 && maxPayoutRodada >= 1.01) {
        enviarVela(maxPayoutRodada, `dom-${Date.now()}`, null, "dom");
        maxPayoutRodada = 0;
    }
    if (mult > maxPayoutRodada) maxPayoutRodada = mult;
    ultPayout = mult;
}, 1000);
