@echo off
title Painel Aviator do Jhow
echo ============================================
echo   Painel Aviator do Jhow - Iniciando...
echo ============================================
echo.
cd /d "%~dp0"
echo [1/2] Instalando dependencias...
pip install -r requirements.txt -q
echo.
echo [2/2] Iniciando servidor...
echo.
echo Acesse: http://localhost:5000
echo Login admin: admin@painel.com / admin123
echo.
python app.py
pause
