@echo off
echo ========================================
echo  TESTADOR DE API SPRIBE
echo ========================================
echo.
echo 1. Abra o jogo Aviator no site da bet
echo 2. Pressione F12 > Network > WS
echo 3. Copie a URL do WebSocket
echo 4. Cole no arquivo TUTORIAL.txt
echo 5. Salve o TUTORIAL.txt
echo 6. Volte aqui e pressione qualquer tecla
echo.
pause
cd /d C:\PROJETOS\AVIATOR_LOCAL
python testar_api.py
pause
