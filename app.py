"""Entrypoint WSGI para o Render"""
import os, sys

backend = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend)

from server import app as flask_app, socketio, collector

collector.iniciar()

app = socketio

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"Painel Aviator Iniciado - Porta {port}")
    socketio.run(flask_app, host="0.0.0.0", port=port)
