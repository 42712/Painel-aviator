"""Autenticação e decorators para o Painel Aviator SaaS"""
from functools import wraps
from flask import session, redirect, url_for, request
from database import verificar_master, verificar_cliente, get_cliente_por_id, atualizar_online


def login_master(email, senha):
    """Autentica o master e cria sessão"""
    master = verificar_master(email, senha)
    if master:
        session.clear()
        session['tipo'] = 'master'
        session['master_id'] = master['id']
        session['master_email'] = master['email']
        session.permanent = True
        return True
    return False


def login_cliente(login, senha):
    """Autentica um cliente e cria sessão"""
    cliente, erro = verificar_cliente(login, senha)
    if cliente:
        session.clear()
        session['tipo'] = 'cliente'
        session['cliente_id'] = cliente['id']
        session['cliente_token'] = cliente['token']
        session.permanent = True
        atualizar_online(cliente['id'], True)
        return True, None
    return False, erro


def logout():
    """Desloga qualquer tipo de usuário"""
    if session.get('tipo') == 'cliente' and session.get('cliente_id'):
        atualizar_online(session['cliente_id'], False)
    session.clear()


def master_required(f):
    """Decorator: só master pode acessar"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('tipo') != 'master':
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated


def cliente_required(f):
    """Decorator: só cliente autenticado pode acessar"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('tipo') != 'cliente':
            return redirect(f"/painel/{kwargs.get('token', '')}")
        # Verifica se o cliente ainda existe e não foi bloqueado
        cliente = get_cliente_por_id(session['cliente_id'])
        if not cliente or cliente['bloqueado']:
            logout()
            return redirect(f"/painel/{kwargs.get('token', '')}")
        return f(*args, **kwargs)
    return decorated
