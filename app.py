"""Entrypoint WSGI para o Render - usa simple-websocket (Python puro)"""
import os
import sys
import traceback

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

backend = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend)

try:
    from server import app as flask_app, socketio, collector
    collector.iniciar()
    app = socketio
except Exception:
    print("=" * 60, flush=True)
    print("ERRO AO INICIAR:", flush=True)
    traceback.print_exc()
    print("=" * 60, flush=True)
    sys.exit(1)

print("App carregado com sucesso", flush=True)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"Painel Aviator Iniciado - Porta {port}", flush=True)
    socketio.run(flask_app, host="0.0.0.0", port=port, debug=False)
