"""Servidor Flask + SSE para o Painel Aviator SaaS"""
import json
import csv
import io
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, request, redirect, url_for, session, Response, stream_with_context
from flask_cors import CORS
from data_collector import DataCollector
from database import init_db, criar_cliente, listar_clientes, get_cliente_por_id
from database import get_cliente_por_token, get_cliente_por_slug, editar_cliente, toggle_bloqueio, atualizar_slug
from database import atualizar_online, get_estatisticas, exportar_relatorio, excluir_cliente_db
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

collector1 = DataCollector()
collector2 = DataCollector()

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

def on_nova_rodada_1(rodada):
    dados = rodada.to_dict()
    notificar_clientes('nova_rodada_1', dados)
    notificar_clientes('atualizar_ultimas_1', collector1.get_ultimas(20))

def on_nova_rodada_2(rodada):
    dados = rodada.to_dict()
    notificar_clientes('nova_rodada_2', dados)
    notificar_clientes('atualizar_ultimas_2', collector2.get_ultimas(20))

collector1.callback = on_nova_rodada_1
collector2.callback = on_nova_rodada_2

@app.route('/api/stream')
def stream_sse():
    """SSE endpoint - substitui WebSocket"""
    def gerar():
        ultimo_ts = time.time()
        # Envia estado inicial
        yield f"event: conectado\ndata: {json.dumps({'status': 'ok'})}\n\n"
        # Aviator 1
        if collector1.ultima_rodada:
            yield f"event: ultima_rodada_1\ndata: {json.dumps(collector1.ultima_rodada.to_dict())}\n\n"
        if collector1.penultima_rodada:
            yield f"event: penultima_rodada_1\ndata: {json.dumps(collector1.penultima_rodada.to_dict())}\n\n"
        yield f"event: historico_1\ndata: {json.dumps(collector1.get_ultimas(50))}\n\n"
        yield f"event: estatisticas_1\ndata: {json.dumps(collector1.get_estatisticas())}\n\n"
        # Aviator 2
        if collector2.ultima_rodada:
            yield f"event: ultima_rodada_2\ndata: {json.dumps(collector2.ultima_rodada.to_dict())}\n\n"
        if collector2.penultima_rodada:
            yield f"event: penultima_rodada_2\ndata: {json.dumps(collector2.penultima_rodada.to_dict())}\n\n"
        yield f"event: historico_2\ndata: {json.dumps(collector2.get_ultimas(50))}\n\n"
        yield f"event: estatisticas_2\ndata: {json.dumps(collector2.get_estatisticas())}\n\n"
        yield f"event: extensao_status\ndata: {json.dumps({'conectada': EXTENSAO_CONECTADA and (time.time() - ultimo_heartbeat) < 60, 'total_rodadas': len(collector1.historico) + len(collector2.historico)})}\n\n"

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

# ===== WEBHOOK - RECEBE DADOS DA EXTENSÃO =====
ultimo_heartbeat = 0
EXTENSAO_CONECTADA = False

@app.route('/api/webhook', methods=['POST'])
def api_webhook():
    """Recebe dados da extensão do Kiwi Browser"""
    global ultimo_heartbeat, EXTENSAO_CONECTADA
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({"erro": "Dados inválidos"}), 400

        # Heartbeat
        if dados.get('heartbeat'):
            EXTENSAO_CONECTADA = True
            ultimo_heartbeat = time.time()
            return jsonify({"ok": True, "status": "heartbeat_recebido"})

        # Processa rodadas recebidas - roteia para aviator 1 ou 2
        rodadas = dados.get('rodadas', [])
        aviador = dados.get('aviator', 1)
        collector = collector1 if aviador == 1 else collector2
        fonte = dados.get('fonte', 'desconhecida')
        EXTENSAO_CONECTADA = True
        ultimo_heartbeat = time.time()

        for r in rodadas:
            rodada_id = r.get('rodada') or r.get('id') or r.get('round') or int(time.time() * 1000)
            mult = r.get('mult') or r.get('multiplicador') or r.get('multiplier') or r.get('value')
            if mult:
                from models import Rodada
                rodada_obj = Rodada(int(rodada_id) if isinstance(rodada_id, (int, float)) else hash(str(rodada_id)) % 10000000, float(mult))
                collector._adicionar_rodada(rodada_obj)

        return jsonify({
            "ok": True,
            "rodadas_recebidas": len(rodadas),
            "aviator": aviador,
            "status": "extensao_conectada"
        })
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

@app.route('/api/webhook/status')
def api_webhook_status():
    """Status da conexão com a extensão"""
    agora = time.time()
    conectada = EXTENSAO_CONECTADA and (agora - ultimo_heartbeat) < 60
    return jsonify({
        "conectada": conectada,
        "ultimo_heartbeat": ultimo_heartbeat,
        "segundos_sem_sinal": int(agora - ultimo_heartbeat) if ultimo_heartbeat else 9999,
        "total_rodadas": len(collector1.historico) + len(collector2.historico),
        "aviator1_rodadas": len(collector1.historico),
        "aviator2_rodadas": len(collector2.historico)
    })

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
    slug = request.form.get('slug', '').strip() or None
    resultado = criar_cliente(login, senha, nome, observacao, tempo, slug)
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

@app.route('/admin/clientes/<int:id>/slug', methods=['POST'])
@master_required
def admin_alterar_slug(id):
    slug = request.form.get('slug', '').strip()
    if not slug:
        slug = None
    resultado = atualizar_slug(id, slug)
    if not resultado['ok']:
        return render_template('admin/clientes.html', erro=resultado['erro'], clientes=listar_clientes())
    return redirect('/admin/clientes')

@app.route('/admin/clientes/<int:id>/excluir', methods=['POST'])
@master_required
def admin_excluir_cliente(id):
    if excluir_cliente_db(id):
        flash('Cliente excluído com sucesso!', 'success')
    else:
        flash('Erro ao excluir cliente.', 'error')
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
@app.route('/painel/<slug>')
def cliente_login(slug):
    # Tenta buscar por slug primeiro, fallback para token
    cliente = get_cliente_por_slug(slug)
    if not cliente:
        cliente = get_cliente_por_token(slug)
    if not cliente:
        return "Link inválido", 404
    token = cliente['token']
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
def _get_collector(n):
    return collector1 if n == 1 else collector2

@app.route('/api/<int:aviator>/ultimas/<int:n>')
def api_ultimas_n(aviator, n):
    return jsonify(_get_collector(aviator).get_ultimas(n))

@app.route('/api/ultimas/<int:n>')
def api_ultimas(n):
    return jsonify(collector1.get_ultimas(n))

@app.route('/api/ultimas')
def api_ultimas_default():
    return jsonify({"aviator1": collector1.get_ultimas(50), "aviator2": collector2.get_ultimas(50)})

@app.route('/api/<int:aviator>/ultimas')
def api_ultimas_aviator(aviator):
    return jsonify(_get_collector(aviator).get_ultimas(50))

@app.route('/api/historico')
def api_historico():
    return jsonify({"aviator1": collector1.get_todas(), "aviator2": collector2.get_todas()})

@app.route('/api/<int:aviator>/historico')
def api_historico_aviator(aviator):
    return jsonify(_get_collector(aviator).get_todas())

@app.route('/api/<int:aviator>/historico/<cor>')
def api_historico_por_cor(aviator, cor):
    cor = cor.lower()
    if cor not in ['azul', 'roxa', 'rosa']:
        return jsonify({"erro": "Cor inválida. Use: azul, roxa, rosa"}), 400
    return jsonify(_get_collector(aviator).get_por_cor(cor))

@app.route('/api/<int:aviator>/estatisticas')
def api_estatisticas_aviator(aviator):
    return jsonify(_get_collector(aviator).get_estatisticas())

@app.route('/api/estatisticas')
def api_estatisticas():
    return jsonify({"aviator1": collector1.get_estatisticas(), "aviator2": collector2.get_estatisticas()})

@app.route('/api/<int:aviator>/ultima')
def api_ultima_aviator(aviator):
    c = _get_collector(aviator)
    if c.ultima_rodada:
        return jsonify(c.ultima_rodada.to_dict())
    return jsonify({"erro": "Nenhuma rodada ainda"}), 404

@app.route('/api/ultima')
def api_ultima():
    return jsonify({
        "aviator1": collector1.ultima_rodada.to_dict() if collector1.ultima_rodada else None,
        "aviator2": collector2.ultima_rodada.to_dict() if collector2.ultima_rodada else None
    })

@app.route('/api/<int:aviator>/penultima')
def api_penultima_aviator(aviator):
    c = _get_collector(aviator)
    if c.penultima_rodada:
        return jsonify(c.penultima_rodada.to_dict())
    return jsonify({"erro": "Nenhuma rodada ainda"}), 404

@app.route('/api/penultima')
def api_penultima():
    return jsonify({
        "aviator1": collector1.penultima_rodada.to_dict() if collector1.penultima_rodada else None,
        "aviator2": collector2.penultima_rodada.to_dict() if collector2.penultima_rodada else None
    })

@app.route('/api/<int:aviator>/minutagem')
def api_minutagem_aviator(aviator):
    """Estatísticas agrupadas por minuto"""
    c = _get_collector(aviator)
    from collections import defaultdict
    minutos = defaultdict(lambda: {"qtd": 0, "total": 0.0, "max": 0, "azul": 0, "roxa": 0, "rosa": 0})
    for r in c.historico:
        ts = r.timestamp or "00:00"
        if ":" not in ts:
            continue
        minuto = ts[:5]  # HH:MM
        m = minutos[minuto]
        m["qtd"] += 1
        m["total"] += r.multiplicador
        m["max"] = max(m["max"], r.multiplicador)
        m[r.cor] = m.get(r.cor, 0) + 1
    resultado = []
    for minuto, dados in sorted(minutos.items(), reverse=True)[:60]:
        resultado.append({
            "minuto": minuto,
            "qtd": dados["qtd"],
            "media": round(dados["total"] / dados["qtd"], 2) if dados["qtd"] > 0 else 0,
            "max": round(dados["max"], 2),
            "azul": dados["azul"],
            "roxa": dados["roxa"],
            "rosa": dados["rosa"]
        })
    return jsonify(resultado)

@app.route('/status')
def status_page():
    return render_template('status.html')


if __name__ == '__main__':
    from waitress import serve
    print(f"[INICIANDO] Painel Aviator SaaS - Porta {config.PORT}")
    print(f"[MODO] {'Simulado' if config.SIMULAR_DADOS else 'Real (Sorte da Bet)'}")
    collector1.iniciar()
    collector2.iniciar()
    print(f"[OK] Servidor rodando em http://{config.HOST}:{config.PORT}")
    print(f"[OK] Aviator 1 + Aviator 2 ativos")
    serve(app, host=config.HOST, port=config.PORT)
