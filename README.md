# Painel Aviator


 Seu login master do painel:

https://painel-aviator.onrender.com/login

  Email: marcosduarte356@gmail.com
  Senha: amordedeus123@

Painel em tempo real para o jogo Aviator com histórico de 15.000 velas.

## Deploy no Render

1. Crie uma conta em https://render.com
2. Conecte seu GitHub
3. Crie um **Web Service**
4. Selecione este repositório
5. Configure:
   - **Name**: `painel-aviator`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -u app.py`
6. Adicione env vars:
   - `SIMULAR_DADOS`: `true` (ou `false` para dados reais)
   - `INTERVALO_RODADA`: `8`
7. Deploy!

## Modo Real (Sorte da Bet)

Para conectar na Sorte da Bet em tempo real:
1. Abra o site da Sorte da Bet
2. Abra o DevTools > Network > WS
3. Copie a URL do WebSocket
4. Configure `WS_SORTE_BET_URL` no Render
5. Mude `SIMULAR_DADOS` para `false`

## Extensão Kiwi Browser

1. Abra o Kiwi Browser
2. Vá em Menu > Extensões
3. Ative "Modo Desenvolvedor"
4. Clique em "Carregar sem compactação"
5. Selecione a pasta `extension/`
6. Configure a URL do seu servidor Render
