import os
import sqlite3
from flask import g

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'painel_aviator.db')

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db

def init_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row

    db.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            usuario TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            telefone TEXT,
            senha_hash TEXT NOT NULL,
            termos_aceitos INTEGER DEFAULT 0,
            termos_aceitos_em TEXT,
            email_verificado INTEGER DEFAULT 0,
            telefone_verificado INTEGER DEFAULT 0,
            codigo_ativacao TEXT,
            codigo_ativacao_expira_em TEXT,
            reset_token TEXT,
            reset_expira_em TEXT,
            status TEXT DEFAULT 'teste',
            plano TEXT DEFAULT 'teste',
            licenca_expira TEXT,
            ativo INTEGER DEFAULT 1,
            admin INTEGER DEFAULT 0,
            criado_em TEXT,
            ultimo_login TEXT,
            maior_18_aceito INTEGER DEFAULT 0,
            maior_18_aceito_em TEXT,
            sessoes_ativas INTEGER DEFAULT 0
        )
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            casa TEXT NOT NULL,
            round_id TEXT NOT NULL,
            multiplier REAL NOT NULL,
            time_label TEXT NOT NULL,
            captured_at TEXT NOT NULL
        )
    """)

    db.execute("""
        CREATE INDEX IF NOT EXISTS idx_rounds_casa ON rounds(casa)
    """)
    db.execute("""
        CREATE INDEX IF NOT EXISTS idx_rounds_captured_at ON rounds(captured_at)
    """)
    db.execute("""
        CREATE INDEX IF NOT EXISTS idx_rounds_casa_date ON rounds(casa, captured_at)
    """)

    db.execute("""
        CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            plano TEXT DEFAULT 'mensal',
            duracao_dias INTEGER DEFAULT 30,
            ativo INTEGER DEFAULT 1,
            criado_em TEXT
        )
    """)

    from werkzeug.security import generate_password_hash
    admin = db.execute("SELECT id FROM users WHERE admin = 1").fetchone()
    if not admin:
        import datetime
        now = datetime.datetime.now().isoformat()
        db.execute(
            "INSERT INTO users (nome, usuario, email, telefone, senha_hash, termos_aceitos, "
            "termos_aceitos_em, email_verificado, status, plano, licenca_expira, "
            "ativo, admin, criado_em, maior_18_aceito, maior_18_aceito_em) "
            "VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'admin', 'vitalicio', ?, 1, 1, ?, 1, ?)",
            ("ADMIN", "admin@painel.com", "admin@painel.com", "(19) 00000-0000",
             generate_password_hash("admin123"), now,
             (datetime.datetime.now() + datetime.timedelta(days=3650)).strftime('%Y-%m-%d'),
             now, now)
        )

    db.commit()
    db.close()

def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()
