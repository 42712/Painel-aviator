// COLE NO CONSOLE F12 - NAO DERRUBA O JOGO
(function(){
  const API = "https://painel-aviator.onrender.com/api/nova-vela";
  const casa = window.location.hostname.replace('www.','').split('.')[0];
  const enviadas = new Set();
  if(window.__capturadorAtivo) return console.log('⚠ Ja ativo');
  window.__capturadorAtivo = true;
  
  console.log('🚀 Capturador ativo - casa: '+casa);

  function enviar(mult, rodada, ts) {
    const chave = rodada+'_'+mult;
    if(enviadas.has(chave)) return;
    enviadas.add(chave);
    fetch(API, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({multiplicador:mult, rodada:String(rodada), timestamp:ts, fonte:casa})
    }).then(r=>r.json()).then(d=>{
      if(d.ok) console.log('✅ '+casa+': '+mult+'x rodada '+rodada);
    }).catch(()=>{});
  }

  const NativeWS = window.WebSocket;
  window.WebSocket = new Proxy(NativeWS, {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener('message', e => {
        try {
          const data = JSON.parse(e.data);
          const items = Array.isArray(data)?data:[data];
          for(const item of items){
            if(item.type==='crash' && item.crash_point && item.round_id){
              const mult = parseFloat(item.crash_point);
              if(mult>=1){
                const ts = new Date().toLocaleTimeString('pt-BR');
                enviar(mult, item.round_id, ts);
              }
            }
          }
        }catch(ex){}
      });
      return ws;
    }
  });
  console.log('✅ Interceptando WebSocket...');
})();
