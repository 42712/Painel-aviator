import json
import asyncio
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
from datetime import datetime
from models import db, MultiplicadorRodada
from data_collector import coletar_historico, coletar_ultimo_multiplicador
import threading

app = Flask(__name__, template_folder='../dash', static_folder='../dash/static')
CORS(app)

# Config DB
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///rodadas.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

# Cache para SSE
ultima_rodada = None
lista_rodadas = []
clientes_conectados = []

def get_numeros_por_extenso():
    return ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']

def calcular_soma_multiplicador(valor):
    try:
        num = float(valor)
        inteiro = int(num)
        soma = sum(int(d) for d in str(inteiro) if d.isdigit())
        return soma
    except:
        return 0

def formatar_vela_completa(multiplicador, rodada_id, horario):
    soma = calcular_soma_multiplicador(multiplicador)
    return f"{multiplicador}x | {rodada_id} | {horario} | Soma: {soma}"

@app.route('/painel/<uuid>')
def dashboard(uuid):
    return render_template('index.html', uuid=uuid)

@app.route('/api/ultima-rodada/<uuid>')
def api_ultima_rodada(uuid):
    rodada = MultiplicadorRodada.query.order_by(MultiplicadorRodada.id.desc()).first()
    if rodada:
        return jsonify({
            'multiplicador': rodada.multiplicador,
            'rodada_id': rodada.rodada_id,
            'horario': rodada.horario.strftime('%H:%M:%S') if rodada.horario else datetime.now().strftime('%H:%M:%S'),
            'vela_completa': formatar_vela_completa(rodada.multiplicador, rodada.rodada_id, rodada.horario.strftime('%H:%M:%S') if rodada.horario else '--:--:--'),
            'soma': calcular_soma_multiplicador(rodada.multiplicador)
        })
    return jsonify({'multiplicador': None})

@app.route('/api/historico/<uuid>')
def api_historico(uuid):
    rodadas = MultiplicadorRodada.query.order_by(MultiplicadorRodada.id.desc()).limit(50).all()
    historico = []
    for r in rodadas:
        historico.append({
            'multiplicador': r.multiplicador,
            'rodada_id': r.rodada_id,
            'horario': r.horario.strftime('%H:%M:%S') if r.horario else '--:--:--',
            'vela_completa': formatar_vela_completa(r.multiplicador, r.rodada_id, r.horario.strftime('%H:%M:%S') if r.horario else '--:--:--'),
            'soma': calcular_soma_multiplicador(r.multiplicador)
        })
    return jsonify(historico)

@app.route('/api/webhook', methods=['POST'])
def webhook():
    global ultima_rodada, lista_rodadas
    data = request.json
    print(f"📥 Webhook recebido: {data}")
    
    try:
        multiplicador = data.get('multiplicador') or data.get('payout') or data.get('valor')
        rodada_id = data.get('rodada_id') or data.get('rodada') or data.get('id')
        
        if multiplicador and rodada_id:
            # Salvar no banco
            nova = MultiplicadorRodada(
                multiplicador=str(multiplicador).replace('x', ''),
                rodada_id=rodada_id,
                horario=datetime.now()
            )
            db.session.add(nova)
            db.session.commit()
            
            # Atualizar cache
            vela_completa = formatar_vela_completa(multiplicador, rodada_id, datetime.now().strftime('%H:%M:%S'))
            nova_rodada = {
                'multiplicador': str(multiplicador).replace('x', ''),
                'rodada_id': rodada_id,
                'horario': datetime.now().strftime('%H:%M:%S'),
                'vela_completa': vela_completa,
                'soma': calcular_soma_multiplicador(multiplicador)
            }
            
            # Atualizar lista
            lista_rodadas.insert(0, nova_rodada)
            if len(lista_rodadas) > 50:
                lista_rodadas.pop()
            
            ultima_rodada = nova_rodada
            
            # Notificar todos os clientes SSE
            notificar_clientes(nova_rodada)
            
            return jsonify({'status': 'ok', 'rodada': rodada_id}), 200
    except Exception as e:
        print(f"Erro: {e}")
        db.session.rollback()
    
    return jsonify({'status': 'ok'}), 200

def notificar_clientes(rodada):
    """Envia nova rodada para todos clientes SSE conectados"""
    dados = json.dumps({
        'tipo': 'nova_rodada',
        'rodada': rodada
    })
    for cliente in clientes_conectados[:]:  # Copia para iterar
        try:
            cliente.put(f"data: {dados}\n\n")
        except:
            if cliente in clientes_conectados:
                clientes_conectados.remove(cliente)

@app.route('/api/stream')
def stream():
    """SSE corrigido - usa queue para cada cliente"""
    from queue import Queue
    minha_queue = Queue()
    clientes_conectados.append(minha_queue)
    
    def gerar():
        try:
            # Envia histórico inicial
            yield f"data: {json.dumps({'tipo': 'conectado', 'mensagem': 'Stream conectado'})}\n\n"
            
            # Envia última rodada se existir
            if ultima_rodada:
                yield f"data: {json.dumps({'tipo': 'nova_rodada', 'rodada': ultima_rodada})}\n\n"
            
            # Loop de eventos
            while True:
                # Aguarda até 30 segundos por nova rodada
                try:
                    dados = minha_queue.get(timeout=30)
                    yield dados
                except:
                    # Keep-alive
                    yield f"data: {json.dumps({'tipo': 'ping'})}\n\n"
        except GeneratorExit:
            if minha_queue in clientes_conectados:
                clientes_conectados.remove(minha_queue)
    
    return Response(gerar(), mimetype="text/event-stream", headers={
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',  # Desabilita buffer no Nginx
        'Access-Control-Allow-Origin': '*'
    })

# Inicializar
with app.app_context():
    db.create_all()
    # Carregar dados existentes
    rodadas_db = MultiplicadorRodada.query.order_by(MultiplicadorRodada.id.desc()).limit(50).all()
    lista_rodadas = []
    for r in rodadas_db:
        lista_rodadas.append({
            'multiplicador': r.multiplicador,
            'rodada_id': r.rodada_id,
            'horario': r.horario.strftime('%H:%M:%S') if r.horario else '--:--:--',
            'vela_completa': formatar_vela_completa(r.multiplicador, r.rodada_id, r.horario.strftime('%H:%M:%S') if r.horario else '--:--:--'),
            'soma': calcular_soma_multiplicador(r.multiplicador)
        })
    if lista_rodadas:
        ultima_rodada = lista_rodadas[0]

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
