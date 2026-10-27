#!/usr/bin/env python3
"""Corrida de Domiguard: encuentra sitios que suplantan a los clientes y les manda la alerta.

Corre cada hora completa y cada 5 minutos en modo rápido (--rapida: solo el paso 3, variantes por DNS).

1. Descarga la lista pública de PhishHunt (dominio público, CC0) y la guarda en la base.
2. Camino A: compara esos sitios con las marcas y dominios de cada cliente.
3. Camino B: genera variantes de los dominios oficiales de cada cliente y pregunta por DNS cuáles existen.
4. Para cada hallazgo nuevo consulta el registro del dominio (RDAP), calcula puntaje y prioridad
   y arma el paquete de evidencia.
5. Envía a cada cliente un correo con sus alertas nuevas y un CSV adjunto.
6. Revisa por DNS si los sitios de alertas abiertas siguen existiendo. No abre ningún sitio.

Solo usa la biblioteca estándar de Python 3.9+.

Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY
Opcionales para el correo: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
Prueba local sin base de datos:
    python scripts/actualizar.py --archivo ejemplo.json --clientes data/clientes_demo.json --seco
"""
import argparse
import csv
import io
import json
import math
import os
import re
import smtplib
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import detector as D

FEED_URL = "https://phishunt.io/feed.json"
# Segunda fuente de reportes: Phishing.Database (MIT), dominios nuevos de hoy, desde su repositorio en GitHub
# (phish.co.za respondía 503). Si cambia, la corrida sigue sin esta fuente y deja un aviso en el registro.
PD_URL = "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-NEW-today.txt"
RAIZ = Path(__file__).resolve().parent.parent
MODELO = json.loads((RAIZ / "web" / "model.json").read_text(encoding="utf-8"))
ACORTADORES = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd"}
TZ = ZoneInfo("America/Merida")
UA = {"User-Agent": "Domiguard-proyecto-academico/1.0"}


# ---------- utilidades de URL ----------
def desactivar(texto):
    """hxxp -> http, [.] -> . (la fuente puede venir desactivada)."""
    t = str(texto or "").strip()
    t = re.sub(r"^hxxp", "http", t, flags=re.I)
    return t.replace("[.]", ".").replace("(.)", ".")


def completa(url):
    u = desactivar(url)
    return u if re.match(r"^[a-z]+://", u, flags=re.I) else "http://" + u


def host_de(url):
    h = re.sub(r"^[a-z]+://", "", completa(url), flags=re.I)
    h = re.split(r"[/?#]", h)[0]
    h = h.rsplit("@", 1)[-1]
    return re.sub(r":\d+$", "", h).lower()


def id_de(host):
    return re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-")[:120]


# ---------- columnas del Excel y modelo ----------
def columnas_excel(url):
    u = completa(url)
    h = host_de(u)
    es_ip = bool(re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", h))
    return {
        "length_url": len(u),
        "qty_dot_url": u.count("."),
        "qty_hyphen_url": u.count("-"),
        "qty_underline_url": u.count("_"),
        "qty_at_url": u.count("@"),
        "domain_length": len(h),
        "domain_in_ip": int(es_ip),
        "time_domain_activation": -1,   # la fuente no lo entrega
        "time_domain_expiration": -1,
        "tls_ssl_certificate": int(u.lower().startswith("https")),
        "qty_redirects": -1,
        "url_shortened": int(h in ACORTADORES),
        "domain_google_index": -1,
        "email_in_url": int("@" in u),
        "phishing": 1,
    }


def puntaje(x, edad_dias=None):
    """Probabilidad de phishing (0 a 100). edad_dias=None significa 'sin dato'."""
    v = {
        "len_log": math.log1p(x["length_url"]),
        "dots": min(x["qty_dot_url"], 10),
        "hyph": min(x["qty_hyphen_url"], 10),
        "under": min(x["qty_underline_url"], 10),
        "at": int(x["qty_at_url"] > 0),
        "dom_len": min(x["domain_length"], 60),
        "ip": x["domain_in_ip"],
        "age_unk": int(edad_dias is None),
        "age_log": 0.0 if edad_dias is None else math.log1p(max(edad_dias, 0)),
        "ssl": x["tls_ssl_certificate"],
        "redir": max(min(x["qty_redirects"], 5), 0),
        "short": x["url_shortened"],
    }
    z = MODELO["b"]
    for f, mu, sd, c in zip(MODELO["features"], MODELO["mu"], MODELO["sd"], MODELO["coef"]):
        z += c * (v[f] - mu) / sd
    return round(100 / (1 + math.exp(-z)))


# ---------- fuente ----------
def leer_feed(archivo=None):
    if archivo:
        datos = json.loads(Path(archivo).read_text(encoding="utf-8"))
    else:
        req = urllib.request.Request(FEED_URL, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            datos = json.loads(r.read().decode("utf-8"))
    if isinstance(datos, dict):
        for k in ("data", "records", "items", "feed", "results"):
            if isinstance(datos.get(k), list):
                datos = datos[k]
                break
    if not isinstance(datos, list):
        raise ValueError("Formato inesperado del feed: " + str(type(datos)))
    return datos


def leer_phishing_database(archivo=None, maximo=20000):
    """Lista de dominios nuevos de hoy de Phishing.Database. Si falla devuelve [] (no detiene la corrida)."""
    try:
        if archivo:
            txt = Path(archivo).read_text(encoding="utf-8", errors="ignore")
        else:
            req = urllib.request.Request(PD_URL, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print("Aviso: no se pudo leer Phishing.Database:", e)
        return []
    hosts = []
    for linea in txt.splitlines():
        h = host_de(linea.strip())
        if h and "." in h and not linea.startswith("#"):
            hosts.append(h)
    return hosts[:maximo]


def a_fila(reg, hoy):
    url = reg.get("url") or reg.get("domain")
    if not url:
        return None
    h = host_de(url)
    if not h or "." not in h:
        return None
    x = columnas_excel(url)
    visto = reg.get("date") or reg.get("first_seen") or datetime.now(timezone.utc).isoformat()
    return {
        "id": id_de(h),
        "host": h,
        "marca": reg.get("company") or reg.get("brand") or "otros",
        "pais": reg.get("country"),
        "asn": str(reg.get("asn") or ""),
        "cert": reg.get("cert"),
        "visto_en": visto,
        "primer_dia": hoy,
        "ultimo_dia": hoy,
        "puntaje": puntaje(x),
        "tls": bool(x["tls_ssl_certificate"]),
        "fuente": reg.get("_fuente", "phishunt"),
        "x": x,
    }


def filas_que_tocan_clientes(hosts, clientes, hoy, fuente):
    """De una lista grande de dominios, solo se guardan los que nombran o imitan a algún cliente."""
    out = {}
    for h in hosts:
        if any(D.coincidencia(h, None, c) for c in clientes):
            f = a_fila({"url": h, "_fuente": fuente}, hoy)
            if f:
                out[f["id"]] = f
    return list(out.values())




# ---------- alertas ----------
def dias_desde(fecha_iso, hoy):
    try:
        return (datetime.fromisoformat(hoy).date() - datetime.fromisoformat(fecha_iso[:10]).date()).days
    except Exception:
        return None


def construir_alerta(sitio, cliente, coin, canal, en_fuente, resuelve, hoy, whois=None):
    """Arma la fila de `alertas` (puntaje, prioridad y evidencia incluidos)."""
    w = whois or {}
    edad = dias_desde(w["registrado"], hoy) if w.get("registrado") else None
    pts = puntaje(sitio["x"], edad) if edad is not None else sitio["puntaje"]
    prio = D.prioridad(coin, pts, en_fuente, resuelve, edad)
    evid = D.evidencia(sitio, coin, cliente, prio, w)
    # "fuente": un reporte externo ya lo señala como phishing. "revisar": existe y se parece, pero nadie lo ha reportado.
    evid["confirmacion"] = "fuente" if en_fuente else "revisar"
    return {
        "id": f"{cliente['id']}:{sitio['id']}",
        "cliente_id": cliente["id"],
        "sitio_id": sitio["id"],
        "host": sitio["host"],
        "canal": canal,
        "motivo": coin["motivo"],
        "similitud": coin["similitud"],
        "prioridad": prio,
        "estado": "nueva",
        "creada_en": hoy,
        "puntaje": pts,
        "tls": sitio.get("tls"),
        "pais": sitio.get("pais"),
        "asn": sitio.get("asn"),
        "dns_ok": resuelve,
        "enviada_en": None,
        "evidencia": evid,
        "_coin": coin,
    }


def alertas_desde_fuente(filas, clientes, hoy):
    """Camino A: sitios de la fuente de reportes que nombran o imitan a un cliente."""
    out = []
    for f in filas:
        marca = f["marca"] if f.get("marca") not in (None, "otros") else None
        for c in clientes:
            coin = D.coincidencia(f["host"], marca, c)
            if coin:
                out.append(construir_alerta(f, c, coin, "reporte", True, None, hoy))
    return out


def alertas_desde_variantes(clientes, hoy, resolver, maximo=900, limite_seg=240):
    """Camino B: variantes de los dominios oficiales que ya existen en DNS.

    `resolver(host)` devuelve True, False o None (como `resuelve`).
    Devuelve (sitios_nuevos, alertas, cuantas_variantes_se_vigilan_por_cliente).
    """
    candidatos, vigiladas = [], {}
    for c in clientes:
        n = 0
        for dom in c["dominios"]:
            for v in D.variantes(dom, maximo):
                candidatos.append((c, v))
                n += 1
        vigiladas[c["id"]] = n
    existen = set()
    with ThreadPoolExecutor(max_workers=32) as ex:
        futs = {ex.submit(resolver, v): (c["id"], v) for c, v in candidatos}
        try:
            for fut in as_completed(futs, timeout=limite_seg):
                if fut.result():
                    existen.add(futs[fut])
        except FuturesTimeout:
            print("Aviso: se acabó el tiempo de la búsqueda de variantes; se usan las que alcanzaron a responder.")
    por_id = {c["id"]: c for c in clientes}
    sitios, alertas = {}, []
    for (cid, v) in sorted(existen):
        c = por_id[cid]
        coin = D.coincidencia(v, None, c)
        if not coin:
            continue
        x = columnas_excel("https://" + v)      # no sabemos si tiene certificado; se supone que sí para no penalizar
        s = sitios.get(id_de(v)) or {
            "id": id_de(v), "host": v, "marca": c["marca"], "pais": None, "asn": "", "cert": None,
            "visto_en": datetime.now(timezone.utc).isoformat(), "primer_dia": hoy, "ultimo_dia": hoy,
            "puntaje": puntaje(x), "tls": None, "fuente": "busqueda", "dns_ok": True, "x": x}
        sitios[s["id"]] = s
        alertas.append(construir_alerta(s, c, coin, "busqueda", False, True, hoy))
    return list(sitios.values()), alertas, vigiladas


def enriquecer(alertas, sitios_por_id, clientes_por_id, hoy, maximo=40):
    """Consulta RDAP (edad del dominio, registrador, correo de abuso) y recalcula puntaje y prioridad."""
    hechas = 0
    for i, a in enumerate(alertas):
        if hechas >= maximo:
            break
        w = D.rdap(a["host"])
        hechas += 1
        if not w:
            continue
        s = sitios_por_id[a["sitio_id"]]
        nueva = construir_alerta(s, clientes_por_id[a["cliente_id"]], a["_coin"], a["canal"],
                                 a["canal"] == "reporte", a["dns_ok"], hoy, w)
        alertas[i] = nueva
    return hechas


def para_base(a):
    return {k: v for k, v in a.items() if not k.startswith("_")}


# ---------- correo ----------
def armar_correo(cliente, alertas, remitente, destino, hoy):
    orden = {"alta": 0, "media": 1, "baja": 2}
    alertas = sorted(alertas, key=lambda a: (orden[a["prioridad"]], -a["puntaje"]))
    altas = sum(1 for a in alertas if a["prioridad"] == "alta")
    m = EmailMessage()
    m["Subject"] = f"Domiguard: {len(alertas)} sitio(s) nuevo(s) que suplantan a {cliente['nombre']}" + (f" ({altas} de prioridad alta)" if altas else "")
    m["From"], m["To"] = remitente, destino
    cuerpo = [f"Hola, equipo de seguridad de {cliente['nombre']}:", "",
              f"Hoy ({hoy}) encontramos {len(alertas)} sitio(s) nuevo(s) que parecen suplantar a su marca. "
              "Las direcciones van desactivadas para que nadie entre por accidente; el archivo adjunto trae "
              "las direcciones completas, el registrador y el correo de abuso cuando están disponibles.", ""]
    for a in alertas[:15]:
        e = a["evidencia"]
        cuerpo.append(f"[{a['prioridad'].upper()}] {D.desactivar(a['host'])}")
        cuerpo.append(f"    Por qué: {a['motivo']}.")
        cuerpo.append("    Estado: " + ("lo señala un reporte externo de phishing." if e.get("confirmacion") == "fuente"
                                        else "por revisar: existe y se parece, pero todavía nadie lo reporta."))
        if e.get("registrado"):
            cuerpo.append(f"    Dominio registrado el {e['registrado']}.")
        cuerpo.append("")
    if len(alertas) > 15:
        cuerpo.append(f"... y {len(alertas) - 15} más en el archivo adjunto y en su panel.")
    cuerpo += ["", "Ustedes deciden qué hacer con cada sitio. Domiguard no contacta ni intenta dar de baja los sitios.",
               "Si una alerta es un falso positivo, respondan a este correo y la marcamos así."]
    m.set_content("\n".join(cuerpo))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["prioridad", "dominio", "motivo", "puntaje", "canal", "pais", "registrado", "registrador", "correo_abuso", "plataforma"])
    for a in alertas:
        e = a["evidencia"]
        w.writerow([a["prioridad"], a["host"], a["motivo"].replace("[.]", "."), a["puntaje"], a["canal"], a.get("pais") or "",
                    e.get("registrado") or "", e.get("registrador") or "", e.get("correo_abuso") or "", e.get("plataforma") or ""])
    m.add_attachment(buf.getvalue().encode("utf-8-sig"), maintype="text", subtype="csv", filename=f"alertas_{hoy}.csv")
    return m


def enviar_correos(mensajes):
    host = os.environ.get("SMTP_HOST")
    if not host:
        return 0
    n = 0
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT") or 587), timeout=60) as s:
        s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
        for m in mensajes:
            s.send_message(m)
            n += 1
    return n


# ---------- Supabase (API REST) ----------
class Base:
    def __init__(self, url, llave):
        self.url = url.rstrip("/") + "/rest/v1"
        self.h = {"apikey": llave, "Content-Type": "application/json"}
        # Llaves antiguas (JWT, empiezan con "eyJ") van también en Authorization.
        # Las nuevas (sb_secret_...) solo en apikey: Supabase las rechaza en Authorization.
        if llave.startswith("eyJ"):
            self.h["Authorization"] = "Bearer " + llave

    def _pedir(self, metodo, ruta, cuerpo=None, extra=None):
        h = dict(self.h)
        h.update(extra or {})
        data = json.dumps(cuerpo).encode() if cuerpo is not None else None
        req = urllib.request.Request(self.url + ruta, data=data, headers=h, method=metodo)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{metodo} {ruta}: {e.code} {e.read().decode()[:300]}")

    def todos(self, ruta):
        filas, desde = [], 0
        while True:
            lote = self._pedir("GET", ruta, extra={"Range": f"{desde}-{desde+999}"})
            filas += lote
            if len(lote) < 1000:
                return filas
            desde += 1000

    def ids(self, tabla):
        return {r["id"] for r in self.todos(f"/{tabla}?select=id")}

    def insertar(self, tabla, filas):
        # ignore-duplicates: si dos corridas coinciden, la segunda no falla
        for i in range(0, len(filas), 200):
            self._pedir("POST", f"/{tabla}?on_conflict=id", filas[i:i+200],
                        {"Prefer": "resolution=ignore-duplicates,return=minimal"})

    def actualizar(self, tabla, ids, cambios):
        """PATCH de las filas con esos ids. (Un upsert parcial fallaría por las columnas obligatorias.)"""
        ids = list(ids)
        for i in range(0, len(ids), 40):
            lista = ",".join('"' + x + '"' for x in ids[i:i+40])
            filtro = urllib.parse.quote(lista, safe='(),"')
            self._pedir("PATCH", "/" + tabla + "?id=in.(" + filtro + ")", cambios,
                        {"Prefer": "return=minimal"})

    def clientes(self):
        return self._pedir("GET", "/clientes?activo=eq.true&select=*")

    def contactos(self):
        out = {}
        for r in self._pedir("GET", "/clientes_contacto?select=cliente_id,correo"):
            out.setdefault(r["cliente_id"], []).append(r["correo"])
        return out

    def para_revisar_dns(self, tabla, filtro, limite=300):
        return self._pedir("GET", f"/{tabla}?select=id,host&{filtro}&order=dns_revisado.asc.nullsfirst&limit={limite}")

    def guardar_dns(self, tabla, resultados):
        ahora = datetime.now(timezone.utc).isoformat()
        arriba = [i for i, ok in resultados if ok]
        abajo = [i for i, ok in resultados if not ok]
        if arriba:
            self.actualizar(tabla, arriba, {"dns_ok": True, "dns_revisado": ahora})
        if abajo:
            self.actualizar(tabla, abajo, {"dns_ok": False, "dns_revisado": ahora})

    def estado(self, datos):
        self._pedir("POST", "/estado?on_conflict=id", [{"id": "ultima", "datos": datos}],
                    {"Prefer": "resolution=merge-duplicates,return=minimal"})

    def estado_actual(self):
        r = self._pedir("GET", "/estado?id=eq.ultima&select=datos")
        return (r[0]["datos"] if r else {}) or {}

    def total(self, tabla="sitios"):
        req = urllib.request.Request(self.url + f"/{tabla}?select=id", method="HEAD",
                                     headers={**self.h, "Prefer": "count=exact", "Range": "0-0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get("Content-Range", "*/0").split("/")[-1])


def resuelve(host):
    """Revisión por DNS: no se contacta el sitio, solo se pregunta si el nombre existe."""
    try:
        socket.getaddrinfo(host, None)
        return True
    except socket.gaierror as e:
        # Error temporal de DNS no cuenta como caído.
        return None if e.errno in (socket.EAI_AGAIN,) else False
    except Exception:
        return None


def revisar_dns(filas, maximo_seg=150):
    out = []
    with ThreadPoolExecutor(max_workers=24) as ex:
        futs = {ex.submit(resuelve, f["host"]): f["id"] for f in filas}
        try:
            for fut in as_completed(futs, timeout=maximo_seg):
                ok = fut.result()
                if ok is not None:
                    out.append((futs[fut], ok))
        except FuturesTimeout:
            pass
    return out


MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", help="usar un feed.json local en vez de descargarlo")
    ap.add_argument("--clientes", help="clientes desde un JSON local (solo con --seco)")
    ap.add_argument("--seco", action="store_true", help="no escribir en la base; solo mostrar")
    ap.add_argument("--max", type=int, default=2000, help="máximo de registros por corrida")
    ap.add_argument("--max-rdap", type=int, default=40, help="máximo de consultas RDAP por corrida")
    ap.add_argument("--rapida", action="store_true",
                    help="solo búsqueda de variantes por DNS (sin reportes públicos ni revisión de alertas abiertas)")
    a = ap.parse_args()

    ahora = datetime.now(TZ)
    hoy = ahora.date().isoformat()
    # En la búsqueda rápida (cada 5 minutos) no se bajan los reportes públicos: cambian poco y son servicios gratuitos.
    registros = [] if a.rapida else leer_feed(a.archivo)[: a.max]
    filas = {}
    for r in registros:
        f = a_fila(r, hoy)
        if f:
            filas[f["id"]] = f
    filas = list(filas.values())
    print(f"Feed: {len(registros)} registros, {len(filas)} válidos")

    if a.seco:
        clientes = json.loads(Path(a.clientes).read_text(encoding="utf-8")) if a.clientes else []
        al = alertas_desde_fuente(filas, clientes, hoy)
        for x in al:
            print(x["prioridad"], x["cliente_id"], x["host"], "|", x["motivo"])
        print(f"Alertas por reportes: {len(al)} (en seco: no se consulta DNS ni RDAP ni se envía correo)")
        return 0

    # Al pegar un secreto en GitHub es fácil que se cuelen espacios u otra línea: se toma solo la clave.
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    crudo = os.environ.get("SUPABASE_SERVICE_KEY") or ""
    m = re.search(r"sb_secret_[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+", crudo)
    llave = m.group(0) if m else ""
    if not url or not crudo.strip():
        print("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY", file=sys.stderr)
        return 2
    if not llave:
        # No se imprime ni un pedazo de la clave: solo de qué tipo parece, para saber qué se pegó.
        t = crudo.strip()
        tipo = ("la clave pública (sb_publishable_), no la secreta" if t.startswith("sb_publishable_") else
                "una dirección web, no una clave" if t.startswith("http") else
                "un token de GitHub, no la clave de Supabase" if t.startswith(("ghp_", "github_pat_")) else
                "un texto que no es clave de Supabase")
        print(f"SUPABASE_SERVICE_KEY no parece una clave secreta de Supabase (debe empezar con sb_secret_ o eyJ): "
              f"parece {tipo}. Tiene {len(crudo.splitlines())} línea(s).", file=sys.stderr)
        return 2
    if llave != crudo.strip():
        print(f"Aviso: SUPABASE_SERVICE_KEY traía texto de más ({len(crudo.splitlines())} línea(s)); se usó solo la clave.")
    db = Base(url, llave)
    try:
        # 1. fuente de reportes -> base de sitios
        existentes = db.ids("sitios")
        nuevos = [f for f in filas if f["id"] not in existentes]
        repetidos = [f["id"] for f in filas if f["id"] in existentes]
        db.insertar("sitios", nuevos)
        if repetidos:
            db.actualizar("sitios", repetidos, {"ultimo_dia": hoy})

        # 2. alertas por cliente (camino A y camino B)
        clientes = db.clientes()
        por_cliente = {c["id"]: c for c in clientes}
        filas_pd = [] if a.rapida else filas_que_tocan_clientes(leer_phishing_database(), clientes, hoy, "phishing-database")
        existentes = db.ids("sitios")
        db.insertar("sitios", [f for f in filas_pd if f["id"] not in existentes])
        filas += [f for f in filas_pd if f["id"] not in {x["id"] for x in filas}]
        alertas = alertas_desde_fuente(filas, clientes, hoy)
        sitios_b, alertas_b, vigiladas = alertas_desde_variantes(clientes, hoy, resuelve)
        existentes = db.ids("sitios")
        db.insertar("sitios", [s for s in sitios_b if s["id"] not in existentes])
        alertas += alertas_b
        for c in clientes:
            db.actualizar("clientes", [c["id"]], {"variantes_vigiladas": vigiladas.get(c["id"], 0)})

        # 3. solo lo que no se había alertado antes
        ya = db.ids("alertas")
        alertas_nuevas = [x for x in alertas if x["id"] not in ya]
        por_sitio = {s["id"]: s for s in filas + sitios_b}
        enriquecer(alertas_nuevas, por_sitio, por_cliente, hoy, a.max_rdap)
        db.insertar("alertas", [para_base(x) for x in alertas_nuevas])

        # 4. correo a cada cliente
        contactos, mensajes, avisadas = db.contactos(), [], []
        remitente = os.environ.get("SMTP_FROM") or "alertas@domiguard.example"
        for c in clientes:
            mias = [x for x in alertas_nuevas if x["cliente_id"] == c["id"]]
            if mias and contactos.get(c["id"]):
                for destino in contactos[c["id"]]:
                    mensajes.append(armar_correo(c, mias, remitente, destino, hoy))
                avisadas += [x["id"] for x in mias]
        enviados = enviar_correos(mensajes) if mensajes else 0
        if enviados:
            db.actualizar("alertas", avisadas, {"estado": "enviada", "enviada_en": datetime.now(timezone.utc).isoformat()})

        # 5. ¿siguen vivos? (solo DNS; en la búsqueda rápida se deja para la corrida completa)
        dns_a = []
        if not a.rapida:
            reciente = (ahora.date() - timedelta(days=3)).isoformat()
            abiertas = db.para_revisar_dns("alertas", "estado=in.(nueva,enviada,en_baja)")
            dns_a = revisar_dns(abiertas)
            db.guardar_dns("alertas", dns_a)
            dns_s = revisar_dns(db.para_revisar_dns("sitios", f"ultimo_dia=gte.{reciente}", 200))
            db.guardar_dns("sitios", dns_s)

        # Se conservan los datos de la última corrida completa; un error anterior se borra porque esta salió bien.
        previo = db.estado_actual()
        for k in ("ultimo_error", "ultimo_error_en"):
            previo.pop(k, None)
        datos = {**previo,
                 "ultima_corrida": datetime.now(timezone.utc).isoformat(),
                 "dia": hoy,
                 "etiqueta": f"{ahora.day} {MESES[ahora.month-1]} {ahora.year}, {ahora:%H:%M} (hora de Mérida)",
                 "modo": "rapida" if a.rapida else "completa",
                 "corridas": int(previo.get("corridas", 0)) + 1,
                 "alertas_nuevas": len(alertas_nuevas),
                 "correos_enviados": enviados,
                 "variantes_vigiladas": sum(vigiladas.values()),
                 "total": db.total()}
        if not a.rapida:
            datos.update({"fuente": "PhishHunt (CC0), Phishing.Database (MIT) y búsqueda de variantes por DNS",
                          "ultima_completa": datos["ultima_corrida"],
                          "nuevos": len(nuevos),
                          "dns_caidos": sum(1 for _, ok in dns_a if not ok)})
        db.estado(datos)
        print(f"Modo: {datos['modo']}  Sitios nuevos: {len(nuevos)}  Alertas nuevas: {len(alertas_nuevas)}  "
              f"Correos: {enviados}  Variantes vigiladas: {sum(vigiladas.values())}")
        if mensajes and not enviados:
            print("Hay alertas para avisar pero no está configurado SMTP_HOST: quedan visibles en el panel.")
        return 0
    except Exception as e:
        try:
            db.estado({**(db.estado_actual()), "ultimo_error": str(e)[:300],
                       "ultimo_error_en": datetime.now(timezone.utc).isoformat()})
        except Exception:
            pass
        print("Error:", e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
