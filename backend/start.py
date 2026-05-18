import os
from server import app

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 Painel Aviator Iniciado - Porta {port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
