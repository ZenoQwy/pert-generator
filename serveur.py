#!/usr/bin/env python3
"""
Lance un petit serveur local pour ouvrir pert.html sans le blocage de sécurité
'file://' des navigateurs (qui empêche un fichier HTML ouvert en double-clic de
charger ses propres fichiers .js voisins).

Utilisation :
  1. Place ce fichier dans le même dossier que pert.html, pert-engine.js,
     pert-render.js et pert-app.js.
  2. Lance-le :
       python3 serveur.py
     (sur certains systèmes la commande est "python" au lieu de "python3")
  3. Ouvre l'adresse affichée dans le terminal (en général
     http://localhost:8000/pert.html) dans ton navigateur.
  4. Pour arrêter le serveur : Ctrl+C dans le terminal.
"""

import http.server
import socketserver
import webbrowser
import os

PORT = 8000

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # évite les soucis de cache pendant le développement
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def main():
    port = PORT
    while True:
        try:
            with socketserver.TCPServer(("", port), Handler) as httpd:
                url = f"http://localhost:{port}/pert.html"
                print(f"Serveur démarré : {url}")
                print("Appuie sur Ctrl+C pour arrêter.")
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
                httpd.serve_forever()
            break
        except OSError:
            # port déjà utilisé, on essaie le suivant
            port += 1
            if port > PORT + 20:
                raise

if __name__ == "__main__":
    main()
