import os
import secrets
import datetime
from functools import wraps
from flask import Flask, request, jsonify, session, redirect, url_for, render_template, g, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_db, init_db, close_db
import random
import urllib.request
import urllib.error
import urllib.parse
import http.cookiejar
import json
import threading
import time

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['SESSION_COOKIE_SECURE'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.permanent_session_lifetime = datetime.timedelta(days=30)

# ============ LIVE PROXY ============
LIVE_SITE = os.environ.get("LIVE_SITE", "https://aviatorpaineldojhow.com.br")
LIVE_USER = os.environ.get("LIVE_USER", "mark_kus_1@hotmail.com")
LIVE_PASS = os.environ.get("LIVE_PASS", "Marcos456@")

class LiveProxy:
    def __init__(self):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            urllib.request.HTTPRedirectHandler()
        )
        self.logged_in = False
        self.lock = threading.Lock()
        self.last_login = 0
        self._browser_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": LIVE_SITE,
            "Referer": f"{LIVE_SITE}/login",
        }
        self._ensure_login()

    def _ensure_login(self):
        with self.lock:
            if self.logged_in and (time.time() - self.last_login) < 300:
                return True
            try:
                data = json.dumps({"usuario": LIVE_USER, "senha": LIVE_PASS, "next": ""}).encode()
                req = urllib.request.Request(
                    f"{LIVE_SITE}/api/auth/login",
                    data=data,
                    headers=self._browser_headers
                )
                resp = self.opener.open(req, timeout=10)
                result = json.loads(resp.read().decode())
                if result.get("ok"):
                    self.logged_in = True
                    self.last_login = time.time()
                    return True
            except Exception as e:
                print(f"[LIVE PROXY] Login failed: {e}")
            self.logged_in = False
            return False

    def get(self, path, timeout=10):
        self._ensure_login()
        try:
            headers = {"User-Agent": self._browser_headers["User-Agent"], "Accept": "application/json", "Referer": f"{LIVE_SITE}/"}
            req = urllib.request.Request(f"{LIVE_SITE}{path}", headers=headers)
            resp = self.opener.open(req, timeout=timeout)
            return resp.read().decode(), resp.status
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else '{}'
            if e.code in (401, 403):
                self.logged_in = False
            return body, e.code
        except Exception as e:
            print(f"[LIVE PROXY] Error: {e}")
            self.logged_in = False
            return json.dumps({"rows": []}), 500

    def get_json(self, path, timeout=10):
        body, status = self.get(path, timeout)
        try:
            return json.loads(body), status
        except:
            return {"rows": []}, status

live_proxy = LiveProxy()

# Background thread to keep session alive
def keep_alive():
    while True:
        time.sleep(240)
        try:
            live_proxy._ensure_login()
        except:
            pass

threading.Thread(target=keep_alive, daemon=True).start()

init_db()

# CORS - permite painel local acessar a API
@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    return response

@app.teardown_appcontext
def teardown_db(exception):
    close_db(exception)

# --- Auth Helpers ---

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"ok": False, "detail": "Não autenticado"}), 401
        g.user = get_db().execute(
            "SELECT * FROM users WHERE id = ? AND ativo = 1",
            (session['user_id'],)
        ).fetchone()
        if g.user is None:
            session.clear()
            return jsonify({"ok": False, "detail": "Usuário não encontrado"}), 401
        return f(*args, **kwargs)
    return decorated

# --- API Auth ---

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    nome = (data.get('nome') or '').strip()
    email = (data.get('email') or '').strip().lower()
    telefone = (data.get('telefone') or '').strip()
    senha = data.get('senha') or ''
    confirma = data.get('confirma_senha') or ''

    if not nome or len(nome) < 3:
        return jsonify({"ok": False, "detail": "Nome completo obrigatório (mínimo 3 caracteres)."}), 400
    if not email or '@' not in email:
        return jsonify({"ok": False, "detail": "E-mail inválido."}), 400
    if len(senha) < 8:
        return jsonify({"ok": False, "detail": "Senha deve ter pelo menos 8 caracteres."}), 400
    if not any(c.isdigit() for c in senha) or not any(c.isalpha() for c in senha):
        return jsonify({"ok": False, "detail": "Senha precisa ter letras e números."}), 400
    if senha != confirma:
        return jsonify({"ok": False, "detail": "Senhas não conferem."}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE usuario = ?", (email,)).fetchone()
    if existing:
        return jsonify({"ok": False, "detail": "E-mail já cadastrado."}), 400

    now = datetime.datetime.now().isoformat()
    db.execute(
        "INSERT INTO users (nome, usuario, email, telefone, senha_hash, termos_aceitos, "
        "termos_aceitos_em, email_verificado, maior_18_aceito, maior_18_aceito_em, "
        "status, plano, licenca_expira, ativo, criado_em) "
        "VALUES (?, ?, ?, ?, ?, 1, ?, 1, 1, ?, 'teste', 'teste', ?, 1, ?)",
        (nome, email, email, telefone, generate_password_hash(senha), now, now,
         (datetime.datetime.now() + datetime.timedelta(days=3)).strftime('%Y-%m-%d'), now)
    )
    db.commit()

    return jsonify({
        "ok": True,
        "message": "Cadastro realizado com sucesso! Faça login."
    })

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    usuario = (data.get('usuario') or '').strip().lower()
    senha = data.get('senha') or ''

    if not usuario or not senha:
        return jsonify({"ok": False, "detail": "E-mail e senha obrigatórios."}), 400

    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE usuario = ? AND ativo = 1", (usuario,)
    ).fetchone()

    if not user or not check_password_hash(user['senha_hash'], senha):
        return jsonify({"ok": False, "detail": "E-mail ou senha inválidos."}), 401

    if not user['email_verificado']:
        return jsonify({"ok": False, "detail": "Confirme seu e-mail antes de fazer login."}), 401

    now = datetime.datetime.now().isoformat()
    db.execute("UPDATE users SET ultimo_login = ? WHERE id = ?", (now, user['id']))
    db.commit()

    session.clear()
    session['user_id'] = user['id']
    session.permanent = True

    licenca_valida = True
    if user['licenca_expira']:
        try:
            if datetime.datetime.now().date() > datetime.datetime.strptime(user['licenca_expira'], '%Y-%m-%d').date():
                licenca_valida = False
        except:
            pass

    dias = 0
    if user['licenca_expira']:
        try:
            delta = datetime.datetime.strptime(user['licenca_expira'], '%Y-%m-%d').date() - datetime.datetime.now().date()
            dias = max(0, delta.days)
        except:
            pass

    return jsonify({
        "ok": True,
        "user": {
            "id": user['id'],
            "nome": user['nome'],
            "usuario": user['usuario'],
            "email": user['email'],
            "telefone": user['telefone'],
            "termos_aceitos": True,
            "termos_aceitos_em": user['termos_aceitos_em'],
            "email_verificado": True,
            "telefone_verificado": False,
            "status": user['status'],
            "plano": user['plano'],
            "licenca_expira": user['licenca_expira'],
            "vence_em": user['licenca_expira'],
            "ativo": True,
            "admin": user['admin'] == 1,
            "criado_em": user['criado_em'],
            "ultimo_login": now,
            "maior_18_aceito": True,
            "licenca_valida": licenca_valida,
            "dias_restantes": dias
        },
        "redirect": "/"
    })

@app.route('/api/auth/me', methods=['GET'])
@login_required
def auth_me():
    user = g.user
    licenca_valida = True
    if user['licenca_expira']:
        try:
            if datetime.datetime.now().date() > datetime.datetime.strptime(user['licenca_expira'], '%Y-%m-%d').date():
                licenca_valida = False
        except:
            pass
    dias = 0
    if user['licenca_expira']:
        try:
            delta = datetime.datetime.strptime(user['licenca_expira'], '%Y-%m-%d').date() - datetime.datetime.now().date()
            dias = max(0, delta.days)
        except:
            pass
    return jsonify({
        "ok": True,
        "user": {
            "id": user['id'],
            "nome": user['nome'],
            "usuario": user['usuario'],
            "email": user['email'],
            "telefone": user['telefone'],
            "status": user['status'],
            "plano": user['plano'],
            "licenca_expira": user['licenca_expira'],
            "licenca_valida": licenca_valida,
            "dias_restantes": dias,
            "admin": user['admin'] == 1,
            "ativo": True
        }
    })

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"ok": True, "redirect": "/login"})

@app.route('/api/auth/email/resend', methods=['POST'])
def resend_verification():
    return jsonify({"ok": True, "message": "Link de verificação reenviado."})

@app.route('/api/auth/password/forgot', methods=['POST'])
def forgot_password():
    return jsonify({"ok": True, "message": "Instruções enviadas para seu e-mail."})

@app.route('/api/auth/password/reset', methods=['POST'])
def reset_password():
    return jsonify({"ok": True, "message": "Senha redefinida com sucesso."})

@app.route('/api/account/password', methods=['PUT'])
@login_required
def change_password():
    data = request.get_json()
    atual = data.get('atual', '')
    nova = data.get('nova', '')
    if not check_password_hash(g.user['senha_hash'], atual):
        return jsonify({"ok": False, "detail": "Senha atual incorreta."}), 400
    if len(nova) < 8:
        return jsonify({"ok": False, "detail": "Nova senha deve ter pelo menos 8 caracteres."}), 400
    db = get_db()
    db.execute("UPDATE users SET senha_hash = ? WHERE id = ?",
               (generate_password_hash(nova), g.user['id']))
    db.commit()
    return jsonify({"ok": True, "message": "Senha alterada com sucesso."})

# --- API Rounds ---

@app.route('/api/rounds', methods=['GET'])
def get_rounds():
    casa = request.args.get('casa', '').strip()
    painel = request.args.get('painel', '').strip()
    limit = min(int(request.args.get('limit', '500')), 2000)
    offset = int(request.args.get('offset', '0'))
    date_from = request.args.get('date_from', '').strip()
    date_to = request.args.get('date_to', '').strip()

    # Try live proxy first
    qs_parts = [f"limit={limit}&offset={offset}"]
    if casa:
        qs_parts.append(f"casa={urllib.parse.quote(casa)}")
    if painel:
        qs_parts.append(f"painel={urllib.parse.quote(painel)}")
    if date_from:
        qs_parts.append(f"date_from={urllib.parse.quote(date_from)}")
    if date_to:
        qs_parts.append(f"date_to={urllib.parse.quote(date_to)}")

    try:
        data, status = live_proxy.get_json(f"/api/rounds?{'&'.join(qs_parts)}", timeout=8)
        if status == 200 and data.get("rows"):
            db2 = get_db()
            for r in data["rows"]:
                exists = db2.execute("SELECT id FROM rounds WHERE casa=? AND round_id=?",
                    (r["casa"], str(r["round_id"]))).fetchone()
                if not exists:
                    db2.execute("INSERT INTO rounds (casa, round_id, multiplier, time_label, captured_at) VALUES (?,?,?,?,?)",
                        (r["casa"], str(r["round_id"]), round(float(r["multiplier"]), 2), r["time_label"], r["captured_at"]))
            db2.commit()
            return jsonify(data)
    except Exception as e:
        print(f"[PROXY] Rounds: {e}")

    # Fallback local
    db = get_db()
    query = "SELECT * FROM rounds WHERE 1=1"
    params = []
    if casa: query += " AND casa = ?"; params.append(casa)
    if date_from: query += " AND captured_at >= ?"; params.append(date_from)
    if date_to: query += " AND captured_at <= ?"; params.append(date_to + " 23:59:59")
    query += " ORDER BY captured_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = db.execute(query, params).fetchall()
    return jsonify({"rows": [{"casa": r['casa'],"round_id": str(r['round_id']),"multiplier": round(r['multiplier'], 2),"time_label": r['time_label'],"captured_at": r['captured_at']} for r in rows]})

@app.route('/api/rounds/hourly', methods=['GET'])
@login_required
def get_rounds_hourly():
    casa = request.args.get('casa', '').strip()
    date = request.args.get('date', datetime.datetime.now().strftime('%Y-%m-%d')).strip()

    db = get_db()
    query = "SELECT * FROM rounds WHERE date(captured_at) = ?"
    params = [date]
    if casa:
        query += " AND casa = ?"
        params.append(casa)
    query += " ORDER BY captured_at ASC"

    rows = db.execute(query, params).fetchall()

    return jsonify({
        "rows": [{
            "casa": r['casa'],
            "round_id": str(r['round_id']),
            "multiplier": round(r['multiplier'], 2),
            "time_label": r['time_label'],
            "captured_at": r['captured_at']
        } for r in rows]
    })

@app.route('/api/rounds/hourly-summary', methods=['GET'])
@login_required
def get_rounds_hourly_summary():
    casa = request.args.get('casa', '').strip()
    date = request.args.get('date', datetime.datetime.now().strftime('%Y-%m-%d')).strip()

    qs = f"casa={urllib.parse.quote(casa)}&date={urllib.parse.quote(date)}"
    try:
        data, status = live_proxy.get_json(f"/api/rounds/hourly-summary?{qs}", timeout=8)
        if status == 200 and data:
            return jsonify(data)
    except:
        pass

    db = get_db()
    query = "SELECT * FROM rounds WHERE date(captured_at) = ?"
    params = [date]
    if casa: query += " AND casa = ?"; params.append(casa)
    query += " ORDER BY captured_at ASC"
    rows = db.execute(query, params).fetchall()
    hours_data = {}
    for r in rows:
        try:
            h = int(r['time_label'].split(':')[0]); m = int(r['time_label'].split(':')[1])
            bucket = m // 10
        except: continue
        key = str(h)
        if key not in hours_data: hours_data[key] = {str(b): [] for b in range(6)}
        hours_data[key][str(bucket)].append({"round_id": str(r['round_id']),"multiplier": round(r['multiplier'], 2),"time_label": r['time_label'],"casa": r['casa']})
    return jsonify({"hours": hours_data, "date": date})

@app.route('/api/casas', methods=['GET'])
def get_casas():
    db = get_db()
    rows = db.execute("SELECT DISTINCT casa FROM rounds ORDER BY casa").fetchall()
    casas = [r['casa'] for r in rows if r['casa'] in CASAS_VALIDAS]
    return jsonify({"casas": casas})

# --- Payments ---

@app.route('/api/payments/gateway/public', methods=['GET'])
@login_required
def payments_gateway_public():
    return jsonify({"ok": True, "public_key": "pk_test_000000000000000000000000"})

@app.route('/api/payments/gateway/public-config', methods=['GET'])
@login_required
def payments_gateway_public_config():
    return jsonify({"ok": True, "public_key": "pk_test_000000000000000000000000", "gateway": "mercadopago"})

@app.route('/api/payments/status', methods=['GET'])
@login_required
def payments_status():
    return jsonify({"ok": True, "has_active_plan": True, "plan": g.user['plano'], "status": "ativo"})

# --- Pages ---

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login_page'))
    return render_template('index.html')

@app.route('/login')
def login_page():
    return render_template('login.html')

@app.route('/termos-de-uso')
def termos():
    return render_template('termos.html')

@app.route('/politica-de-privacidade')
def privacidade():
    return render_template('privacidade.html')

@app.route('/politica-de-cookies')
def cookies():
    return render_template('cookies.html')

@app.route('/aviso-legal')
def aviso_legal():
    return render_template('aviso_legal.html')

@app.route('/faq')
def faq():
    return render_template('faq.html')

@app.route('/vr5')
def vr5_painel():
    return render_template('index.html')

@app.route('/vr5_v35')
def vr5_v35_painel():
    return render_template('painel_vr5_v35.html')

@app.route('/logo_aviator.png')
def logo_aviator():
    from flask import send_from_directory
    import os
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), 'LOGO_AVIATOR.png')

@app.route('/LOGO_AVIATOR.png')
def LOGO_AVIATOR():
    from flask import send_from_directory
    import os
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), 'LOGO_AVIATOR.png')

@app.route('/assinatura-expirada')
def assinatura_expirada():
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Assinatura Expirada</title></head><body style="background:#030814;color:#f8fafc;font-family:Arial;text-align:center;padding:50px"><h1>Sua assinatura expirou</h1><p>Entre em contato para renovar seu acesso.</p><a href="/login" style="color:#93c5fd">Voltar para o login</a></body></html>'

# --- Casas oficiais do Jhow ---
CASAS_VALIDAS = [
    "SorteNaBet Aviator VIP 3",
    "BravoBet Aviator Plus 3",
    "Sorte na Bet grafico 1",
    "Sorte na bet Grafico 2",
    "ApostaX Aviator VIP",
    "ApostaX Aviator",
    "ApostaX Aviator Premium",
    "ApostaX Aviator Elite",
    "Aposta Tudo Aviator",
    "Aposta Tudo Aviator 3",
    "1WIN"
]

# --- Webhook da extensao (recebe velas em tempo real) ---
@app.route('/api/nova-vela', methods=['POST'])
def api_nova_vela():
    try:
        dados = request.get_json()
        if not dados:
            return jsonify({"erro": "Dados invalidos"}), 400
        mult = dados.get('multiplicador')
        if not mult or float(mult) < 1.0:
            return jsonify({"erro": "Multiplicador invalido"}), 400
        casa = dados.get('fonte', 'Extensao')
        if casa not in CASAS_VALIDAS:
            return jsonify({"erro": f"Casa nao autorizada: {casa}"}), 400
        rodada_id = str(dados.get('rodada', ''))
        ts = dados.get('timestamp', '')
        now = datetime.datetime.now()
        captured_at = now.strftime('%Y-%m-%dT%H:%M:%S')
        time_label = ts if ts else now.strftime('%H:%M:%S')
        db = get_db()
        existe = db.execute("SELECT id FROM rounds WHERE casa=? AND round_id=?",
            (casa, rodada_id)).fetchone()
        if not existe:
            db.execute(
                "INSERT INTO rounds (casa, round_id, multiplier, time_label, captured_at) VALUES (?,?,?,?,?)",
                (casa, rodada_id, round(float(mult), 2), time_label, captured_at)
            )
            db.commit()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

# --- Seed Data ---

def limpar_casas_invalidas():
    """Remove do banco casas que nao estao na lista oficial do Jhow"""
    db = get_db()
    todas = db.execute("SELECT DISTINCT casa FROM rounds").fetchall()
    for r in todas:
        if r['casa'] not in CASAS_VALIDAS:
            count = db.execute("SELECT COUNT(*) FROM rounds WHERE casa=?", (r['casa'],)).fetchone()[0]
            db.execute("DELETE FROM rounds WHERE casa=?", (r['casa'],))
            db.commit()
            print(f"[LIMPEZA] Removidas {count} rodadas da casa invalida: {r['casa']}")

def seed_data():
    db = get_db()
    count = db.execute("SELECT COUNT(*) FROM rounds").fetchone()[0]
    if count > 0:
        return  # nao apaga dados existentes

    casas = [
        "SorteNaBet Aviator VIP 3",
        "BravoBet Aviator Plus 3",
        "Sorte na Bet grafico 1",
        "Sorte na bet Grafico 2",
        "ApostaX Aviator VIP",
        "ApostaX Aviator",
        "ApostaX Aviator Premium",
        "ApostaX Aviator Elite",
        "Aposta Tudo Aviator",
        "Aposta Tudo Aviator 3",
        "1WIN"
    ]

    now = datetime.datetime.now()
    entries = []
    round_id_start = 260000

    # Generate 10 dias * 24h * 60min / 20s intervalos * 4 casas = ~8640 por casa
    total_per_casa = 4000
    intervalo_segundos = 18  # cada ~18s uma rodada

    for casa_idx, casa in enumerate(casas):
        base_id = round_id_start + (casa_idx * 100000)
        for i in range(total_per_casa):
            offset = (total_per_casa - i) * intervalo_segundos
            ts = now - datetime.timedelta(seconds=offset)
            ts_str = ts.strftime('%Y-%m-%dT%H:%M:%S')
            time_label = ts.strftime('%H:%M:%S')

            r = random.random()
            if r < 0.45:
                multiplier = round(random.uniform(1.00, 2.00), 2)
            elif r < 0.72:
                multiplier = round(random.uniform(2.00, 5.00), 2)
            elif r < 0.87:
                multiplier = round(random.uniform(5.00, 15.00), 2)
            elif r < 0.95:
                multiplier = round(random.uniform(15.00, 50.00), 2)
            elif r < 0.985:
                multiplier = round(random.uniform(50.00, 150.00), 2)
            else:
                multiplier = round(random.uniform(150.00, 500.00), 2)

            entries.append((casa, str(base_id + i), multiplier, time_label, ts_str))

        # Batch insert per casa to avoid memory issues
        db.executemany(
            "INSERT INTO rounds (casa, round_id, multiplier, time_label, captured_at) VALUES (?, ?, ?, ?, ?)",
            entries
        )
        db.commit()
        entries.clear()

    db.commit()

# --- Run ---

# Inicialização que roda em qualquer ambiente (gunicorn ou python app.py)
with app.app_context():
    seed_data()
    limpar_casas_invalidas()

# Inicia coletores WebSocket em background (independente do site oficial)
try:
    from coletores.coletor import iniciar_coletores, status as coletor_status
    iniciar_coletores()
    print("[COLETOR] Coletores WebSocket iniciados em background")
except Exception as e:
    print(f"[COLETOR] Aviso: coletor não iniciado: {e}")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
