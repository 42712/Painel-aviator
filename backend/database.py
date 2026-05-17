"""Banco de dados SQLite - Painel Aviator SaaS"""
import sqlite3
import os
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'aviator.db')


def get_db():
    """Retorna conexão com o banco"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Cria as tabelas e o master padrão"""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS master (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            login TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            nome TEXT DEFAULT '',
            observacao TEXT DEFAULT '',
            bloqueado INTEGER DEFAULT 0,
            tempo_acesso INTEGER DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ultimo_acesso TIMESTAMP,
            online INTEGER DEFAULT 0
        );
    ''')

    # Cria master padrão se não existir
    master = cursor.execute("SELECT id FROM master WHERE email = ?",
                          ("marcosduarte356@gmail.com",)).fetchone()
    if not master:
        hash_senha = generate_password_hash("amordedeus123@")
        cursor.execute("INSERT INTO master (email, senha_hash) VALUES (?, ?)",
                     ("marcosduarte356@gmail.com", hash_senha))

    # Migração: adiciona coluna slug se não existir
    # NOTA: SQLite não permite UNIQUE em ALTER TABLE ADD COLUMN,
    # então a unicidade é garantida via application code (try/except IntegrityError)
    try:
        cursor.execute("ALTER TABLE clientes ADD COLUMN slug TEXT DEFAULT NULL")
    except sqlite3.OperationalError:
        pass  # Coluna já existe

    # Cria índice único para slug (operação separada do ADD COLUMN)
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_slug ON clientes(slug)")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


# ===== MASTER =====
def verificar_master(email, senha):
    conn = get_db()
    master = conn.execute("SELECT * FROM master WHERE email = ?", (email,)).fetchone()
    conn.close()
    if master and check_password_hash(master['senha_hash'], senha):
        return dict(master)
    return None


# ===== CLIENTES =====
def criar_cliente(login, senha, nome="", observacao="", tempo_acesso=0, slug=None):
    import uuid
    conn = get_db()
    token = str(uuid.uuid4())
    hash_senha = generate_password_hash(senha)
    try:
        if slug:
            conn.execute("""INSERT INTO clientes (token, login, senha_hash, nome, observacao, tempo_acesso, slug)
                            VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (token, login, hash_senha, nome, observacao, tempo_acesso, slug))
        else:
            conn.execute("""INSERT INTO clientes (token, login, senha_hash, nome, observacao, tempo_acesso)
                            VALUES (?, ?, ?, ?, ?, ?)""",
                       (token, login, hash_senha, nome, observacao, tempo_acesso))
        conn.commit()
        return {"ok": True, "token": token, "slug": slug}
    except sqlite3.IntegrityError as e:
        if "slug" in str(e):
            return {"ok": False, "erro": "Slug já está em uso"}
        return {"ok": False, "erro": "Login já existe"}
    finally:
        conn.close()


def listar_clientes():
    conn = get_db()
    rows = conn.execute("""SELECT id, token, login, nome, observacao, bloqueado,
                                  tempo_acesso, criado_em, ultimo_acesso, online,
                                  slug
                           FROM clientes ORDER BY criado_em DESC""").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_cliente_por_id(cliente_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM clientes WHERE id = ?", (cliente_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_cliente_por_token(token):
    conn = get_db()
    row = conn.execute("SELECT * FROM clientes WHERE token = ?", (token,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_cliente_por_slug(slug):
    """Busca cliente por slug (link personalizado)"""
    conn = get_db()
    row = conn.execute("SELECT * FROM clientes WHERE slug = ?", (slug,)).fetchone()
    conn.close()
    return dict(row) if row else None


def atualizar_slug(cliente_id, slug):
    """Atualiza slug de um cliente"""
    conn = get_db()
    try:
        conn.execute("UPDATE clientes SET slug = ? WHERE id = ?", (slug, cliente_id))
        conn.commit()
        conn.close()
        return {"ok": True}
    except sqlite3.IntegrityError:
        conn.close()
        return {"ok": False, "erro": "Slug já está em uso"}


def get_cliente_por_login(login):
    conn = get_db()
    row = conn.execute("SELECT * FROM clientes WHERE login = ?", (login,)).fetchone()
    conn.close()
    return dict(row) if row else None


def verificar_cliente(login, senha):
    cliente = get_cliente_por_login(login)
    if cliente and not cliente['bloqueado'] and check_password_hash(cliente['senha_hash'], senha):
        # Verifica se acesso expirou
        if not verificar_tempo_acesso(cliente):
            return None, "Acesso expirado"
        return cliente, None
    if cliente and cliente['bloqueado']:
        return None, "Conta bloqueada"
    return None, "Login ou senha inválidos"


def verificar_tempo_acesso(cliente):
    """Retorna True se o acesso ainda é válido"""
    if cliente['tempo_acesso'] == 0:
        return True  # Ilimitado
    if not cliente['ultimo_acesso']:
        return True  # Primeiro acesso, deixa passar
    from datetime import datetime, timedelta
    ultimo = datetime.fromisoformat(cliente['ultimo_acesso'])
    expira = ultimo + timedelta(minutes=cliente['tempo_acesso'])
    return datetime.now() < expira


def editar_cliente(cliente_id, dados):
    conn = get_db()
    updates = []
    valores = []
    for campo in ['login', 'nome', 'observacao', 'tempo_acesso', 'slug']:
        if campo in dados:
            updates.append(f"{campo} = ?")
            valores.append(dados[campo])
    if 'senha' in dados and dados['senha']:
        updates.append("senha_hash = ?")
        valores.append(generate_password_hash(dados['senha']))
    if updates:
        valores.append(cliente_id)
        try:
            conn.execute(f"UPDATE clientes SET {', '.join(updates)} WHERE id = ?", valores)
            conn.commit()
            conn.close()
            return {"ok": True}
        except sqlite3.IntegrityError:
            conn.close()
            return {"ok": False, "erro": "Slug já está em uso"}
    conn.close()
    return {"ok": True}


def toggle_bloqueio(cliente_id):
    conn = get_db()
    cliente = conn.execute("SELECT bloqueado FROM clientes WHERE id = ?", (cliente_id,)).fetchone()
    if cliente:
        novo = 0 if cliente['bloqueado'] else 1
        conn.execute("UPDATE clientes SET bloqueado = ? WHERE id = ?", (novo, cliente_id))
        conn.commit()
        conn.close()
        return {"bloqueado": bool(novo)}
    conn.close()
    return None


def atualizar_online(cliente_id, online=True):
    conn = get_db()
    agora = datetime.now().isoformat()
    conn.execute("UPDATE clientes SET online = ?, ultimo_acesso = ? WHERE id = ?",
               (1 if online else 0, agora, cliente_id))
    conn.commit()
    conn.close()

def excluir_cliente_db(cliente_id):
    conn = get_db()
    try:
        conn.execute("DELETE FROM clientes WHERE id = ?", (cliente_id,))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        conn.close()
        return False


def get_estatisticas():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM clientes").fetchone()[0]
    ativos = conn.execute("SELECT COUNT(*) FROM clientes WHERE bloqueado = 0").fetchone()[0]
    bloqueados = conn.execute("SELECT COUNT(*) FROM clientes WHERE bloqueado = 1").fetchone()[0]
    online = conn.execute("SELECT COUNT(*) FROM clientes WHERE online = 1").fetchone()[0]
    conn.close()
    return {
        "total": total,
        "ativos": ativos,
        "bloqueados": bloqueados,
        "online": online
    }


def exportar_relatorio():
    """Retorna dados para CSV"""
    clientes = listar_clientes()
    linhas = []
    for c in clientes:
        status = "Ativo" if not c['bloqueado'] else "Bloqueado"
        online = "Sim" if c['online'] else "Não"
        linhas.append({
            "Nome": c['nome'],
            "Login": c['login'],
            "Observacao": c['observacao'],
            "Status": status,
            "Online": online,
            "Ultimo Acesso": c['ultimo_acesso'] or "Nunca",
            "Criado em": c['criado_em']
        })
    return linhas
