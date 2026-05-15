"""Script principal para iniciar o servidor"""
from server import app, socketio, collector
import config

if __name__ == '__main__':
    print(f"🚀 Painel Aviator Iniciado")
    print(f"📡 Modo: {'🔵 Simulado' if config.SIMULAR_DADOS else '🟣 Real (Sorte da Bet)'}")
    print(f"🌐 http://{config.HOST}:{config.PORT}")
    print(f"📊 Histórico máximo: {config.MAX_HISTORICO} rodadas")

    collector.iniciar()
    socketio.run(
        app,
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG
    )
