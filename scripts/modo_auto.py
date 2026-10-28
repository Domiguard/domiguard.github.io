"""Imprime "si" si toca corrida rápida y "no" si toca completa (modo auto del workflow).
Completa cuando la última completa fue hace 55 minutos o más, o si no se puede saber. Solo biblioteca estándar."""
import json
import os
import re
import urllib.request
from datetime import datetime, timezone

try:
    url = os.environ["SUPABASE_URL"].strip().rstrip("/")
    llave = re.search(r"sb_secret_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-\.]+", os.environ["SUPABASE_SERVICE_KEY"]).group(0)
    h = {"apikey": llave}
    if llave.startswith("eyJ"):
        h["Authorization"] = "Bearer " + llave
    req = urllib.request.Request(url + "/rest/v1/estado?id=eq.ultima&select=datos", headers=h)
    with urllib.request.urlopen(req, timeout=20) as r:
        ultima = json.loads(r.read())[0]["datos"].get("ultima_completa")
    hace = (datetime.now(timezone.utc) - datetime.fromisoformat(ultima)).total_seconds() / 60
    print("si" if hace < 55 else "no")
except Exception:
    print("no")
