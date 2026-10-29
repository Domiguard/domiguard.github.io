/* Domiguard: panel del cliente (alertas de sitios que suplantan a su marca). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function nf(n) { return Number(n).toLocaleString("en-US"); }

  var S = { clientes: [], alertas: [], estado: null, cliente: null, filtro: "abiertas", canal: "todos", busqueda: "" };
  /* lo que se escribe en el buscador, sin hxxp://, sin corchetes y en minúsculas */
  function limpiarBusqueda(t) { return String(t || "").toLowerCase().trim().replace(/^h[xt]{2}ps?:\/\//, "").replace(/\[\.\]/g, ".").replace(/\/.*$/, ""); }
  var ABIERTA = { nueva: 1, enviada: 1, confirmada: 1, en_baja: 1, en_seguimiento: 1 };
  var ESTADOS = { nueva: "Nueva", enviada: "Avisada al cliente", confirmada: "Confirmada como phishing", en_baja: "En proceso de baja",
                  en_seguimiento: "Respondieron, en seguimiento", dada_de_baja: "Dada de baja", falsa_alarma: "Falsa alarma" };
  var PRIO = { alta: ["p-hi", "Prioridad alta"], media: ["p-mid", "Prioridad media"], baja: ["p-lo", "Prioridad baja"] };
  var CANAL = { reporte: "Reporte externo", busqueda: "Variante de tu dominio", nuevo_registro: "Dominio recién registrado", certificado: "Certificado nuevo" };
  var ORDEN = { alta: 0, media: 1, baja: 2 };
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  /* una fecha (AAAA-MM-DD) o una hora exacta, siempre con el día de Mérida */
  function fmtDay(d) {
    var t = String(d);
    if (t.length > 10 && !isNaN(new Date(t))) t = new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Merida" });
    var p = t.slice(0, 10).split("-"); return Number(p[2]) + " " + MESES[Number(p[1]) - 1];
  }
  /* antigüedad del dominio: lo que más pesa en la prioridad de variantes y dominios nuevos */
  function antiguedad(a) {
    var r = String((a.evidencia || {}).registrado || "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(r)) return a.canal === "nuevo_registro" ? "Registrado en los últimos 10 días" : "Sin fecha de registro";
    var dias = Math.max(0, Math.round((Date.now() - new Date(r.slice(0, 10) + "T12:00:00Z")) / 864e5));
    if (dias > 365) return "Dominio antiguo (desde " + r.slice(0, 4) + ")";
    if (dias >= 60) return "Registrado hace " + Math.round(dias / 30) + " meses";
    return "Registrado hace " + (dias === 0 ? "menos de un día" : dias === 1 ? "1 día" : dias + " días");
  }
  /* folio del caso: DG-año de detección-número fijo que pone la base */
  function folio(a) { return a.folio ? "DG-" + String(a.creada_en).slice(0, 4) + "-" + String(a.folio).padStart(5, "0") : ""; }
  function defang(a) { return (a.tls ? "hxxps://" : "hxxp://") + String(a.host || "").replace(/\./g, "[.]"); }
  function ultimoDia() {
    if (S.estado && S.estado.dia) return S.estado.dia;
    var m = ""; S.alertas.forEach(function (a) { if (a.creada_en > m) m = a.creada_en; }); return m;
  }
  function delCliente() { return S.alertas.filter(function (a) { return a.cliente_id === S.cliente; }); }
  function clienteActual() { return S.clientes.filter(function (c) { return c.id === S.cliente; })[0]; }

  /* ---------- vistas ---------- */
  function renderEstado() {
    var e = S.estado;
    $("m-estado").textContent = e && (e.etiqueta || e.ultima_corrida) ? "Última actualización: " + (e.etiqueta || e.ultima_corrida) : "Sin actualizaciones todavía";
  }
  function renderCliente() {
    var c = clienteActual(); if (!c) return;
    var box = $("m-dominios"); box.textContent = "";
    (c.dominios || []).forEach(function (d) { var s = el("span", "tag mono", d); box.appendChild(s); });
    $("m-vigiladas").textContent = c.variantes_vigiladas ? "Más o menos cada 10 minutos revisamos " + nf(c.variantes_vigiladas) + " variantes de estos dominios (letras cambiadas, guiones, otras terminaciones)." : "";
  }
  function renderKpis() {
    var mias = delCliente(), L = ultimoDia();
    var abiertas = mias.filter(function (a) { return ABIERTA[a.estado]; });
    var items = [
      [nf(abiertas.length), "alertas abiertas"],
      [nf(abiertas.filter(function (a) { return a.prioridad === "alta"; }).length), "de prioridad alta"],
      [nf(mias.filter(function (a) { return a.creada_en === L; }).length), "nuevas en la última actualización"],
      [nf(mias.filter(function (a) { return a.estado === "dada_de_baja"; }).length), "sitios dados de baja"]
    ];
    var box = $("m-kpis"); box.textContent = "";
    items.forEach(function (it) { var c = el("div", "card kpi"); c.appendChild(el("div", "v", it[0])); c.appendChild(el("div", "l", it[1])); box.appendChild(c); });
  }
  function renderChips() {
    var mias = delCliente(), defs = [
      ["abiertas", "Abiertas", mias.filter(function (a) { return ABIERTA[a.estado]; }).length],
      ["alta", "Prioridad alta", mias.filter(function (a) { return ABIERTA[a.estado] && a.prioridad === "alta"; }).length],
      ["cerradas", "Cerradas", mias.filter(function (a) { return !ABIERTA[a.estado]; }).length],
      ["todas", "Todas", mias.length]
    ];
    var box = $("m-chips"); box.textContent = "";
    defs.forEach(function (d) {
      var b = el("button", "chip", d[1] + " (" + d[2] + ")"); b.type = "button"; b.setAttribute("aria-pressed", String(S.filtro === d[0]));
      b.onclick = function () { S.filtro = d[0]; avisoLista(""); renderChips(); renderLista(); }; box.appendChild(b);
    });
  }
  function fila(d, k, v) { var dt = el("dt", "", k), dd = el("dd", "", v); d.appendChild(dt); d.appendChild(dd); }

  function tarjeta(a) {
    var e = a.evidencia || {}, art = el("article", "al " + a.prioridad), top = el("div", "al-top");
    var p = PRIO[a.prioridad] || PRIO.baja;
    top.appendChild(el("span", "pill " + p[0], p[1]));
    top.appendChild(el("span", "mono", defang(a)));
    if (CANAL[a.canal]) top.appendChild(el("span", "tag", CANAL[a.canal]));
    top.appendChild(el("span", "tag", e.confirmacion === "revisar" ? "Por revisar" : "Lo señala un reporte externo"));
    art.appendChild(top);
    art.appendChild(el("div", "", a.motivo || ""));
    var meta = el("div", "al-meta");
    [ folio(a) ? "Folio " + folio(a) : null, antiguedad(a), "Puntaje " + a.puntaje, a.pais || null, "Detectado el " + fmtDay(a.creada_en), "Estado: " + (ESTADOS[a.estado] || a.estado),
      a.dns_ok === false ? "El sitio ya no responde" : null ].forEach(function (t) { if (t) meta.appendChild(el("span", "", t)); });
    art.appendChild(meta);

    var det = el("details"), sm = el("summary", "", "Ver evidencia"); det.appendChild(sm);
    var ev = el("div", "ev"), a1 = el("div"), dl = el("dl");
    a1.appendChild(el("h4", "", "Evidencia"));
    if (folio(a)) fila(dl, "Folio", folio(a));
    fila(dl, "Dirección", defang(a));
    if (CANAL[a.canal]) fila(dl, "Cómo lo encontramos", CANAL[a.canal]);
    fila(dl, "Imita a", (clienteActual() || {}).nombre || "");
    fila(dl, "Dominio oficial", e.oficial || "");
    if (a.similitud != null && (e.tipo === "parecido" || e.tipo === "otra_terminacion")) fila(dl, "Parecido", a.similitud + "% con el dominio oficial");
    fila(dl, "Puntaje del modelo", a.puntaje + " de 100");
    if (e.plataforma) fila(dl, "Plataforma", String(e.plataforma).replace(/\./g, "[.]"));
    if (e.registrado) fila(dl, "Registrado el", e.registrado);
    if (e.registrador) fila(dl, "Registrador", e.registrador);
    if (e.correo_abuso) fila(dl, "Correo de abuso", e.correo_abuso);
    if (a.asn) fila(dl, "ASN", a.asn);
    a1.appendChild(dl); ev.appendChild(a1);
    var a2 = el("div"), linea = el("ol", "historial"); a2.appendChild(el("h4", "", "Historial"));
    linea.appendChild(el("li", "tiny", "Cargando…")); a2.appendChild(linea); ev.appendChild(a2);
    det.appendChild(ev);
    /* el historial se pide a la base solo al abrir la evidencia */
    var pedido = false;
    function abrir() { if (det.open && !pedido) { pedido = true; historial(a).then(function (h) { pintarHistorial(linea, h); }, function () { pedido = false; linea.textContent = ""; linea.appendChild(el("li", "tiny", "No se pudo cargar el historial.")); }); } }
    det.addEventListener("toggle", abrir);
    det.appendChild(reportar(a));
    det.appendChild(acciones(a));
    if (S.abierta === a.id) { det.open = true; abrir(); }
    art.appendChild(det);
    return art;
  }

  /* ---------- historial de la alerta (tabla alertas_historial: la escribe solo la base) ---------- */
  var HECHO = { enviada: "El robot te avisó por correo", confirmada: "Marcada: sí es phishing", en_seguimiento: "Marcada: ya respondieron", en_baja: "Marcada: se pidió la baja", dada_de_baja: "Marcada: ya la dieron de baja",
                falsa_alarma: "Marcada como falsa alarma", nueva: "Volvió a «Nueva»" };
  function historial(a) {
    if (a._historial) return Promise.resolve(a._historial);
    var cfg = window.DOMIGUARD_CONFIG || {};
    if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)) { a._historial = historialDemo(a); return Promise.resolve(a._historial); }
    return window.DomiguardSesion.encabezados().then(function (h) {
      return fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/alertas_historial?select=en,evento,antes,despues,por,solo_fecha,nota&alerta_id=eq." +
                   encodeURIComponent(a.id) + "&order=en.asc,id.asc", { headers: h });
    }).then(function (r) { if (!r.ok) throw new Error("historial " + r.status); return r.json(); })
      .then(function (filas) { a._historial = filas; return filas; });
  }
  /* demostración: lo que se sabe de la alerta de ejemplo */
  function historialDemo(a) {
    var h = [{ en: a.detectada_en || a.creada_en + "T06:00:00-06:00", evento: "detectada", despues: a.canal, solo_fecha: !a.detectada_en }];
    if (a.enviada_en) h.push({ en: a.enviada_en, evento: "estado", antes: "nueva", despues: "enviada" });
    (a._cambios || []).forEach(function (c) { h.push(c); });
    return h;
  }
  function cuando(f) {
    var o = { timeZone: "America/Merida", day: "numeric", month: "short", year: "numeric" };
    if (!f.solo_fecha) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return new Date(f.en).toLocaleString("es-MX", o);
  }
  function quien(f) {
    if (!f.por) return "Robot de Domiguard";
    return S.perfil && f.por === S.perfil.user_id ? "Tú" : "Otra persona de tu equipo";
  }
  function textoHistorial(f) {
    if (f.evento === "detectada") return "Detectada" + (CANAL[f.despues] ? " · " + CANAL[f.despues] : "");
    if (f.evento === "estado") return HECHO[f.despues] || "Estado: " + (ESTADOS[f.despues] || f.despues);
    if (f.evento === "reporte") return "Reportada " + (REPORTADA[f.despues] || f.despues);
    if (f.evento === "respuesta") return "Respuesta " + (RESPONDIO[f.despues] || f.despues);
    if (f.evento === "prioridad") return "La prioridad cambió de " + f.antes + " a " + f.despues;
    if (f.evento === "dns") return f.despues === "no_responde" ? "El sitio dejó de responder (revisión por DNS)"
      : f.antes === "no_responde" ? "El sitio volvió a responder (revisión por DNS)" : "El sitio responde (revisión por DNS)";
    return f.evento;
  }
  function pintarHistorial(linea, filas) {
    linea.textContent = "";
    if (!filas.length) { linea.appendChild(el("li", "tiny", "Todavía no hay movimientos guardados.")); return; }
    filas.forEach(function (f) {
      var li = el("li");
      li.appendChild(el("span", "h-cuando", cuando(f)));
      li.appendChild(el("span", "h-que", textoHistorial(f)));
      if (f.nota) li.appendChild(el("span", "h-nota", "«" + f.nota + "»"));
      li.appendChild(el("span", "h-quien", quien(f)));
      linea.appendChild(li);
    });
  }

  /* ---------- pedir que los navegadores lo bloqueen: formularios oficiales, vacíos (el dominio nunca va en el enlace) ---------- */
  var FORMULARIOS = [["Reportar a Google", "https://safebrowsing.google.com/safebrowsing/report_phish/?hl=es"],
                     ["Reportar a Microsoft", "https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site-guest"]];
  function copiar(texto) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
    return new Promise(function (ok, mal) {
      var t = el("textarea"); t.value = texto; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy") ? ok() : mal(); } catch (e) { mal(e); } finally { t.remove(); }
    });
  }
  function reportar(a) {
    var caja = el("div", "marcar"), fila = el("div", "acciones");
    caja.appendChild(el("h4", "", "Pide que los navegadores lo bloqueen"));
    caja.appendChild(el("p", "tiny", "Copia la dirección y pégala en el formulario. Así Chrome y Edge muestran una advertencia a quien intente entrar."));
    var cp = el("button", "chip", "Copiar dirección"); cp.type = "button";
    cp.onclick = function () {
      copiar((a.tls ? "https://" : "http://") + a.host)
        .then(function () { cp.textContent = "Copiada"; setTimeout(function () { cp.textContent = "Copiar dirección"; }, 2500); })
        .catch(function () { cp.textContent = "No se pudo copiar"; });
    };
    fila.appendChild(cp);
    FORMULARIOS.forEach(function (f) {
      var l = el("a", "chip", f[0] + " ↗"); l.href = f[1]; l.target = "_blank"; l.rel = "noopener noreferrer";
      fila.appendChild(l);
    });
    caja.appendChild(fila);
    return caja;
  }

  /* ---------- el cliente marca el estado de la alerta (función marcar_alerta de la base: solo su banco) ---------- */
  var BOTONES = [["confirmada", "Sí es phishing"], ["en_baja", "Pedí la baja"], ["en_seguimiento", "Ya me respondieron"], ["dada_de_baja", "Ya la dieron de baja"], ["falsa_alarma", "Falsa alarma"], ["nueva", "Volver a nueva"]];
  /* «Pedí la baja» y «Ya me respondieron» piden a quién y, si se quiere, el folio o la respuesta (función anotar_reporte) */
  var COMPROBANTE = { en_baja: "reporte", en_seguimiento: "respuesta" };
  var DESTINOS = [["google", "Google"], ["microsoft", "Microsoft"], ["registrador", "Registrador del dominio"],
                  ["hosting", "Proveedor del hosting"], ["banco", "Área de fraude del banco"], ["otro", "Otro"]];
  var REPORTADA = { google: "a Google", microsoft: "a Microsoft", registrador: "al registrador del dominio", hosting: "al proveedor del hosting",
                    banco: "al área de fraude del banco", otro: "en otro lugar" };
  var RESPONDIO = { google: "de Google", microsoft: "de Microsoft", registrador: "del registrador del dominio", hosting: "del proveedor del hosting",
                    banco: "del área de fraude del banco", otro: "de otro lugar" };
  var nForm = 0;
  function acciones(a) {
    var caja = el("div", "marcar"), fila = el("div", "acciones"), e = a.evidencia || {}, form = null;
    caja.appendChild(el("h4", "", "¿Qué hiciste con este sitio?"));
    var aviso = el("p", "tiny"); aviso.setAttribute("role", "status");
    function bloquear(si) { caja.querySelectorAll("button,select,input").forEach(function (x) { x.disabled = si; }); }
    function listo() {
      a._historial = null; S.abierta = a.id; renderKpis(); renderChips(); renderCanales(); renderLista();
      // si con el filtro actual la alerta ya no se ve, se avisa a dónde pasó
      var sigue = (S.visibles || []).some(function (x) { return x.id === a.id; });
      avisoLista(sigue ? "" : "Guardado: " + a.host.replace(/\./g, "[.]") + " pasó a «" + (ABIERTA[a.estado] ? "Abiertas" : "Cerradas") + "».");
    }
    function fallo(err) { aviso.textContent = err.message; bloquear(false); }
    function pedirComprobante(tipo) {
      if (form) form.remove();
      var n = ++nForm, rep = tipo === "reporte";
      form = el("form", "form comprobante");
      var f1 = el("div", "field"), l1 = el("label", "", rep ? "¿A quién lo reportaste?" : "¿Quién te respondió?"), sel = el("select");
      l1.htmlFor = sel.id = "destino-" + n;
      DESTINOS.forEach(function (d) { var o = el("option", "", d[1]); o.value = d[0]; sel.appendChild(o); });
      var pista = el("span", "tiny");
      function verPista() {
        pista.textContent = sel.value === "registrador" && e.registrador ? "Registrador: " + e.registrador + (e.correo_abuso ? " · correo de abuso: " + e.correo_abuso : "") : "";
        pista.hidden = !pista.textContent;
      }
      sel.onchange = verPista; verPista();
      f1.appendChild(l1); f1.appendChild(sel); f1.appendChild(pista);
      var f2 = el("div", "field"), l2 = el("label", "", rep ? "Folio o comprobante (opcional)" : "¿Qué te respondieron? (opcional)"), txt = el("input");
      l2.htmlFor = txt.id = "nota-" + n; txt.type = "text"; txt.maxLength = 300; txt.autocomplete = "off";
      txt.placeholder = rep ? "Por ejemplo el número de caso que te dieron" : "Por ejemplo: «Recibimos tu reporte»";
      f2.appendChild(l2); f2.appendChild(txt);
      var bt = el("div", "acciones"), ok = el("button", "chip", "Guardar"), no = el("button", "chip", "Cancelar");
      ok.type = "submit"; no.type = "button"; ok.setAttribute("aria-pressed", "true");
      no.onclick = function () { form.remove(); form = null; aviso.textContent = ""; };
      bt.appendChild(ok); bt.appendChild(no);
      form.appendChild(f1); form.appendChild(f2); form.appendChild(bt);
      form.onsubmit = function (ev) {
        ev.preventDefault(); bloquear(true); aviso.textContent = "Guardando…";
        anotar(a, tipo, sel.value, txt.value.trim()).then(listo).catch(fallo);
      };
      fila.after(form); sel.focus();
    }
    BOTONES.forEach(function (b) {
      if (b[0] === "nueva" && a.estado === "nueva") return;
      var btn = el("button", "chip", b[1]); btn.type = "button"; btn.setAttribute("aria-pressed", String(a.estado === b[0]));
      btn.onclick = function () {
        if (COMPROBANTE[b[0]]) { pedirComprobante(COMPROBANTE[b[0]]); return; }   // también sirve para anotar otro reporte
        if (a.estado === b[0]) return;
        bloquear(true); aviso.textContent = "Guardando…";
        marcar(a, b[0]).then(listo).catch(fallo);
      };
      fila.appendChild(btn);
    });
    caja.appendChild(fila); caja.appendChild(aviso);
    if (a.dada_de_baja_en) caja.appendChild(el("p", "tiny", "Dada de baja el " + fmtDay(a.dada_de_baja_en) + "."));
    else if (a.baja_pedida_en && (a.estado === "en_baja" || a.estado === "en_seguimiento")) caja.appendChild(el("p", "tiny", "Pediste la baja el " + fmtDay(a.baja_pedida_en) + "."));
    return caja;
  }
  function avisoLista(texto) {
    var n = $("m-aviso");
    if (!n) { n = el("p", "msg ok"); n.id = "m-aviso"; n.setAttribute("role", "status"); $("m-list").parentNode.insertBefore(n, $("m-list")); }
    n.textContent = texto; n.hidden = !texto;
  }
  function marcar(a, estado) {
    var cfg = window.DOMIGUARD_CONFIG || {};
    if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)) {          // demostración: solo en esta pantalla
      var ahora = new Date().toISOString();
      (a._cambios = a._cambios || []).push({ en: ahora, evento: "estado", antes: a.estado, despues: estado, por: "demo" });
      S.perfil = S.perfil || { user_id: "demo" };
      a.estado = estado;
      a.baja_pedida_en = (estado === "nueva" || estado === "confirmada") ? null
        : (estado === "en_baja" || estado === "en_seguimiento" || estado === "dada_de_baja") ? (a.baja_pedida_en || ahora) : a.baja_pedida_en;
      a.dada_de_baja_en = estado === "dada_de_baja" ? (a.dada_de_baja_en || ahora) : null;
      return Promise.resolve();
    }
    return rpc("marcar_alerta", { p_id: a.id, p_estado: estado }, a);
  }
  function anotar(a, tipo, destino, nota) {
    var cfg = window.DOMIGUARD_CONFIG || {};
    if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)) {          // demostración: solo en esta pantalla
      var pasos = tipo === "reporte" ? { nueva: 1, enviada: 1, confirmada: 1 } : { nueva: 1, enviada: 1, confirmada: 1, en_baja: 1 };
      var p = pasos[a.estado] ? marcar(a, tipo === "reporte" ? "en_baja" : "en_seguimiento") : Promise.resolve();
      return p.then(function () { a._cambios.push({ en: new Date().toISOString(), evento: tipo, despues: destino, nota: nota || null, por: "demo" }); });
    }
    return rpc("anotar_reporte", { p_id: a.id, p_tipo: tipo, p_destino: destino, p_nota: nota }, a);
  }
  function rpc(nombre, cuerpo, a) {
    var cfg = window.DOMIGUARD_CONFIG || {};
    return window.DomiguardSesion.encabezados().then(function (h) {
      return fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + nombre, {
        method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify(cuerpo)
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(/plan activo/.test(d.message || "") ? "Tu cuenta no tiene un plan activo."
          : /300 letras/.test(d.message || "") ? "El folio o la respuesta puede tener hasta 300 letras." : "No se pudo guardar. Vuelve a intentarlo.");
        a.estado = d.estado; a.baja_pedida_en = d.baja_pedida_en; a.dada_de_baja_en = d.dada_de_baja_en;
      });
    });
  }
  function renderCanales() {
    var box = $("m-canales"); if (!box) return;
    var mias = delCliente().filter(function (a) { return ABIERTA[a.estado]; }), usados = [];
    Object.keys(CANAL).forEach(function (k) { if (mias.some(function (a) { return a.canal === k; })) usados.push(k); });
    box.textContent = ""; box.hidden = usados.length < 2;
    if (usados.length < 2) { S.canal = "todos"; return; }
    [["todos", "Todos los canales"]].concat(usados.map(function (k) { return [k, CANAL[k]]; })).forEach(function (d) {
      var n = d[0] === "todos" ? mias.length : mias.filter(function (a) { return a.canal === d[0]; }).length;
      var b = el("button", "chip", d[1] + " (" + n + ")"); b.type = "button"; b.setAttribute("aria-pressed", String(S.canal === d[0]));
      b.onclick = function () { S.canal = d[0]; renderCanales(); renderLista(); }; box.appendChild(b);
    });
  }
  function renderLista() {
    var rows = delCliente().filter(function (a) {
      if (S.canal !== "todos" && a.canal !== S.canal) return false;
      if (S.busqueda && String(a.host || "").toLowerCase().indexOf(S.busqueda) < 0 && folio(a).toLowerCase().indexOf(S.busqueda) < 0) return false;
      if (S.filtro === "abiertas") return ABIERTA[a.estado];
      if (S.filtro === "alta") return ABIERTA[a.estado] && a.prioridad === "alta";
      if (S.filtro === "cerradas") return !ABIERTA[a.estado];
      return true;
    }).sort(function (x, y) { return ORDEN[x.prioridad] - ORDEN[y.prioridad] || y.puntaje - x.puntaje; });
    S.visibles = rows;
    var xl = $("m-excel"), csv = $("m-csv");
    if (xl) { xl.disabled = !rows.length; xl.title = "Descargar Excel (" + nf(rows.length) + (rows.length === 1 ? " alerta)" : " alertas)"); xl.setAttribute("aria-label", xl.title); }
    if (csv) csv.disabled = !rows.length;
    var box = $("m-list"); box.textContent = ""; $("m-empty").hidden = rows.length > 0;
    $("m-empty").textContent = !delCliente().length ? "Sin alertas por ahora. Seguimos vigilando tus dominios todos los días."
      : S.busqueda ? "Ningún dominio ni folio contiene «" + S.busqueda + "» con este filtro." : "No hay alertas con este filtro.";
    rows.forEach(function (a) { box.appendChild(tarjeta(a)); });
  }
  /* ---------- descarga en CSV (lo que se ve con los filtros activos, con la evidencia completa) ---------- */
  function celda(v) {
    var t = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;                 // que Excel no lo ejecute como fórmula (datos de registros públicos)
    return /[",\n\r;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  /* las mismas columnas para Excel y CSV: encabezados, ancho en Excel y valor de cada alerta */
  var COLUMNAS = [
    ["Folio", 15, function (a) { return folio(a); }],
    ["Prioridad", 11, function (a) { return { alta: "Alta", media: "Media", baja: "Baja" }[a.prioridad] || a.prioridad; }],
    ["Dominio", 34, function (a) { return a.host; }],
    ["Dirección desactivada", 40, function (a) { return defang(a); }],
    ["Motivo", 52, function (a) { return String(a.motivo || "").replace(/\[\.\]/g, "."); }],
    ["Cómo lo encontramos", 26, function (a) { return CANAL[a.canal] || a.canal; }],
    ["Confirmación", 28, function (a, e) { return e.confirmacion === "revisar" ? "Por revisar" : "Lo señala un reporte externo"; }],
    ["Estado", 20, function (a) { return ESTADOS[a.estado] || a.estado; }],
    ["Puntaje (0 a 100)", 16, function (a) { return a.puntaje; }],
    ["Detectado el", 14, function (a) { return a.creada_en; }],
    ["Registrado el", 14, function (a, e) { return e.registrado; }],
    ["Registrador", 30, function (a, e) { return e.registrador; }],
    ["Correo de abuso", 30, function (a, e) { return e.correo_abuso; }],
    ["Plataforma", 18, function (a, e) { return e.plataforma; }],
    ["Dominio oficial", 20, function (a, e) { return e.oficial; }],
    ["País", 16, function (a) { return a.pais; }],
    ["ASN", 10, function (a) { return a.asn; }],
    ["¿Sigue activo?", 14, function (a) { return a.dns_ok === false ? "No" : a.dns_ok ? "Sí" : "Sin revisar"; }]
  ];
  function filasDescarga() {
    return (S.visibles || []).map(function (a) { var e = a.evidencia || {}; return COLUMNAS.map(function (c) { return c[2](a, e); }); });
  }
  function nombreArchivo(ext) { return "domiguard_" + ((clienteActual() || {}).id || "alertas") + "_" + new Date().toISOString().slice(0, 10) + "." + ext; }
  function descargarExcel() {
    var c = clienteActual() || {};
    var libro = window.DomiguardExcel.crear("Alertas " + (c.nombre || ""), COLUMNAS.map(function (x) { return x[0]; }), filasDescarga(), COLUMNAS.map(function (x) { return x[1]; }));
    window.DomiguardExcel.descargar(nombreArchivo("xlsx"), libro);
  }
  function descargarCSV() {
    var texto = "﻿" + [COLUMNAS.map(function (x) { return x[0]; })].concat(filasDescarga())
      .map(function (f) { return f.map(celda).join(","); }).join("\r\n");          // BOM: acentos bien en Excel
    window.DomiguardExcel.descargar(nombreArchivo("csv"), new Blob([texto], { type: "text/csv;charset=utf-8" }));
  }

  function renderTodo() { renderEstado(); renderCliente(); renderKpis(); renderChips(); renderCanales(); renderLista(); }

  function initSelector() {
    var cuantas = {}; S.alertas.forEach(function (a) { cuantas[a.cliente_id] = (cuantas[a.cliente_id] || 0) + 1; });
    var orden = S.clientes.slice().sort(function (a, b) { return (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || (cuantas[b.id] || 0) - (cuantas[a.id] || 0); });
    var sel = $("marca"); sel.textContent = "";
    orden.forEach(function (c) { var o = el("option", "", c.nombre + " (" + (cuantas[c.id] || 0) + ")"); o.value = c.id; sel.appendChild(o); });
    S.cliente = orden.length ? orden[0].id : null;
    sel.onchange = function () { S.cliente = sel.value; S.canal = "todos"; renderTodo(); };
  }

  /* ---------- datos ---------- */
  function cargarDatos() {
    var cfg = window.DOMIGUARD_CONFIG || {};
    var demo = !cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL);
    function usar(d) {
      S.clientes = d.clientes || []; S.alertas = d.alertas || []; S.estado = d.estado || null;
      if (demo) S.alertas.slice().sort(function (x, y) { return x.creada_en < y.creada_en ? -1 : x.creada_en > y.creada_en ? 1 : 0; })
        .forEach(function (a, i) { if (!a.folio) a.folio = i + 1; });
    }
    if (demo) {
      if (window.DOMIGUARD_DEMO) { usar(window.DOMIGUARD_DEMO); return Promise.resolve(); }
      return fetch("data/demo.json").then(function (r) { return r.json(); }).then(usar);
    }
    var base = cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
    /* con la llave de la cuenta: la base solo entrega las alertas del banco aprobado (ver sesion.js) */
    return window.DomiguardSesion.encabezados().then(function (h) {
      function pagina(ruta, desde, acc) {
        return fetch(base + ruta, { headers: Object.assign({ Range: desde + "-" + (desde + 999) }, h) })
          .then(function (r) { if (!r.ok) throw new Error(ruta + " " + r.status); return r.json(); })
          .then(function (lote) { acc = acc.concat(lote); return lote.length === 1000 && acc.length < 10000 ? pagina(ruta, desde + 1000, acc) : acc; });
      }
      /* el panel muestra solo lo detectado en las últimas 48 horas; las alertas anteriores siguen guardadas en la base */
      var desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      return Promise.all([
        pagina("/clientes?select=id,nombre,marca,dominios,variantes_vigiladas,destacado&activo=eq.true&id=eq." + encodeURIComponent(S.perfil.cliente_id), 0, []),
        pagina("/alertas?select=*&cliente_id=eq." + encodeURIComponent(S.perfil.cliente_id) + "&detectada_en=gte." + encodeURIComponent(desde) + "&order=creada_en.desc", 0, []),
        fetch(base + "/estado?id=eq.ultima&select=datos", { headers: h }).then(function (r) { return r.ok ? r.json() : []; })
      ]).then(function (res) { usar({ clientes: res[0], alertas: res[1], estado: res[2][0] ? res[2][0].datos : null }); });
    });
  }

  /* cada 5 minutos vuelve a leer la base, sin perder el banco elegido; no lo hace si la pestaña está oculta
     o si hay una evidencia abierta, para no cerrarla mientras se lee */
  function refrescar() {
    if (document.hidden || document.querySelector("#m-list details[open]")) return;
    var elegido = S.cliente;
    cargarDatos().then(function () {
      initSelector();
      if (S.clientes.some(function (c) { return c.id === elegido; })) { S.cliente = elegido; $("marca").value = elegido; }
      renderTodo();
    }).catch(function () {});
  }

  function iniciar() {
    if ($("m-buscar")) $("m-buscar").oninput = function () { S.busqueda = limpiarBusqueda(this.value); avisoLista(""); renderLista(); };
    if ($("m-excel")) $("m-excel").onclick = descargarExcel;
    if ($("m-csv")) $("m-csv").onclick = descargarCSV;
    cargarDatos().then(function () { initSelector(); renderTodo(); setInterval(refrescar, 5 * 60 * 1000); })
      .catch(function () { $("m-estado").textContent = "No se pudieron cargar los datos"; });
  }
  var cfg = window.DOMIGUARD_CONFIG || {};
  if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)) { $("contenido").hidden = false; iniciar(); }  // demostración sin base: sin cuentas
  else window.DomiguardSesion.proteger(function (perfil) { S.perfil = perfil; iniciar(); });
})();
