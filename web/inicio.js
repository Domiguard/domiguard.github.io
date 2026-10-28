/* Domiguard: portada. Pestañas de la ventana de ejemplo y cifras en vivo. Salen de la tabla estado (lectura pública), que el robot
   actualiza en cada revisión. Si no hay base (demostración) o falla la consulta, se dejan los textos de respaldo. */
(function () {
  "use strict";
  var cfg = window.DOMIGUARD_CONFIG || {};
  var BASE = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  var LLAVE = cfg.SUPABASE_ANON_KEY || "";
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function poner(clave, texto) {
    document.querySelectorAll('[data-cifra="' + clave + '"]').forEach(function (e) { e.textContent = texto; });
  }
  function numero(v) { return Number(v).toLocaleString("es-MX"); }

  function usar(d) {
    if (d.variantes_vigiladas) poner("variantes_vigiladas", numero(d.variantes_vigiladas));
    if (d.nrd_revisados) poner("nrd_revisados", numero(d.nrd_revisados));
    if (d.total) poner("total", numero(d.total));
    if (d.ultima_corrida) {
      // hora de Mérida (UTC-6, sin horario de verano)
      var t = new Date(new Date(d.ultima_corrida).getTime() - 6 * 3600 * 1000);
      var hh = String(t.getUTCHours()).padStart(2, "0"), mm = String(t.getUTCMinutes()).padStart(2, "0");
      poner("hora", hh + ":" + mm);
      poner("dia", "última revisión, " + t.getUTCDate() + " " + MESES[t.getUTCMonth()] + " (hora de Mérida)");
    }
  }

  function respaldo() {
    poner("variantes_vigiladas", "Miles de"); poner("nrd_revisados", "Cientos de miles de");
    document.querySelectorAll(".cifras").forEach(function (e) { e.hidden = true; });
  }

  /* ventana de ejemplo del panel: pestañas Alertas / Tendencias (flechas del teclado también) */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.v-lado [role="tab"]'));
  function elegir(t) {
    tabs.forEach(function (x) {
      var si = x === t;
      x.setAttribute("aria-selected", String(si)); x.tabIndex = si ? 0 : -1;
      document.getElementById(x.getAttribute("aria-controls")).hidden = !si;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { elegir(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault(); var n = tabs[(i + d + tabs.length) % tabs.length]; elegir(n); n.focus();
    });
  });

  /* semicírculo de marcas: con el cursor encima, los anillos y las marcas se desplazan un poco (más las de afuera) */
  var orb = document.querySelector(".orbita");
  var quieto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (orb && !quieto) {
    var items = orb.querySelectorAll(".o-marcas li"), anillos = orb.querySelectorAll(".o-anillos i");
    orb.addEventListener("pointermove", function (e) {
      var b = orb.getBoundingClientRect();
      var x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
      items.forEach(function (li) {
        var p = parseFloat(getComputedStyle(li).getPropertyValue("--p")) || 0.6;
        li.style.setProperty("--mx", (x * 26 * p).toFixed(1) + "px"); li.style.setProperty("--my", (y * 18 * p).toFixed(1) + "px");
      });
      anillos.forEach(function (a, i) { a.style.transform = "translate(calc(-50% + " + (x * (4 + i * 3)).toFixed(1) + "px), calc(50% + " + (y * (3 + i * 2)).toFixed(1) + "px))"; });
    });
    orb.addEventListener("pointerleave", function () {
      items.forEach(function (li) { li.style.setProperty("--mx", "0px"); li.style.setProperty("--my", "0px"); });
      anillos.forEach(function (a) { a.style.transform = ""; });
    });
  }

  if (!BASE || /TU-PROYECTO/.test(BASE)) { respaldo(); return; }
  var h = { apikey: LLAVE };
  if (LLAVE.indexOf("eyJ") === 0) h.Authorization = "Bearer " + LLAVE;
  fetch(BASE + "/rest/v1/estado?id=eq.ultima&select=datos", { headers: h })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (filas) { if (!filas.length) throw new Error("vacío"); usar(filas[0].datos || {}); })
    .catch(respaldo);
})();
