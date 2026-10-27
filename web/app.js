/* Domiguard: panel del cliente (alertas de sitios que suplantan a su marca). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function nf(n) { return Number(n).toLocaleString("en-US"); }

  var S = { clientes: [], alertas: [], estado: null, cliente: null, filtro: "abiertas", canal: "todos" };
  var ABIERTA = { nueva: 1, enviada: 1, en_baja: 1 };
  var ESTADOS = { nueva: "Nueva", enviada: "Avisada al cliente", en_baja: "En proceso de baja", dada_de_baja: "Dada de baja", falsa_alarma: "Falsa alarma" };
  var PRIO = { alta: ["p-hi", "Prioridad alta"], media: ["p-mid", "Prioridad media"], baja: ["p-lo", "Prioridad baja"] };
  var CANAL = { reporte: "Reporte externo", busqueda: "Variante de tu dominio", nuevo_registro: "Dominio recién registrado", certificado: "Certificado nuevo" };
  var ORDEN = { alta: 0, media: 1, baja: 2 };
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function fmtDay(d) { var p = String(d).slice(0, 10).split("-"); return Number(p[2]) + " " + MESES[Number(p[1]) - 1]; }
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
    $("m-vigiladas").textContent = c.variantes_vigiladas ? "Cada 5 minutos revisamos " + nf(c.variantes_vigiladas) + " variantes de estos dominios (letras cambiadas, guiones, otras terminaciones)." : "";
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
      b.onclick = function () { S.filtro = d[0]; renderChips(); renderLista(); }; box.appendChild(b);
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
    [ "Puntaje " + a.puntaje, a.pais || null, "Detectado el " + fmtDay(a.creada_en), "Estado: " + (ESTADOS[a.estado] || a.estado),
      a.dns_ok === false ? "El sitio ya no responde" : null ].forEach(function (t) { if (t) meta.appendChild(el("span", "", t)); });
    art.appendChild(meta);

    var det = el("details"), sm = el("summary", "", "Ver evidencia"); det.appendChild(sm);
    var ev = el("div", "ev"), a1 = el("div"), dl = el("dl");
    a1.appendChild(el("h4", "", "Evidencia"));
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
    det.appendChild(ev); art.appendChild(det);
    return art;
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
      if (S.filtro === "abiertas") return ABIERTA[a.estado];
      if (S.filtro === "alta") return ABIERTA[a.estado] && a.prioridad === "alta";
      if (S.filtro === "cerradas") return !ABIERTA[a.estado];
      return true;
    }).sort(function (x, y) { return ORDEN[x.prioridad] - ORDEN[y.prioridad] || y.puntaje - x.puntaje; });
    S.visibles = rows;
    var xl = $("m-excel"), csv = $("m-csv");
    if (xl) { xl.disabled = !rows.length; xl.textContent = "Descargar Excel (" + nf(rows.length) + (rows.length === 1 ? " alerta)" : " alertas)"); }
    if (csv) csv.disabled = !rows.length;
    var box = $("m-list"); box.textContent = ""; $("m-empty").hidden = rows.length > 0;
    $("m-empty").textContent = delCliente().length ? "No hay alertas con este filtro." : "Sin alertas por ahora. Seguimos vigilando tus dominios todos los días.";
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
    function usar(d) { S.clientes = d.clientes || []; S.alertas = d.alertas || []; S.estado = d.estado || null; }
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
    if ($("m-excel")) $("m-excel").onclick = descargarExcel;
    if ($("m-csv")) $("m-csv").onclick = descargarCSV;
    cargarDatos().then(function () { initSelector(); renderTodo(); setInterval(refrescar, 5 * 60 * 1000); })
      .catch(function () { $("m-estado").textContent = "No se pudieron cargar los datos"; });
  }
  var cfg = window.DOMIGUARD_CONFIG || {};
  if (!cfg.SUPABASE_URL || /TU-PROYECTO/.test(cfg.SUPABASE_URL)) { $("contenido").hidden = false; iniciar(); }  // demostración sin base: sin cuentas
  else window.DomiguardSesion.proteger(function (perfil) { S.perfil = perfil; iniciar(); });
})();
