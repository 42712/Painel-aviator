print("ALIVE", flush=True)
import sys, os

backend = os.path.join(os.path.dirname(__file__), 'backend')
sys.path.insert(0, backend)

from server import app, collector1, collector2

collector1.iniciar()
collector2.iniciar()
print("OK", flush=True)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    print(f"PORT={port}", flush=True)
    from waitress import serve
    serve(app, host="0.0.0.0", port=port)
