/* Domiguard: tendencias (toda la historia de alertas guardada en la base, también la que ya no sale en el panel). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var SVG = "http://www.w3.org/2000/svg";
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function sv(tag, attrs, text) { var e = document.createElementNS(SVG, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
  function nf(n) { return Number(n).toLocaleString("es-MX"); }
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  function fmtDia(d) { var p = d.split("-"); return Number(p[2]) + " " + MESES[Number(p[1]) - 1]; }
  function hoyMerida() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Merida" }).format(new Date()); }
  function sumaDias(d, n) { var x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5); }

  /* Color por entidad, en orden fijo (nunca por rango): cada canal conserva su color aunque cambien los filtros. */
  var CANALES = [
    { k: "reporte", l: "Reporte externo", c: "--viz-1" },
    { k: "busqueda", l: "Variante de tu dominio", c: "--viz-2" },
    { k: "nuevo_registro", l: "Dominio recién registrado", c: "--viz-3" },
    { k: "certificado", l: "Certificado nuevo", c: "--viz-4" }
  ];
  var PRIOS = [
    { k: "alta", l: "Alta", c: "--viz-p-alta" },
    { k: "media", l: "Media", c: "--viz-p-media" },
    { k: "baja", l: "Baja", c: "--viz-p-baja" }
  ];
  var PERIODOS = [["7", "Últimos 7 días"], ["30", "Últimos 30 días"], ["todo", "Todo"]];
  var SEGUNDO_NIVEL = { com: 1, org: 1, net: 1, gob: 1, edu: 1, co: 1, gov: 1, ac: 1, or: 1, ne: 1 };
  var S = { alertas: [], clientes: [], banco: "", periodo: "todo" };

  /* ---------- ventanita al pasar el mouse ---------- */
  var tip = $("t-tip");
  function mostrarTip(ev, titulo, filas) {
    tip.textContent = "";
    tip.appendChild(el("b", "", titulo));
    filas.forEach(function (f) {
      var r = el("div", "viz-tip-f");
      if (f.c) { var s = el("i", "viz-sw"); s.style.background = "var(" + f.c + ")"; r.appendChild(s); }
      r.appendChild(el("span", "", f.l)); r.appendChild(el("strong", "", nf(f.v)));
      tip.appendChild(r);
    });
    tip.hidden = false; moverTip(ev);
  }
  function moverTip(ev) {
    var x = ev.clientX + 14, y = ev.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  function ocultarTip() { tip.hidden = true; }
  function conTip(nodo, titulo, filas) {
    nodo.addEventListener("mouseenter", function (e) { mostrarTip(e, titulo, filas); });
    nodo.addEventListener("mousemove", moverTip);
    nodo.addEventListener("mouseleave", ocultarTip);
  }

  /* ---------- piezas comunes ---------- */
  function limpiar(box) { while (box.children.length > 2) box.removeChild(box.lastChild); }  // deja título y subtítulo
  function leyenda(box, series) {
    var lg = el("div", "viz-ley");
    series.forEach(function (s) { var it = el("span", "viz-ley-i"); var sw = el("i", "viz-sw"); sw.style.background = "var(" + s.c + ")"; it.appendChild(sw); it.appendChild(el("span", "", s.l)); lg.appendChild(it); });
    box.appendChild(lg);
  }
  function tabla(box, encabezados, filas) {
    var d = el("details", "viz-tabla"); d.appendChild(el("summary", "", "Ver los datos en tabla"));
    var t = el("table"), th = el("tr");
    encabezados.forEach(function (h) { th.appendChild(el("th", "", h)); });
    var thead = el("thead"); thead.appendChild(th); t.appendChild(thead);
    var tb = el("tbody");
    filas.forEach(function (f) { var tr = el("tr"); f.forEach(function (v, i) { tr.appendChild(el("td", i ? "num" : "", typeof v === "number" ? nf(v) : v)); }); tb.appendChild(tr); });
    t.appendChild(tb); d.appendChild(t); box.appendChild(d);
  }
  /* se dibuja al ancho real de la tarjeta (sin escalar), para que el texto conserve su tamaño en el celular */
  function ancho(box) { var cs = getComputedStyle(box); return Math.max(260, Math.round(box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))); }
  function vacio(box) { box.appendChild(el("div", "empty", "Sin alertas en este periodo.")); }
  function tope(max) {                                   // máximo "redondo" para el eje
    if (max <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  /* barra con la punta redondeada (4px) y la base recta, pegada a la línea base */
  function barraV(x, y, w, h, redonda) {
    var r = redonda ? Math.min(4, w / 2, h) : 0;
    return "M" + x + "," + (y + h) + "V" + (y + r) + (r ? "Q" + x + "," + y + " " + (x + r) + "," + y : "") + "H" + (x + w - r) +
      (r ? "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) : "") + "V" + (y + h) + "Z";
  }
  function barraH(x, y, w, h, redonda) {
    var r = redonda ? Math.min(4, h / 2, w) : 0;
    return "M" + x + "," + y + "H" + (x + w - r) + (r ? "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) : "") + "V" + (y + h - r) +
      (r ? "Q" + (x + w) + "," + (y + h) + " " + (x + w - r) + "," + (y + h) : "") + "H" + x + "Z";
  }

  /* ---------- columnas apiladas por día ---------- */
  function columnasPorDia(box, dias, series, datos) {
    limpiar(box);
    var totales = dias.map(function (d) { return series.reduce(function (s, x) { return s + (datos[d][x.k] || 0); }, 0); });
    if (!totales.some(Boolean)) { vacio(box); return; }
    if (series.length > 1) leyenda(box, series);
    var W = ancho(box), H = 260, iz = 44, de = 8, ar = 12, ab = 30, aw = W - iz - de, ah = H - ar - ab;
    var max = tope(Math.max.apply(null, totales)), paso = aw / dias.length, bw = Math.max(2, Math.min(36, paso * 0.62));
    var g = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "viz-svg", role: "img", "aria-label": "Alertas por día" });
    for (var i = 0; i <= 4; i++) {                       // rejilla discreta y eje
      var yv = ar + ah - ah * i / 4;
      g.appendChild(sv("line", { x1: iz, x2: W - de, y1: yv, y2: yv, class: i ? "viz-grid" : "viz-base" }));
      g.appendChild(sv("text", { x: iz - 8, y: yv + 4, class: "viz-eje", "text-anchor": "end" }, nf(max * i / 4)));
    }
    var cadaCuanto = Math.ceil(dias.length / Math.max(3, Math.floor(aw / 64))), mayor = totales.indexOf(Math.max.apply(null, totales));
    dias.forEach(function (d, i) {
      var cx = iz + paso * i + paso / 2, x = cx - bw / 2, base = ar + ah, presentes = series.filter(function (s) { return datos[d][s.k]; });
      presentes.forEach(function (s, j) {
        var h = ah * datos[d][s.k] / max, gap = j ? 2 : 0;   // 2px de separación entre segmentos
        base -= h;
        g.appendChild(sv("path", { d: barraV(x, base, bw, Math.max(0, h - gap), j === presentes.length - 1), style: "fill:var(" + s.c + ")" }));
      });
      if (i % cadaCuanto === 0 || i === dias.length - 1) g.appendChild(sv("text", { x: cx, y: H - 10, class: "viz-eje", "text-anchor": "middle" }, fmtDia(d)));
      if (i === mayor) g.appendChild(sv("text", { x: cx, y: base - 6, class: "viz-val", "text-anchor": "middle" }, nf(totales[i])));
      var hit = sv("rect", { x: iz + paso * i, y: ar, width: paso, height: ah, class: "viz-hit" });
      conTip(hit, fmtDia(d) + " · " + nf(totales[i]) + " alertas", series.filter(function (s) { return datos[d][s.k]; }).map(function (s) { return { l: s.l, v: datos[d][s.k], c: s.c }; }));
      g.appendChild(hit);
    });
    box.appendChild(g);
    tabla(box, ["Día"].concat(series.map(function (s) { return s.l; })).concat(["Total"]),
      dias.filter(function (d, i) { return totales[i]; }).map(function (d) { var f = [fmtDia(d)], t = 0; series.forEach(function (s) { f.push(datos[d][s.k] || 0); t += datos[d][s.k] || 0; }); f.push(t); return f; }));
  }

  /* ---------- barras horizontales (una serie o apiladas) ---------- */
  function barras(box, filas, series, encabezado) {
    limpiar(box);
    if (!filas.length) { vacio(box); return; }
    if (series.length > 1) leyenda(box, series);
    var W = ancho(box), fila = 34, iz = Math.min(150, Math.round(W * 0.46)), de = 56, H = filas.length * fila + 8;
    var totales = filas.map(function (f) { return series.reduce(function (s, x) { return s + (f.v[x.k] || 0); }, 0); });
    var max = Math.max.apply(null, totales), aw = W - iz - de;
    var g = sv("svg", { viewBox: "0 0 " + W + " " + H, class: "viz-svg", role: "img", "aria-label": box.querySelector("h3").textContent });
    g.appendChild(sv("line", { x1: iz, x2: iz, y1: 0, y2: H - 4, class: "viz-base" }));
    filas.forEach(function (f, i) {
      var y = 6 + i * fila, bh = 18, x = iz, presentes = series.filter(function (s) { return f.v[s.k]; });
      g.appendChild(sv("text", { x: iz - 10, y: y + 13, class: "viz-cat", "text-anchor": "end" }, f.l));
      presentes.forEach(function (s, j) {
        var w = aw * f.v[s.k] / max, gap = j < presentes.length - 1 ? 2 : 0;
        g.appendChild(sv("path", { d: barraH(x, y, Math.max(0, w - gap), bh, j === presentes.length - 1), style: "fill:var(" + s.c + ")" }));
        x += w;
      });
      g.appendChild(sv("text", { x: x + 8, y: y + 13, class: "viz-val" }, nf(totales[i])));
      var hit = sv("rect", { x: 0, y: y - 7, width: W, height: fila, class: "viz-hit" });
      conTip(hit, f.l + " · " + nf(totales[i]), presentes.map(function (s) { return { l: s.l, v: f.v[s.k], c: series.length > 1 ? s.c : null }; }));
      g.appendChild(hit);
    });
    box.appendChild(g);
    /* si un nombre no cabe junto a su barra, se acorta con "…" (el completo sale en la ventanita y en la tabla) */
    g.querySelectorAll(".viz-cat").forEach(function (t) {
      var completo = t.textContent, n = completo.length;
      while (n > 3 && t.getComputedTextLength() > iz - 14) { n--; t.textContent = completo.slice(0, n).trim() + "…"; }
    });
    tabla(box, [encabezado].concat(series.length > 1 ? series.map(function (s) { return s.l; }) : []).concat(["Total"]),
      filas.map(function (f, i) { var r = [f.l]; if (series.length > 1) series.forEach(function (s) { r.push(f.v[s.k] || 0); }); r.push(totales[i]); return r; }));
  }

  /* ---------- cálculos ---------- */
  function terminacion(host) {
    var p = String(host || "").toLowerCase().split(".");
    if (p.length >= 3 && SEGUNDO_NIVEL[p[p.length - 2]] && p[p.length - 1].length === 2) return "." + p.slice(-2).join(".");
    return "." + p[p.length - 1];
  }
  function top(conteo, n, otros) {
    var f = Object.keys(conteo).map(function (k) { return { l: k, v: { total: conteo[k] } }; }).sort(function (a, b) { return b.v.total - a.v.total; });
    if (f.length > n) { var resto = f.slice(n - 1).reduce(function (s, x) { return s + x.v.total; }, 0); f = f.slice(0, n - 1).concat([{ l: otros, v: { total: resto } }]); }
    return f;
  }
  function filtradas() {
    var hoy = hoyMerida(), desde = S.periodo === "todo" ? "" : sumaDias(hoy, -(Number(S.periodo) - 1));
    return S.alertas.filter(function (a) { return (!S.banco || a.cliente_id === S.banco) && a.creada_en >= desde; });
  }

  function render() {
    var al = filtradas(), hoy = hoyMerida();
    /* indicadores */
    var altas = al.filter(function (a) { return a.prioridad === "alta"; }).length;
    var con = al.filter(function (a) { return (a.evidencia || {}).registrado || a.canal === "nuevo_registro"; });
    var recientes = con.filter(function (a) { var r = (a.evidencia || {}).registrado; return r ? diasEntre(r.slice(0, 10), a.creada_en) <= 30 : true; }).length;
    var kp = [[nf(al.length), "alertas guardadas"], [nf(altas), "de prioridad alta"],
      [nf(al.filter(function (a) { return a.creada_en >= sumaDias(hoy, -6); }).length), "en los últimos 7 días"],
      [con.length ? Math.round(100 * recientes / con.length) + "%" : "–", "con dominio de 30 días o menos (de las que tienen fecha)"]];
    var box = $("t-kpis"); box.textContent = "";
    kp.forEach(function (k) { var c = el("div", "card kpi"); c.appendChild(el("div", "v", k[0])); c.appendChild(el("div", "l", k[1])); box.appendChild(c); });

    /* por día y canal */
    var usados = CANALES.filter(function (c) { return al.some(function (a) { return a.canal === c.k; }); });
    var fechas = al.map(function (a) { return a.creada_en; }).sort(), dias = [], datos = {};
    if (fechas.length) {
      var ini = S.periodo === "todo" ? fechas[0] : sumaDias(hoy, -(Number(S.periodo) - 1));
      for (var d = ini; d <= hoy; d = sumaDias(d, 1)) { dias.push(d); datos[d] = {}; }
      al.forEach(function (a) { if (datos[a.creada_en]) datos[a.creada_en][a.canal] = (datos[a.creada_en][a.canal] || 0) + 1; });
    }
    columnasPorDia($("g-dias"), dias, usados, datos);

    /* por banco y prioridad (con un banco elegido, queda una sola fila) */
    var nombres = {}; S.clientes.forEach(function (c) { nombres[c.id] = c.nombre; });
    var pb = {}; al.forEach(function (a) { var f = pb[a.cliente_id] = pb[a.cliente_id] || {}; f[a.prioridad] = (f[a.prioridad] || 0) + 1; });
    var filasB = Object.keys(pb).map(function (k) { return { l: nombres[k] || k, v: pb[k] }; })
      .sort(function (a, b) { return (b.v.alta || 0) + (b.v.media || 0) + (b.v.baja || 0) - ((a.v.alta || 0) + (a.v.media || 0) + (a.v.baja || 0)); });
    barras($("g-bancos"), filasB, PRIOS, "Banco");

    /* antigüedad del dominio */
    var cub = { "30 días o menos": 0, "31 a 365 días": 0, "Más de 1 año": 0, "Sin dato": 0 };
    al.forEach(function (a) {
      var r = (a.evidencia || {}).registrado;
      if (r) { var e = diasEntre(r.slice(0, 10), a.creada_en); cub[e <= 30 ? "30 días o menos" : e <= 365 ? "31 a 365 días" : "Más de 1 año"]++; }
      else if (a.canal === "nuevo_registro") cub["30 días o menos"]++;      // viene de la lista de los últimos 10 días
      else cub["Sin dato"]++;
    });
    var uno = [{ k: "total", l: "Alertas", c: "--viz-1" }];
    barras($("g-edad"), Object.keys(cub).filter(function (k) { return cub[k]; }).map(function (k) { return { l: k, v: { total: cub[k] } }; }), uno, "Antigüedad");

    /* terminaciones y registradores */
    var tl = {}; al.forEach(function (a) { var t = terminacion(a.host); tl[t] = (tl[t] || 0) + 1; });
    barras($("g-tld"), top(tl, 10, "Otras"), uno, "Terminación");
    var rg = {}; al.forEach(function (a) { var r = (a.evidencia || {}).registrador; if (r) rg[r] = (rg[r] || 0) + 1; });
    barras($("g-reg"), top(rg, 8, "Otros"), uno, "Registrador");
  }

  function controles() {
    var sel = $("t-banco");
    S.clientes.forEach(function (c) { var o = el("option", "", c.nombre); o.value = c.id; sel.appendChild(o); });
    sel.onchange = function () { S.banco = sel.value; render(); };
    var box = $("t-periodo");
    function pintar() {
      box.textContent = "";
      PERIODOS.forEach(function (p) {
        var b = el("button", "chip", p[1]); b.type = "button"; b.setAttribute("aria-pressed", String(S.periodo === p[0]));
        b.onclick = function () { S.periodo = p[0]; pintar(); render(); }; box.appendChild(b);
      });
    }
    pintar();
  }

  /* ---------- datos ---------- */
  function cargar() {
    var cfg = window.DOMIGUARD_CONFIG || {};
    if (!cfg.SUPABASE_URL) return fetch("data/demo.json").then(function (r) { return r.json(); }).then(function (d) { S.clientes = d.clientes || []; S.alertas = d.alertas || []; });
    var base = cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1", h = { apikey: cfg.SUPABASE_ANON_KEY };
    if (/^eyJ/.test(cfg.SUPABASE_ANON_KEY || "")) h.Authorization = "Bearer " + cfg.SUPABASE_ANON_KEY;
    function pagina(ruta, desde, acc) {
      return fetch(base + ruta, { headers: Object.assign({ Range: desde + "-" + (desde + 999) }, h) })
        .then(function (r) { if (!r.ok) throw new Error(ruta + " " + r.status); return r.json(); })
        .then(function (lote) { acc = acc.concat(lote); return lote.length === 1000 && acc.length < 50000 ? pagina(ruta, desde + 1000, acc) : acc; });
    }
    return Promise.all([
      pagina("/clientes?select=id,nombre,destacado&activo=eq.true&order=nombre", 0, []),
      pagina("/alertas?select=cliente_id,canal,prioridad,creada_en,host,evidencia->registrado,evidencia->registrador&order=creada_en", 0, []),
      fetch(base + "/estado?id=eq.ultima&select=datos", { headers: h }).then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (res) {
      S.clientes = res[0].sort(function (a, b) { return (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0); });
      S.alertas = res[1].map(function (a) { a.evidencia = { registrado: a.registrado, registrador: a.registrador }; return a; });
      var e = res[2][0] ? res[2][0].datos : null;
      $("t-estado").textContent = e && e.etiqueta ? "Última actualización: " + e.etiqueta : "";
    });
  }

  var espera;
  cargar().then(function () {
    controles(); render();
    var ultimo = innerWidth;      // al girar el celular o cambiar el tamaño de la ventana, se vuelve a dibujar
    addEventListener("resize", function () { if (innerWidth === ultimo) return; ultimo = innerWidth; clearTimeout(espera); espera = setTimeout(render, 150); });
  })
    .catch(function () { $("t-estado").textContent = "No se pudieron cargar los datos"; });
})();
