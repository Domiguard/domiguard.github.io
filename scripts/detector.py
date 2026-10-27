"""Motor de detección de Domiguard: decide si un sitio suplanta a la marca de un cliente.

Hay dos caminos para encontrar candidatos (los usa actualizar.py):
  A. Reportes: sitios de phishing que publican fuentes abiertas y que nombran o imitan al cliente.
  B. Búsqueda activa: se generan variantes de los dominios oficiales del cliente (letras cambiadas,
     guiones, palabras como "seguro" o "login", otras terminaciones) y se pregunta por DNS cuáles
     ya existen.

Nunca se abre ni se contacta un sitio sospechoso: solo se hacen consultas DNS y de registro (RDAP).
Solo usa la biblioteca estándar de Python 3.9+.
"""
import json
import re
import time
import urllib.request

UA = {"User-Agent": "Domiguard-proyecto-academico/1.0", "Accept": "application/rdap+json, application/json"}

# Sufijos de dos partes frecuentes (para encontrar el dominio registrable sin depender de una lista externa).
SEGUNDO_NIVEL = {"com", "org", "net", "gob", "edu", "co", "gov", "ac", "or", "ne"}
# Plataformas gratuitas: el sitio falso vive en un subdominio y la baja se pide a la plataforma.
# Incluye DNS dinámico (duckdns, no-ip...) y túneles: su registro RDAP es el del servicio, no el del sitio falso.
PLATAFORMAS = (
    "vercel.app", "blogspot.com", "netlify.app", "github.io", "pages.dev", "web.app", "firebaseapp.com",
    "herokuapp.com", "weebly.com", "wixsite.com", "typedream.app", "glitch.me", "onrender.com",
    "workers.dev", "000webhostapp.com", "webflow.io", "framer.app", "carrd.co", "godaddysites.com",
    "duckdns.org", "ddns.net", "hopto.org", "zapto.org", "sytes.net", "no-ip.biz", "no-ip.org", "dynu.net",
    "freeddns.org", "ngrok-free.app", "ngrok.io", "trycloudflare.com", "r2.dev", "azurewebsites.net",
    "appspot.com", "replit.app", "repl.co", "surge.sh", "wordpress.com", "dothome.co.kr",
)
PALABRAS_TIPICAS = ["seguro", "login", "acceso", "verifica", "soporte", "app", "clientes", "banca", "online"]
TERMINACIONES = ["com", "net", "org", "mx", "co", "online", "xyz", "info", "site", "top"]
CONFUSOS = {"o": ["0"], "l": ["1", "i"], "i": ["1", "l"], "e": ["3"], "a": ["4"], "s": ["5"],
            "m": ["rn"], "w": ["vv"], "d": ["cl"], "g": ["q"], "u": ["v"], "n": ["m"]}


# ---------- nombres de dominio ----------
def registrable(host):
    """(etiqueta, dominio_completo, plataforma_o_None) del dominio registrable de un host."""
    h = host.lower().strip(".")
    for p in PLATAFORMAS:
        if h == p or h.endswith("." + p):
            return p.split(".")[0], p, p
    partes = h.split(".")
    if len(partes) >= 3 and partes[-2] in SEGUNDO_NIVEL and len(partes[-1]) == 2:
        return partes[-3], ".".join(partes[-3:]), None
    if len(partes) >= 2:
        return partes[-2], ".".join(partes[-2:]), None
    return h, h, None


def esqueleto(s):
    """Reduce un texto a una forma en la que las letras confundibles quedan iguales."""
    s = s.lower().replace("-", "").replace("_", "")
    s = s.replace("rn", "m").replace("vv", "w").replace("cl", "d")
    tabla = str.maketrans({"1": "l", "i": "l", "|": "l", "0": "o", "3": "e", "5": "s", "4": "a",
                           "7": "t", "8": "b", "$": "s", "@": "a", "q": "g", "v": "u"})
    return s.translate(tabla)


def levenshtein(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def es_oficial(host, cliente):
    h = host.lower().strip(".")
    return any(h == d or h.endswith("." + d) for d in cliente["dominios"])


# ---------- ¿este sitio suplanta a este cliente? ----------
def coincidencia(host, marca_fuente, cliente):
    """Devuelve un dict con el motivo si el sitio parece suplantar al cliente, o None.

    host          dominio del sitio sospechoso
    marca_fuente  marca que la fuente dice que se suplanta (puede ser None)
    cliente       {"id","nombre","marca","palabras","dominios"}
    """
    if es_oficial(host, cliente):
        return None
    etiqueta, _completo, plataforma = registrable(host)
    palabras = [esqueleto(p) for p in (cliente.get("palabras") or [cliente["marca"]]) if p]
    partes = [p for p in re.split(r"[.\-_]", host.lower()) if p]
    sk_host = esqueleto(host.replace(".", ""))
    sk_partes = [esqueleto(p) for p in partes]

    # 1. Parecido con un dominio oficial (se mide sobre el dominio registrable, no en plataformas gratuitas)
    mejor = None
    if not plataforma:
        for oficial in cliente["dominios"]:
            et_of = registrable(oficial)[0]
            d = levenshtein(etiqueta, et_of)
            d_sk = levenshtein(esqueleto(etiqueta), esqueleto(et_of))
            dm = min(d, d_sk)
            limite = 1 if len(et_of) < 7 else 2          # nombres cortos: umbral más estricto
            if 0 < dm <= limite or (dm == 0 and etiqueta != et_of):   # dm == 0 con otro texto: letras confundibles
                sim = round((1 - dm / max(len(etiqueta), len(et_of))) * 100)
                if mejor is None or sim > mejor["similitud"]:
                    mejor = {"tipo": "parecido", "dist": dm, "similitud": sim, "oficial": oficial,
                             "motivo": f"Dominio casi igual a {oficial.replace('.', '[.]')}: "
                                       f"{dm if dm else 'solo'} {'carácter(es) de diferencia' if dm else 'letras confundibles (por ejemplo 1 por l)'}"}
            elif dm == 0 and etiqueta == et_of:
                # mismo nombre con otra terminación (santander.xyz frente a santander.com.mx)
                mejor = {"tipo": "otra_terminacion", "dist": 0, "similitud": 90, "oficial": oficial,
                         "motivo": f"Mismo nombre que {oficial.replace('.', '[.]')} con otra terminación"}
    if mejor:
        mejor["plataforma"] = plataforma
        return mejor

    # 2. Usa el nombre de la marca dentro del dominio
    crudas = [p.lower() for p in (cliente.get("palabras") or [cliente["marca"]]) if p]
    for p, cruda in zip(palabras, crudas):
        if len(p) < 3:
            continue
        # Nombres cortos (bbva, hsbc): la parte debe ser la marca tal cual. Igualando letras confundibles
        # (8 por b, 4 por a) salen coincidencias al azar entre cientos de miles de dominios.
        en_partes = any(sp == cruda for sp in partes) if len(p) < 5 else any(sp == p for sp in sk_partes)
        en_texto = len(p) >= 5 and p in sk_host
        if en_partes or en_texto:
            return {"tipo": "marca_en_dominio", "dist": None, "similitud": 70, "oficial": cliente["dominios"][0],
                    "plataforma": plataforma,
                    "motivo": "Usa el nombre de la marca en la dirección" +
                              (f" y vive en una plataforma gratuita ({plataforma.replace('.', '[.]')})" if plataforma else "")}

    # 3. La fuente dice que suplanta a esta marca
    if marca_fuente and esqueleto(marca_fuente) == esqueleto(cliente["marca"]):
        return {"tipo": "fuente", "dist": None, "similitud": 50, "oficial": cliente["dominios"][0],
                "plataforma": plataforma,
                "motivo": "La fuente de reportes lo señala como suplantación de la marca"}
    return None


def prioridad(coin, puntaje, en_fuente, resuelve, edad_dias=None):
    """alta / media / baja. Reglas simples y explicables:
    Con reporte externo (camino A):
      alta   el modelo da 70 o más, o se parece al oficial / usa la marca y el modelo da 55 o más.
      media  el resto.
    Sin reporte, la variante solo existe en DNS (camino B):
      alta   se parece al oficial (o es otra terminación), existe y se registró hace 60 días o menos.
      media  usa la marca y se registró hace 60 días o menos.
      baja   sin esas señales: puede ser una compra defensiva del banco o un dominio ajeno de años."""
    parecido = coin["tipo"] in ("parecido", "otra_terminacion")
    if en_fuente:
        if puntaje >= 70:
            return "alta"
        if coin["tipo"] in ("parecido", "marca_en_dominio", "otra_terminacion") and puntaje >= 55:
            return "alta"
        return "media"
    reciente = edad_dias is not None and edad_dias <= 60
    if parecido and resuelve and reciente:
        return "alta"
    if reciente:
        return "media"
    return "baja"


# ---------- búsqueda activa: variantes de un dominio oficial ----------
try:                                   # dnstwist (Apache-2.0): motor de permutaciones muy completo, opcional
    import dnstwist as _dnstwist
except Exception:
    _dnstwist = None


def variantes_dnstwist(dominio, max_homoglifos=300):
    """Variantes que genera dnstwist (omisiones, bitsquatting, homoglifos, subdominios...). [] si no está instalado.
    Los homoglifos son miles por dominio, así que se limita su número."""
    if _dnstwist is None:
        return []
    try:
        f = _dnstwist.Fuzzer(dominio)
        f.generate()
        res, homo = [], 0
        for p in f.permutations():
            if p["fuzzer"] == "*original":
                continue
            if p["fuzzer"] == "homoglyph":
                homo += 1
                if homo > max_homoglifos:
                    continue
            res.append(p["domain"].lower())
        return res
    except Exception:
        return []

def _valida(etiqueta):
    return 1 <= len(etiqueta) <= 63 and re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?", etiqueta) is not None


def variantes(dominio, maximo=900):
    """Dominios parecidos a `dominio` (lista ordenada y sin repetidos). No incluye el original."""
    etiqueta, completo, _ = registrable(dominio)
    sufijo = completo[len(etiqueta) + 1:] or "com"
    out = []

    def agrega(et, suf=None):
        if et and (et != etiqueta or (suf and suf != sufijo)):
            if _valida(et):
                out.append(f"{et}.{suf or sufijo}")

    n = len(etiqueta)
    for i in range(n):                                       # omisión
        agrega(etiqueta[:i] + etiqueta[i + 1:])
    for i in range(n):                                       # repetición
        agrega(etiqueta[:i + 1] + etiqueta[i:])
    for i in range(n - 1):                                   # letras intercambiadas
        if etiqueta[i] != etiqueta[i + 1]:
            agrega(etiqueta[:i] + etiqueta[i + 1] + etiqueta[i] + etiqueta[i + 2:])
    for i, c in enumerate(etiqueta):                         # letras confundibles
        for r in CONFUSOS.get(c, []):
            agrega(etiqueta[:i] + r + etiqueta[i + 1:])
    for i in range(1, n):                                    # guion en medio
        agrega(etiqueta[:i] + "-" + etiqueta[i:])
    for k in PALABRAS_TIPICAS:                               # palabras típicas de engaño
        for et in (etiqueta + k, k + etiqueta, f"{etiqueta}-{k}", f"{k}-{etiqueta}"):
            agrega(et)
    for t in TERMINACIONES:                                  # otra terminación
        if t != sufijo:
            agrega(etiqueta, t)
    vistos, res = set(), []
    for d in out + variantes_dnstwist(dominio):
        if d != completo and d not in vistos and all(_valida(x) for x in d.split(".")[:1]):
            vistos.add(d)
            res.append(d)
    return res[:maximo]


# ---------- registro del dominio (RDAP): edad y a quién pedir la baja ----------
def _vcard(ent, campo):
    for it in (ent.get("vcardArray") or [None, []])[1]:
        if it and it[0] == campo:
            return it[3]
    return None


def rdap(host, pausa=0.4):
    """Consulta RDAP del dominio registrable. Devuelve dict (puede venir vacío). No contacta el sitio."""
    _, dom, plataforma = registrable(host)
    if plataforma:
        return {}
    try:
        req = urllib.request.Request("https://rdap.org/domain/" + dom, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}
    finally:
        time.sleep(pausa)
    out = {}
    for ev in d.get("events", []):
        if ev.get("eventAction") == "registration":
            out["registrado"] = str(ev.get("eventDate", ""))[:10]
    def busca(entidades):
        for e in entidades or []:
            roles = e.get("roles", [])
            if "registrar" in roles:
                out.setdefault("registrador", _vcard(e, "fn"))
            if "abuse" in roles:
                out.setdefault("correo_abuso", _vcard(e, "email"))
            busca(e.get("entities"))
    busca(d.get("entities"))
    out["servidores"] = [n.get("ldhName") for n in d.get("nameservers", [])][:4]
    return {k: v for k, v in out.items() if v}


# ---------- paquete de evidencia ----------
def desactivar(host):
    return "hxxp://" + host.replace(".", "[.]")


def evidencia(sitio, coin, cliente, prio, whois=None):
    """Todo lo que el equipo de seguridad necesita para pedir la baja."""
    w = whois or {}
    plataforma = coin.get("plataforma")
    pasos = []
    if plataforma:
        pasos.append(f"Reporta el sitio a la plataforma ({plataforma.replace('.', '[.]')}) como suplantación de identidad: es quien puede quitarlo.")
    else:
        pasos.append("Pide la baja al registrador del dominio" + (f" ({w['registrador']})" if w.get("registrador") else "") +
                     (f", correo de abuso: {w['correo_abuso']}" if w.get("correo_abuso") else "") + ", y a la empresa de alojamiento.")
    pasos.append("Mientras tanto, repórtalo a Google Safe Browsing y a Microsoft SmartScreen para que los navegadores lo bloqueen.")
    pasos.append("Avisa a tus clientes y a tu equipo de atención si el sitio ya circula por correo, SMS o redes.")
    return {
        "oficial": coin.get("oficial"),
        "tipo": coin["tipo"],
        "plataforma": plataforma,
        "registrado": w.get("registrado"),
        "registrador": w.get("registrador"),
        "correo_abuso": w.get("correo_abuso"),
        "servidores": w.get("servidores"),
        "pasos": pasos,
    }


def reporte_baja(host, cliente, motivo, evid):
    """Texto listo para pegar en el formulario de abuso de un registrador o plataforma (dominio completo)."""
    lineas = [
        "Asunto: Solicitud de baja por suplantación de identidad (phishing)",
        "",
        f"Solicitamos la baja del dominio {host}, que suplanta a {cliente['nombre']}.",
        f"Sitio legítimo de la empresa: {evid.get('oficial') or ', '.join(cliente['dominios'])}.",
        f"Motivo: {motivo.replace('[.]', '.')}.",
    ]
    if evid.get("registrado"):
        lineas.append(f"Fecha de registro del dominio: {evid['registrado']}.")
    lineas += ["", "El sitio imita a la empresa para obtener datos de sus clientes. "
                   "Quedamos atentos a su confirmación."]
    return "\n".join(lineas)
