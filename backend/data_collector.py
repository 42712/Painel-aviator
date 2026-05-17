"""Coletor de dados do Aviator - Simulado e Real (Sorte da Bet)"""
import json
import random
import time
import threading
from datetime import datetime
from models import Rodada
from config import WS_SORTE_BET_URL, SIMULAR_DADOS, INTERVALO_RODADA, MAX_HISTORICO


class DataCollector:
    """Coleta dados do Aviator - simulado ou via WebSocket da Sorte da Bet"""

    def __init__(self, callback=None):
        self.historico = []  # Lista de Rodada
        self.ultima_rodada = None
        self.penultima_rodada = None
        self.callback = callback
        self.running = False
        self._thread = None
        self._rodada_atual = random.randint(3691848, 9999999)
        self._ultimo_valor = 1.00

    def iniciar(self):
        """Inicia a coleta de dados - modo híbrido"""
        self.running = True

        if SIMULAR_DADOS:
            # Modo simulado para testes/desenvolvimento
            self._thread = threading.Thread(target=self._simular_coleta, daemon=True)
            self._thread.start()
        else:
            # Modo real - apenas dados da extensão via webhook
            print("[DataCollector] Modo real ativo - aguardando dados da extensão")
            self._ws_thread = threading.Thread(target=self._coletar_sorte_bet, daemon=True)
            self._ws_thread.start()

    def parar(self):
        self.running = False

    # ===== DADOS SIMULADOS =====
    def _simular_coleta(self):
        """Gera dados simulados para desenvolvimento/teste"""
        # Preenche histórico inicial com 100 rodadas
        for _ in range(100):
            self._gerar_rodada()
            time.sleep(0.05)

        # Loop contínuo gerando rodadas
        while self.running:
            self._gerar_rodada()
            time.sleep(INTERVALO_RODADA)

    def _gerar_rodada(self):
        """Gera uma rodada simulada"""
        self._rodada_atual += 1
        rand = random.random()

        if rand < 0.60:  # 60% azul (1.00x - 1.99x)
            mult = round(random.uniform(1.00, 1.99), 2)
        elif rand < 0.85:  # 25% roxa (2.00x - 5.00x)
            mult = round(random.uniform(2.00, 5.00), 2)
        elif rand < 0.95:  # 10% roxa alta (5.01x - 9.99x)
            mult = round(random.uniform(5.01, 9.99), 2)
        else:  # 5% rosa (10.00x+)
            mult = round(random.uniform(10.00, 50.00), 2)

        rodada = Rodada(self._rodada_atual, mult)
        self._adicionar_rodada(rodada)

    # ===== DADOS REAIS - SORTE DA BET =====
    def _coletar_sorte_bet(self):
        """Conecta ao WebSocket da Sorte da Bet para coletar dados reais"""
        import websocket as ws

        if not WS_SORTE_BET_URL:
            print("[ERRO] WS_SORTE_BET_URL não configurado. Aguardando dados via webhook da extensão.")
            # Apenas mantém vivo - dados chegam via extensão
            while self.running:
                time.sleep(10)
            return

        def on_message(ws_app, message):
            try:
                data = json.loads(message)
                self._processar_mensagem_sorte_bet(data)
            except Exception as e:
                print(f"[ERRO] Processando mensagem: {e}")

        def on_error(ws_app, error):
            print(f"[ERRO] WebSocket: {error}")

        def on_close(ws_app, close_status_code, close_msg):
            print("[WS] Conexão fechada. Reconectando em 5s...")
            time.sleep(5)
            if self.running:
                self._coletar_sorte_bet()

        def on_open(ws_app):
            print("[WS] Conectado à Sorte da Bet!")

        ws_app = ws.WebSocketApp(
            WS_SORTE_BET_URL,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close
        )

        # Reconexão automática
        while self.running:
            try:
                ws_app.run_forever(reconnect=5)
            except Exception as e:
                print(f"[ERRO] WebSocket loop: {e}")
                time.sleep(5)

    def _processar_mensagem_sorte_bet(self, data):
        """Processa mensagem do WebSocket da Sorte da Bet"""
        # O formato varia conforme a plataforma - adaptável
        # Estrutura esperada:
        # {"rodada": 123456, "mult": 1.45, "timestamp": "19:36:16"}

        rodada_id = data.get("rodada") or data.get("round") or data.get("id")
        mult = data.get("mult") or data.get("multiplicador") or data.get("value")
        timestamp = data.get("timestamp") or data.get("time") or data.get("hora")

        if rodada_id and mult:
            rodada = Rodada(int(rodada_id), float(mult), timestamp)
            self._adicionar_rodada(rodada)

    # ===== MÉTODOS COMUNS =====
    def _adicionar_rodada(self, rodada: Rodada):
        """Adiciona rodada ao histórico"""
        self.penultima_rodada = self.ultima_rodada
        self.ultima_rodada = rodada

        self.historico.append(rodada)
        if len(self.historico) > MAX_HISTORICO:
            self.historico.pop(0)

        if self.callback:
            self.callback(rodada)

    def get_ultimas(self, n: int = 50) -> list:
        """Retorna as últimas N rodadas"""
        return [r.to_dict() for r in self.historico[-n:]]

    def get_por_cor(self, cor: str) -> list:
        """Retorna rodadas filtradas por cor"""
        return [r.to_dict() for r in self.historico if r.cor == cor]

    def get_todas(self) -> list:
        """Retorna todo o histórico"""
        return [r.to_dict() for r in self.historico]

    def get_estatisticas(self):
        """Retorna estatísticas básicas"""
        if not self.historico:
            return {}

        totais = {"azul": 0, "roxa": 0, "rosa": 0}
        for r in self.historico:
            totais[r.cor] = totais.get(r.cor, 0) + 1

        total = len(self.historico)
        return {
            "total": total,
            "ultima": self.ultima_rodada.to_dict() if self.ultima_rodada else None,
            "penultima": self.penultima_rodada.to_dict() if self.penultima_rodada else None,
            "porcentagens": {
                cor: round((count / total * 100), 1) if total > 0 else 0
                for cor, count in totais.items()
            }
        }
