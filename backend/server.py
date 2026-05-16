"""Servidor Flask + SSE para o Painel Aviator SaaS"""
import json
import csv
import io
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, request, redirect, url_for, session, Response, stream_with_context
from flask_cors import CORS
from data_collector import DataCollector
from database import init_db, criar_cliente, listar_clientes, get_cliente_por_id
from database import get_cliente_por_token, editar_cliente, toggle_bloqueio
from database import atualizar_online, get_estatisticas, exportar_relatorio
from auth import login_master, login_cliente, logout, master_required, cliente_required
import config
import os
import time

app = Flask(__name__,
    static_folder=os.path.join(os.path.dirname(__file__), 'static'),
    template_folder=os.path.join(os.path.dirname(__file__), 'templates')
)
app.config['SECRET_KEY'] = os.urandom(24).hex()
app.config['SESSION_PERMANENT'] = True
CORS(app, supports_credentials=True)

collector = DataCollector()

# Inicializa banco na importação
init_db()

# ===== SSE (Server-Sent Events) =====
ultimos_eventos = []
MAX_EVENTOS = 100

def notificar_clientes(evento, dados):
    """Adiciona evento à fila SSE"""
    global ultimos_eventos
    ultimos_eventos.append({"evento": evento, "dados": dados, "timestamp": time.time()})
    if len(ultimos_eventos) > MAX_EVENTOS:
        ultimos_eventos = ultimos_eventos[-MAX_EVENTOS:]

def on_nova_rodada(rodada):
    dados = rodada.to_dict()
    notificar_clientes('nova_rodada', dados)
    notificar_clientes('atualizar_ultimas', collector.get_ultimas(20))

collector.callback = on_nova_rodada

@app.route('/api/stream')
def stream_sse():
    """SSE endpoint - substitui WebSocket"""
    def gerar():
        ultimo_ts = time.time()
        # Envia estado inicial
        yield f"event: conectado\ndata: {json.dumps({'status': 'ok'})}\n\n"
        if collector.ultima_rodada:
            yield f"event: ultima_rodada\ndata: {json.dumps(collector.ultima_rodada.to_dict())}\n\n"
        if collector.penultima_rodada:
            yield f"event: penultima_rodada\ndata: {json.dumps(collector.penultima_rodada.to_dict())}\n\n"
        yield f"event: historico\ndata: {json.dumps(collector.get_ultimas(50))}\n\n"
        yield f"event: estatisticas\ndata: {json.dumps(collector.get_estatisticas())}\n\n"

        while True:
            # Verifica novos eventos
            novos = [e for e in ultimos_eventos if e['timestamp'] > ultimo_ts]
            for evento in novos:
                yield f"event: {evento['evento']}\ndata: {json.dumps(evento['dados'])}\n\n"
            if novos:
                ultimo_ts = max(e['timestamp'] for e in novos)
            # Keepalive a cada 10s
            yield f": keepalive\n\n"
            time.sleep(1)

    return Response(
        stream_with_context(gerar()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )

# ===== PÁGINAS PÚBLICAS =====
@app.route('/')
def home():
    if session.get('tipo') == 'master':
        return redirect('/admin')
    return redirect('/login')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        senha = request.form.get('senha')
        if login_master(email, senha):
            return redirect('/admin')
        return render_template('login.html', erro="Email ou senha inválidos")
    return render_template('login.html')

@app.route('/logout')
def fazer_logout():
    logout()
    return redirect('/login')

# ===== PAINEL MASTER (ADMIN) =====
@app.route('/admin')
@master_required
def admin_dashboard():
    stats = get_estatisticas()
    return render_template('admin/dashboard.html', stats=stats)

@app.route('/admin/clientes')
@master_required
def admin_clientes():
    clientes = listar_clientes()
    return render_template('admin/clientes.html', clientes=clientes)

@app.route('/admin/clientes/criar', methods=['POST'])
@master_required
def admin_criar_cliente():
    login = request.form.get('login')
    senha = request.form.get('senha')
    nome = request.form.get('nome', '')
    observacao = request.form.get('observacao', '')
    tempo = int(request.form.get('tempo_acesso', 0))
    resultado = criar_cliente(login, senha, nome, observacao, tempo)
    if resultado['ok']:
        return redirect('/admin/clientes')
    return render_template('admin/clientes.html', erro=resultado['erro'], clientes=listar_clientes())

@app.route('/admin/clientes/<int:id>/editar', methods=['POST'])
@master_required
def admin_editar_cliente(id):
    dados = {}
    for campo in ['login', 'nome', 'observacao']:
        val = request.form.get(campo)
        if val is not None:
            dados[campo] = val
    tempo = request.form.get('tempo_acesso')
    if tempo is not None:
        dados['tempo_acesso'] = int(tempo)
    senha = request.form.get('senha')
    if senha:
        dados['senha'] = senha
    editar_cliente(id, dados)
    return redirect('/admin/clientes')

@app.route('/admin/clientes/<int:id>/bloquear', methods=['POST'])
@master_required
def admin_bloquear_cliente(id):
    toggle_bloqueio(id)
    return redirect('/admin/clientes')

@app.route('/admin/clientes/<int:id>')
@master_required
def admin_detalhe_cliente(id):
    cliente = get_cliente_por_id(id)
    if not cliente:
        return redirect('/admin/clientes')
    return render_template('admin/cliente_detalhe.html', cliente=cliente)

@app.route('/admin/relatorios')
@master_required
def admin_relatorios():
    clientes = listar_clientes()
    return render_template('admin/relatorios.html', clientes=clientes)

@app.route('/admin/relatorios/exportar')
@master_required
def admin_exportar_csv():
    dados = exportar_relatorio()
    output = io.StringIO()
    if dados:
        writer = csv.DictWriter(output, fieldnames=dados[0].keys())
        writer.writeheader()
        writer.writerows(dados)
    csv_content = output.getvalue()
    output.close()
    return Response(
        csv_content,
        mimetype='text/csv',
        headers={"Content-disposition": "attachment; filename=relatorio_clientes.csv"}
    )

# ===== PAINEL DO CLIENTE =====
@app.route('/painel/<token>')
def cliente_login(token):
    cliente = get_cliente_por_token(token)
    if not cliente:
        return "Link inválido", 404
    if session.get('tipo') == 'cliente' and session.get('cliente_token') == token:
        return redirect(f'/painel/{token}/dash')
    return render_template('cliente/login.html', token=token, erro=None)

@app.route('/painel/<token>/entrar', methods=['POST'])
def cliente_autenticar(token):
    cliente = get_cliente_por_token(token)
    if not cliente:
        return "Link inválido", 404
    login = request.form.get('login')
    senha = request.form.get('senha')
    sucesso, erro = login_cliente(login, senha)
    if sucesso:
        return redirect(f'/painel/{token}/dash')
    return render_template('cliente/login.html', token=token, erro=erro)

@app.route('/painel/<token>/dash')
@cliente_required
def cliente_dashboard(token):
    cliente = get_cliente_por_token(token)
    if not cliente:
        return redirect('/login')
    return render_template('cliente/painel.html', cliente=cliente)

@app.route('/painel/<token>/sair')
def cliente_sair(token):
    logout()
    return redirect(f'/painel/{token}')

# ===== API =====
@app.route('/api/ultimas/<int:n>')
def api_ultimas(n):
    return jsonify(collector.get_ultimas(n))

@app.route('/api/ultimas')
def api_ultimas_default():
    return jsonify(collector.get_ultimas(50))

@app.route('/api/historico')
def api_historico():
    return jsonify(collector.get_todas())

@app.route('/api/historico/<cor>')
def api_historico_por_cor(cor):
    cor = cor.lower()
    if cor not in ['azul', 'roxa', 'rosa']:
        return jsonify({"erro": "Cor inválida. Use: azul, roxa, rosa"}), 400
    return jsonify(collector.get_por_cor(cor))

@app.route('/api/estatisticas')
def api_estatisticas():
    return jsonify(collector.get_estatisticas())

@app.route('/api/ultima')
def api_ultima():
    if collector.ultima_rodada:
        return jsonify(collector.ultima_rodada.to_dict())
    return jsonify({"erro": "Nenhuma rodada ainda"}), 404

@app.route('/api/penultima')
def api_penultima():
    if collector.penultima_rodada:
        return jsonify(collector.penultima_rodada.to_dict())
    return jsonify({"erro": "Nenhuma rodada ainda"}), 404

@app.route('/status')
def status_page():
    return render_template('status.html')


if __name__ == '__main__':
    from waitress import serve
    print(f"[INICIANDO] Painel Aviator SaaS - Porta {config.PORT}")
    print(f"[MODO] {'Simulado' if config.SIMULAR_DADOS else 'Real (Sorte da Bet)'}")
    collector.iniciar()
    print(f"[OK] Servidor rodando em http://{config.HOST}:{config.PORT}")
    serve(app, host=config.HOST, port=config.PORT)
