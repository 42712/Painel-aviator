"""Testador de API Spribe - Cole o link wss no TUTORIAL.txt e execute este script IMEDIATAMENTE"""
import websocket
import json
import time
import re
import sys

# Le o arquivo tutorial e pega o ultimo link wss
tutorial_path = r"C:\PROJETOS\AVIATOR_LOCAL\TUTORIAL.txt"
with open(tutorial_path, "r", encoding="utf-8") as f:
    content = f.read()

# Encontra todos os links wss
urls = re.findall(r'wss://[^\s]+', content)
if not urls:
    print("Nenhum link wss encontrado no TUTORIAL.txt!")
    print("Cole o link do WebSocket (F12 > Network > WS) e execute novamente.")
    sys.exit(1)

url = urls[-1]  # pega o ultimo
print(f"URL: {url[:100]}...")
print("Conectando AGORA (token fresco)...")

try:
    ws = websocket.create_connection(url, timeout=10)
    ws.settimeout(20)
    print("CONECTADO!")
    
    # Recebe heartbeats
    for i in range(2):
        msg = ws.recv()
        print(f"  [{i}] {repr(msg)[:60]}")
    
    # Envia STOMP CONNECT via SockJS
    connect = "CONNECT\naccept-version:1.1,1.0\nheart-beat:10000,10000\n\n\x00"
    ws.send(json.dumps([connect]))
    time.sleep(0.5)
    
    try:
        resp = ws.recv()
        print(f"  CONNECTED: {repr(resp)[:200]}")
    except:
        print("  Sem resposta CONNECTED, tentando mesmo assim...")
    
    # SUBSCRIBE
    topics = ["/topic/aviator", "/topic/aviator_core_inst1", "/queue/aviator", "/topic/crash"]
    for t in topics:
        sub = f"SUBSCRIBE\nid:0\ndestination:{t}\nack:auto\n\n\x00"
        ws.send(json.dumps([sub]))
        time.sleep(0.2)
    
    # Captura dados
    print("\nCapturando... (CTRL+C para parar)")
    crashes = 0
    start = time.time()
    while crashes < 10 and time.time() - start < 60:
        msg = ws.recv()
        # Tenta extrair JSON
        jm = re.search(r'\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}', msg)
        if jm:
            try:
                data = json.loads(jm.group())
                t = data.get("type", "?")
                if t == "crash":
                    crashes += 1
                    print(f"  ✅ CRASH: {data.get('crash_point')}x | round={data.get('round_id')}")
                elif t not in ["game_start", "bet"]:
                    print(f"  📨 {t}: {json.dumps(data)[:150]}")
            except: pass
        elif "MESSAGE" not in msg and "CONNECTED" not in msg:
            print(f"  📦 {repr(msg)[:100]}")
    
    ws.close()
    print(f"\n✅ {crashes} crashes capturados em {time.time()-start:.0f}s")
    
except Exception as e:
    print(f"❌ ERRO: {e}")
