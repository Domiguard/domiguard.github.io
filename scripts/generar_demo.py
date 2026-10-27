#!/usr/bin/env python3
"""Regenera web/data/demo.json (datos de demostración de la página) con el mismo motor de detección.

Toma los sitios que ya están en demo.json (30 registros reales de la fuente pública), los compara con los
clientes de data/clientes_demo.json y escribe las alertas. No consulta DNS ni RDAP.
    python scripts/generar_demo.py
"""
import json
from pathlib import Path

import actualizar as A
import detector as D

RAIZ = Path(__file__).resolve().parent.parent
ruta = RAIZ / "web" / "data" / "demo.json"
demo = json.loads(ruta.read_text(encoding="utf-8"))
clientes = json.loads((RAIZ / "data" / "clientes_demo.json").read_text(encoding="utf-8"))
hoy = demo["estado"]["dia"]

alertas = [A.para_base(a) for a in A.alertas_desde_fuente(demo["sitios"], clientes, hoy)]
primer_dia = {s["id"]: s["primer_dia"] for s in demo["sitios"]}
for a in alertas:                       # en la demo, cada alerta lleva el día real en que apareció el sitio
    a["creada_en"] = primer_dia.get(a["sitio_id"], hoy)
vigiladas = {c["id"]: sum(len(D.variantes(d)) for d in c["dominios"]) for c in clientes}
demo["clientes"] = [{**c, "variantes_vigiladas": vigiladas[c["id"]]} for c in clientes]
demo["alertas"] = alertas
demo["estado"].update({
    "alertas_nuevas": len(alertas),
    "variantes_vigiladas": sum(vigiladas.values()),
    "fuente": "PhishHunt (CC0) y búsqueda de variantes por DNS",
})
ruta.write_text(json.dumps(demo, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(alertas), "alertas;", sum(vigiladas.values()), "variantes vigiladas")
for a in alertas:
    print(a["prioridad"], a["cliente_id"], a["host"], "|", a["motivo"], "|", a["puntaje"])
