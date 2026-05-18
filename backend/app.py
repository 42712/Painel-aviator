import os
from server import app, collector1, collector2

if __name__ == '__main__':
    from waitress import serve
    import config
    print(f"[INICIANDO] Painel Aviator SaaS - Porta {config.PORT}")
    print(f"[MODO] {'Simulado' if config.SIMULAR_DADOS else 'Real (extensões)'}")
    collector1.iniciar()
    collector2.iniciar()
    serve(app, host=config.HOST, port=config.PORT)
