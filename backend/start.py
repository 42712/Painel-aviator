import os
from server import app, socketio, collector

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Painel Aviator Iniciado - Porta {port}")
    collector.iniciar()
    socketio.run(app, host="0.0.0.0", port=port)
