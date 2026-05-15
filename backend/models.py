"""Modelo de dados para rodadas do Aviator"""
from datetime import datetime
from config import CORES


class Rodada:
    """Representa uma rodada do Aviator"""

    def __init__(self, rodada_id: int, multiplicador: float, timestamp: str = None):
        self.rodada_id = rodada_id
        self.multiplicador = round(multiplicador, 2)
        self.timestamp = timestamp or datetime.now().strftime("%H:%M:%S")
        self.cor = self._classificar_cor(multiplicador)
        self.soma = self._calcular_soma(multiplicador)

    def _classificar_cor(self, mult: float) -> str:
        for cor, cfg in CORES.items():
            if cfg["min"] <= mult <= cfg["max"]:
                return cor
        return "azul"  # fallback

    def _calcular_soma(self, mult: float) -> int:
        """Calcula a soma dos dígitos + partes do multiplicador"""
        # Ex: 1.23x -> 1 + 2 + 3 = 6
        # Remove o 'x' se tiver, converte pra string
        mult_str = f"{mult:.2f}"
        soma = 0
        for char in mult_str:
            if char.isdigit():
                soma += int(char)
        return soma

    def to_dict(self):
        return {
            "rodada": self.rodada_id,
            "multiplicador": self.multiplicador,
            "timestamp": self.timestamp,
            "cor": self.cor,
            "soma": self.soma,
            "exibicao": f"{self.multiplicador:.2f}x"
        }
