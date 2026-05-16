"""Bridge - importa o servidor do backend para compatibilidade com Render"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from server import app
