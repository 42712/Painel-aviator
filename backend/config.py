"""Configurações do projeto"""
import os

# Configurações do WebSocket da Sorte da Bet
# Colete o endpoint inspecionando o site sorte da bet aviator
WS_SORTE_BET_URL = os.getenv("WS_SORTE_BET_URL", "")

# Configurações do servidor
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 5000))
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

# Modo simulação (true = dados simulados, false = real da sorte da bet)
SIMULAR_DADOS = os.getenv("SIMULAR_DADOS", "true").lower() == "true"

# Intervalo entre rodadas (segundos) - para simulação
INTERVALO_RODADA = int(os.getenv("INTERVALO_RODADA", "8"))

# Histórico máximo de rodadas
MAX_HISTORICO = 15000

# Config das cores
CORES = {
    "azul": {"nome": "Azul", "min": 1.00, "max": 1.99, "hex": "#349CFF", "rgb": "rgb(52, 156, 255)"},
    "roxa": {"nome": "Roxa", "min": 2.00, "max": 9.99, "hex": "#913EF8", "rgb": "rgb(145, 62, 248)"},
    "rosa": {"nome": "Rosa", "min": 10.00, "max": 9999.00, "hex": "#FF2D95", "rgb": "rgb(255, 45, 149)"},
}
