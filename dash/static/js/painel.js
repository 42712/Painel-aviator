// Conexão SSE para tempo real
let source = null;

function conectarSSE() {
    if (source) source.close();
    
    source = new EventSource('/api/stream');
    
    source.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        if (data.tipo === 'nova_rodada' && data.rodada) {
            // Nova vela chegou!
            atualizarVela(data.rodada);
            carregarHistorico();
            document.getElementById('status').innerHTML = '🟢 Atualizado em tempo real';
            document.getElementById('status').className = 'status';
        }
    };
    
    source.onerror = function() {
        document.getElementById('status').innerHTML = '🔴 Reconectando...';
        document.getElementById('status').className = 'status offline';
        setTimeout(conectarSSE, 3000);
    };
}

function getCorMultiplicador(valor) {
    const num = parseFloat(valor);
    if (num < 2) return '#888';
    if (num < 5) return '#4CAF50';
    if (num < 10) return '#2196F3';
    if (num < 20) return '#FF9800';
    return '#f44336';
}

function atualizarVela(rodada) {
    const container = document.getElementById('velaContainer');
    const multEl = document.getElementById('multiplicador');
    const rodadaEl = document.getElementById('rodadaId');
    const horarioEl = document.getElementById('horario');
    const somaEl = document.getElementById('soma');
    
    if (multEl) {
        multEl.textContent = `${rodada.multiplicador}x`;
        multEl.style.color = getCorMultiplicador(rodada.multiplicador);
    }
    if (rodadaEl) rodadaEl.textContent = `#${rodada.rodada_id}`;
    if (horarioEl) horarioEl.textContent = rodada.horario;
    if (somaEl) somaEl.textContent = rodada.soma;
    
    // Animação
    container.classList.add('nova');
    setTimeout(() => container.classList.remove('nova'), 300);
}

function carregarHistorico() {
    const uuid = window.location.pathname.split('/')[2];
    fetch(`/api/historico/${uuid}`)
        .then(res => res.json())
        .then(rodadas => {
            const container = document.getElementById('historico');
            if (!rodadas || rodadas.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:#666;">Nenhuma rodada ainda</div>';
                return;
            }
            container.innerHTML = rodadas.map(r => `
                <div class="historico-item">
                    <span class="historico-multiplicador" style="color: ${getCorMultiplicador(r.multiplicador)}">${r.multiplicador}x</span>
                    <span class="historico-rodada">#${r.rodada_id}</span>
                    <span class="historico-horario">${r.horario}</span>
                    <span class="historico-soma">Soma: ${r.soma}</span>
                </div>
            `).join('');
            
            if (rodadas.length > 0) atualizarVela(rodadas[0]);
        });
}

// Iniciar quando página carregar
document.addEventListener('DOMContentLoaded', () => {
    carregarHistorico();
    conectarSSE();
});
