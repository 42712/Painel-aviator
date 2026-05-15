"""Servidor principal para o Painel Aviator - compatível com Render"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from server import app, socketio, collector

collector.iniciar()

# Exporta socketio como aplicação WSGI para o gunicorn
application = socketio

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"Painel Aviator Iniciado - Porta {port}")
    socketio.run(app, host="0.0.0.0", port=port)
