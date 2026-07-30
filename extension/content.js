// MARKIN CAPTURADOR - Relay externo + DOM scanner
const API_URL = "https://painel-aviator.onrender.com/api/nova-vela";

function detectarCasa() {
    // Usa SEMPRE o dominio da pagina principal (ignora iframes do jogo)
    let host;
    try { host = window.top.location.hostname.replace('www.',''); } catch(e) {
        host = window.location.hostname.replace('www.','');
    }
    // Ignora dominios internos do Spribe
    if (host.includes('spribegaming') || host.includes('cloudfront') || host === 'secure' || host === 'sst' || host === 'aviator-next') {
        return null; // nao envia de iframes do jogo
    }
    const mapa = {
        'sortenabet.bet.br': 'SorteNaBet',
        'betou.bet.br': 'Betou',
        'pixreals.com': 'PixReals',
        'bravo.bet.br': 'BravoBet',
        'betao.bet.br': 'Betao',
        'apostamax.bet.br': 'ApostaMax',
        'sebet67.com': 'Sebet',
        'vera.bet.br': 'Vera',
    };
    const nome = mapa[host] || (host.split('.')[0]);
    const aviador = detectarAviator();
    return nome + ' Aviator ' + aviador;
}

function detectarAviator() {
    return window.location.href.includes('aviator2') ? 2 : 1;
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
    if (!casa) return; // ignora iframes do jogo Spribe

    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            painel, multiplicador: multNum,
            rodada: String(rodada), timestamp: horario,
            soma: 0, fonte: casa
        })
    }).then(r => r.json()).then(d => {
        if (d.ok) console.log('✅ [' + casa + ' AVIATOR ' + painel + '] ' + multNum + 'x rodada ' + rodada);
    }).catch(() => {});
}

// ===== EXTRAIR RODADA DO DOM =====
function extrairRodada() {
    // 1. app-fairness modal
    const modalSpan = document.querySelector('app-fairness span.text-uppercase');
    if (modalSpan) {
        const match = modalSpan.textContent.match(/Rodada\s+(\d+)/i);
        if (match) return match[1];
    }
    // 2. TreeWalker
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        const match = node.textContent.match(/Rodada\s+(\d+)/i);
        if (match) return match[1];
    }
    // 3. iframes
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
    return null;
}

let rodadaCache = null;
setInterval(() => {
    const r = extrairRodada();
    if (r) rodadaCache = r;
}, 300);

// ===== RELAY EXTERNO (fonte principal) =====
function conectarWS() {
    try {
        const ws = new WebSocket("wss://apiglobal.appbackend.tech/ws/signals/v2/aviator");
        ws.onopen = () => {
            if (!detectarCasa()) return; // nao conecta em iframes
            console.log("📡 Relay conectado - casa: " + detectarCasa());
        };
        ws.onmessage = (e) => {
            try {
                if (!detectarCasa()) return; // ignora iframes
                const msg = JSON.parse(e.data);
                if (msg.type === "connected") { console.log("📡 " + msg.message); return; }
                if (msg.type !== "signal") return;
                
                const mult = parseFloat(msg.data?.valor);
                if (isNaN(mult) || mult < 1) return;
                
                // Rodada: prefere DOM, fallback timestamp do relay, ultimo fallback timestamp local
                let rodada = rodadaCache || extrairRodada();
                if (!rodada && msg.data?.createdAt) {
                    rodada = msg.data.createdAt.replace(/\D/g,'').slice(0,14); // 20260729213714
                }
                if (!rodada) rodada = String(Date.now());
                const ts = msg.data?.createdAt
                    ? new Date(msg.data.createdAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false })
                    : new Date().toLocaleTimeString('pt-BR');
                
                console.log('🎯 SINAL: ' + mult + 'x | rodada=' + rodada);
                enviarVela(mult, rodada, ts, "relay");
            } catch(ex) {}
        };
        ws.onclose = () => { console.log("⚠ Relay fechado, reconectando..."); setTimeout(conectarWS, 5000); };
        ws.onerror = () => {};
    } catch(e) { setTimeout(conectarWS, 5000); }
}
conectarWS();

// ===== DOM SCANNER (fallback) =====
let ultPayout = 0, maxPayoutRodada = 0;
setInterval(() => {
    // Tenta varios seletores do Spribe
    const el = document.querySelector('.payout, .bubble-multiplier, [class*="multiplier"], [class*="payout"]');
    if (!el) return;
    const m = el.textContent.match(/(\d+\.?\d*)x/);
    if (!m) return;
    const mult = parseFloat(m[1]);
    if (isNaN(mult)) return;
    
    // Detecta fim da rodada: payout caiu pra 1.00x
    if (ultPayout >= 1.01 && mult <= 1.01 && maxPayoutRodada >= 1.01) {
        const rodada = rodadaCache || extrairRodada() || `dom-${Date.now()}`;
        console.log('🎯 DOM: ' + maxPayoutRodada + 'x rodada=' + rodada);
        enviarVela(maxPayoutRodada, rodada, null, "dom");
        maxPayoutRodada = 0;
    }
    if (mult > maxPayoutRodada) maxPayoutRodada = mult;
    ultPayout = mult;
}, 1000);
