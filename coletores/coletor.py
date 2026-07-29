"""
COLETOR DE DADOS EM TEMPO REAL - PAINEL AVIATOR DO JHOW
=========================================================
Conecta diretamente nos WebSockets das casas de aposta.
Captura cada rodada do Aviator em tempo real.

Para capturar a URL do WebSocket:
1. Entre no site da casa de aposta e abra o jogo Aviator
2. Pressione F12 → aba Network → filtrar por WS
3. Copie a URL do WebSocket que aparece
4. Cole no arquivo config.json na chave "ws_url"
5. Mude "ativo" para true

Execute: python coletores/coletor.py
"""

import json
import sqlite3
import time
import threading
import logging
import sys
import os
from datetime import datetime
from pathlib import Path

# ======== CONFIG ========
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

try:
    from websocket import WebSocketApp, WebSocketConnectionClosedException
except ImportError:
    print("ERRO: Instale websocket-client → pip install websocket-client")
    sys.exit(1)

# ======== CONFIG ========
DB_PATH = BASE_DIR / "painel_aviator.db"
CONFIG_PATH = Path(__file__).resolve().parent / "config.json"
LOG_PATH = Path(__file__).resolve().parent / "coletor.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_PATH, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("COLETOR")

# ======== DATABASE ========
_conn = None
_db_lock = threading.Lock()

def get_conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn

def db_save(casa, round_id, multiplier, time_label, captured_at):
    with _db_lock:
        try:
            conn = get_conn()
            exists = conn.execute(
                "SELECT id FROM rounds WHERE casa=? AND round_id=?",
                (casa, str(round_id))
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO rounds (casa, round_id, multiplier, time_label, captured_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (casa, str(round_id), round(float(multiplier), 2), time_label, captured_at)
                )
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"[DB] Erro ao salvar: {e}")
    return False

# ======== PARSERS ========
def parse_spribe(message, casa_nome):
    """Parser para Spribe (Aviator oficial)"""
    try:
        data = json.loads(message)
        
        if isinstance(data, list):
            for item in data:
                result = _parse_single_spribe(item, casa_nome)
                if result: return result
        elif isinstance(data, dict):
            return _parse_single_spribe(data, casa_nome)
    except json.JSONDecodeError:
        pass
    return None

def _parse_single_spribe(data, casa_nome):
    msg_type = data.get("type", "")
    
    if msg_type == "crash":
        round_id = data.get("round_id")
        multiplier = data.get("crash_point")
        ts = data.get("timestamp", int(time.time()))
        if not round_id or not multiplier:
            return None
    elif msg_type == "bet" and "round_id" in data:
        return None  # Ignora apostas, so queremos o crash
    elif msg_type == "game_start":
        return None  # Ignora inicio
    else:
        # Tenta pegar campos genericos
        round_id = data.get("round_id") or data.get("roundId") or data.get("id")
        multiplier = data.get("multiplier") or data.get("crash_point") or data.get("crashPoint")
        if not round_id or not multiplier:
            return None
        ts = data.get("timestamp", int(time.time()))

    if isinstance(ts, (int, float)) and ts > 1000000000000:
        ts = ts / 1000

    if isinstance(ts, str):
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except:
            dt = datetime.now()
    elif isinstance(ts, (int, float)):
        dt = datetime.fromtimestamp(ts)
    else:
        dt = datetime.now()

    time_label = dt.strftime('%H:%M:%S')
    captured_at = dt.strftime('%Y-%m-%dT%H:%M:%S')

    return {
        "casa": casa_nome,
        "round_id": str(round_id),
        "multiplier": round(float(multiplier), 2),
        "time_label": time_label,
        "captured_at": captured_at
    }

def parse_pragmatic(message, casa_nome):
    """Parser para Pragmatic Play Aviator"""
    try:
        data = json.loads(message)
        if "event" in data and data["event"] == "result":
            d = data.get("data", data)
            round_id = d.get("roundId")
            multiplier = d.get("multiplier")
            ts = d.get("timestamp", datetime.now().isoformat())
            
            if round_id and multiplier:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                return {
                    "casa": casa_nome,
                    "round_id": str(round_id),
                    "multiplier": round(float(multiplier), 2),
                    "time_label": dt.strftime('%H:%M:%S'),
                    "captured_at": dt.strftime('%Y-%m-%dT%H:%M:%S')
                }
    except:
        pass
    return None

def parse_appbackend(message, casa_nome):
    """Parser para o relay publico apiglobal.appbackend.tech"""
    try:
        data = json.loads(message)
        if data.get("type") != "signal":
            return None
        d = data.get("data", {})
        valor = d.get("valor")
        if not valor:
            return None
        multiplier = float(valor)
        if multiplier < 1.0:
            return None
        round_id = data.get("timestamp", "").replace("-", "").replace(":", "").replace("T", "").replace(".", "")[:14]
        ts = d.get("createdAt", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except:
            dt = datetime.now()
        return {
            "casa": casa_nome,
            "round_id": str(round_id),
            "multiplier": round(multiplier, 2),
            "time_label": dt.strftime('%H:%M:%S'),
            "captured_at": dt.strftime('%Y-%m-%dT%H:%M:%S')
        }
    except:
        pass
    return None

def parse_auto(message, casa_nome):
    """Auto-detecta o formato da mensagem e extrai os dados"""
    for parser in [parse_appbackend, parse_spribe, parse_pragmatic]:
        result = parser(message, casa_nome)
        if result:
            return result
    return None

# ======== COLETOR ========
class CasaColetor:
    def __init__(self, nome, ws_url, provider="auto"):
        self.nome = nome
        self.ws_url = ws_url
        self.provider = provider
        self.ws = None
        self.running = False
        self.thread = None
        self.round_count = 0
        self.last_round = None
        self.reconnect_delay = 5

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True, name=f"WS-{self.nome[:20]}")
        self.thread.start()

    def stop(self):
        self.running = False
        if self.ws:
            try: self.ws.close()
            except: pass

    def _run(self):
        while self.running:
            try:
                logger.info(f"[{self.nome}] Conectando em {self.ws_url[:80]}...")
                self.ws = WebSocketApp(
                    self.ws_url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close
                )
                self.ws.run_forever(
                    ping_interval=45,
                    ping_timeout=15,
                    reconnect=0
                )
            except Exception as e:
                logger.error(f"[{self.nome}] Erro fatal: {e}")

            if self.running:
                delay = min(self.reconnect_delay, 15)
                logger.info(f"[{self.nome}] Reconectando em {delay}s...")
                time.sleep(delay)
                self.reconnect_delay = min(self.reconnect_delay * 2, 15)

    def _on_open(self, ws):
        self.reconnect_delay = 5
        logger.info(f"[{self.nome}] ✅ CONECTADO!")

    def _on_message(self, ws, message):
        result = parse_auto(message, self.nome)
        if result:
            saved = db_save(
                result["casa"], result["round_id"],
                result["multiplier"], result["time_label"],
                result["captured_at"]
            )
            if saved:
                self.round_count += 1
                self.last_round = f"#{result['round_id']} = {result['multiplier']}x"
                logger.info(f"[{self.nome}] 🎯 {self.last_round} (total: {self.round_count})")

    def _on_error(self, ws, error):
        logger.error(f"[{self.nome}] Erro: {error}")

    def _on_close(self, ws, close_status, close_msg):
        logger.warning(f"[{self.nome}] Desconectado (status={close_status})")

# ======== MAIN ========
def load_casas():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    casas = []
    for c in config.get("casas", []):
        if c.get("ativo", False):
            casas.append(CasaColetor(
                nome=c["nome"],
                ws_url=c["ws_url"],
                provider=c.get("provider", "auto")
            ))
    return casas

def status():
    collectors = _active_collectors
    lines = []
    for c in collectors:
        running = "(ATIVO)" if c.running else "(PARADO)"
        lines.append(f"  [{c.nome[:30]}] {running} rounds={c.round_count} last={c.last_round}")
    return "\n".join(lines) if lines else "  Nenhuma casa configurada/ativa em config.json"

_active_collectors = []

def iniciar_coletores():
    """Inicia todos os coletores configurados. Chamado pelo app.py."""
    global _active_collectors
    casas = load_casas()
    
    if not casas:
        logger.warning("Nenhuma casa ativa em config.json. Configure ws_url e mude ativo=true.")
        return []

    for casa in casas:
        casa.start()
        _active_collectors.append(casa)
        time.sleep(0.3)

    logger.info(f"{len(casas)} coletores iniciados.")
    return _active_collectors

def parar_coletores():
    for c in _active_collectors:
        c.stop()

# ======== CLI ========
if __name__ == "__main__":
    print("=" * 60)
    print("  COLETOR DE DADOS - PAINEL AVIATOR DO JHOW")
    print("=" * 60)
    print()
    
    casas = load_casas()
    
    if not casas:
        print("Nenhuma casa ativa no config.json!")
        print()
        print("Para ativar uma casa, edite coletores/config.json:")
        print('  1. Cole a URL do WebSocket em "ws_url"')
        print('  2. Mude "ativo" para true')
        print()
        print("Como capturar a URL: F12 → Network → WS → copiar URL")
        exit(1)

    print(f"Casas configuradas: {len(casas)}")
    for c in casas:
        print(f"  - {c.nome} → {c.ws_url[:70]}...")
    print()
    print("Iniciando coletores... (Ctrl+C para parar)")
    print()

    collectors = iniciar_coletores()

    try:
        while True:
            time.sleep(5)
            print(f"\n--- STATUS {datetime.now().strftime('%H:%M:%S')} ---")
            print(status())
    except KeyboardInterrupt:
        print("\nParando coletores...")
        parar_coletores()
        print("Fim.")
