/* Domiguard: página del equipo para aceptar o descartar una solicitud de contratación.
   Se abre desde el botón del correo de aviso (aceptar.html#id=..&t=..). La firma t la comprueba la función
   aceptar-solicitud en Supabase: sin un enlace válido no se ve ni se cambia nada. */
(function () {
  "use strict";
  var cfg = window.DOMIGUARD_CONFIG || {};
  var FUNCION = (cfg.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/aceptar-solicitud";
  var PLANES = { basico: "Básico (hasta 3 dominios)", profesional: "Profesional (hasta 10 dominios)", empresarial: "Empresarial (más de 10 dominios)" };
  var caja = document.getElementById("caja");
  var h = new URLSearchParams(location.hash.replace(/^#/, ""));
  var ID = h.get("id"), T = h.get("t");

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function llamar(cuerpo) {
    var hd = { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
    if (/^eyJ/.test(cfg.SUPABASE_ANON_KEY || "")) hd.Authorization = "Bearer " + cfg.SUPABASE_ANON_KEY;
    cuerpo.id = ID; cuerpo.t = T;
    return fetch(FUNCION, { method: "POST", headers: hd, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }
  function aviso(clase, texto) { caja.textContent = ""; var p = el("p", "msg " + clase, texto); caja.appendChild(p); return p; }
  /* sugerencia de banco: el que ya coincide con un dominio, si no, el nombre del primer dominio */
  function sugerir(s, clientes) {
    var nombre = (s.dominios[0] || "").replace(/^www\./, "").split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
    var ya = clientes.filter(function (c) { return c.id === nombre; })[0];
    return ya ? ya.id : nombre;
  }
  function dato(dl, k, v) { dl.appendChild(el("dt", "", k)); var dd = el("dd", "", v); dl.appendChild(dd); return dd; }

  function mostrar(d) {
    var s = d.solicitud, clientes = d.clientes || [];
    caja.textContent = "";
    var card = el("div", "card contratar");
    card.appendChild(el("p", "tiny paso", "Solicitud " + s.id + " · " + new Date(s.creada_en).toLocaleString("es-MX", { timeZone: "America/Merida", dateStyle: "long", timeStyle: "short" })));
    card.appendChild(el("h3", "", s.empresa || s.correo));
    var ev = el("div", "ev"), dl = el("dl");
    dato(dl, "Plan", PLANES[s.plan] || s.plan);
    dato(dl, "Correo", s.correo);
    dato(dl, "Dominios", s.dominios.join(", ")).className = "mono";
    ev.appendChild(dl); card.appendChild(ev);

    if (s.estado === "activa" || s.estado === "descartada") {
      card.appendChild(el("p", "msg " + (s.estado === "activa" ? "ok" : "no"), s.estado === "activa" ? "Esta solicitud ya fue aceptada (banco: " + s.cliente_id + ")." : "Esta solicitud ya fue descartada."));
      caja.appendChild(card); return;
    }

    var form = el("form", "form");
    var f = el("div", "field"), l = el("label", "", "Banco del cliente"), i = el("input");
    l.htmlFor = "banco"; i.id = "banco"; i.type = "text"; i.required = true; i.autocomplete = "off"; i.setAttribute("list", "bancos");
    i.pattern = "[a-z0-9][a-z0-9\\-]{1,39}"; i.value = sugerir(s, clientes);
    var lista = el("datalist"); lista.id = "bancos";
    clientes.forEach(function (c) { var o = el("option"); o.value = c.id; o.label = c.nombre; lista.appendChild(o); });
    f.appendChild(l); f.appendChild(i); f.appendChild(lista);
    f.appendChild(el("span", "tiny", "Uno existente (" + clientes.map(function (c) { return c.id; }).join(", ") + ") o uno nuevo en minúsculas, sin espacios."));
    form.appendChild(f);
    var acciones = el("div", "acciones");
    var ok = el("button", "btn p", "Aceptar e invitar"); ok.type = "submit";
    var no = el("button", "btn s", "Descartar"); no.type = "button";
    acciones.appendChild(ok); acciones.appendChild(no); form.appendChild(acciones);
    var msg = el("p", "msg no"); msg.hidden = true; msg.setAttribute("role", "alert"); form.appendChild(msg);
    card.appendChild(form); caja.appendChild(card);

    function ocupado(si) { ok.disabled = no.disabled = i.disabled = si; }
    form.onsubmit = function (e) {
      e.preventDefault(); msg.hidden = true; ocupado(true); ok.textContent = "Aceptando…";
      llamar({ accion: "aceptar", cliente_id: i.value.trim().toLowerCase() }).then(function (r) {
        if (!r.ok) { msg.textContent = r.error || "No se pudo aceptar. Vuelve a intentarlo."; msg.hidden = false; ocupado(false); ok.textContent = "Aceptar e invitar"; return; }
        var texto = {
          enviada: "Le enviamos la invitación a " + r.correo + ". Al abrirla crea su contraseña y entra a su panel.",
          ya_tenia_cuenta: r.correo + " ya tenía cuenta: su panel quedó activo y le avisamos por correo.",
          ya_tenia_cuenta_sin_aviso: r.correo + " ya tenía cuenta: su panel quedó activo, pero no se pudo mandarle el aviso por correo.",
          fallo: "La solicitud quedó aceptada, pero no se pudo enviar la invitación a " + r.correo + ". Pídele que cree su cuenta en el panel con ese correo."
        }[r.invitacion] || "Solicitud aceptada.";
        caja.textContent = "";
        var c = el("div", "card contratar");
        c.appendChild(el("h3", "", "Solicitud aceptada · " + r.banco));
        c.appendChild(el("p", "msg " + (r.invitacion === "fallo" ? "no" : "ok"), texto));
        caja.appendChild(c);
      }).catch(function () { msg.textContent = "No se pudo conectar. Revisa tu internet y vuelve a intentarlo."; msg.hidden = false; ocupado(false); ok.textContent = "Aceptar e invitar"; });
    };
    no.onclick = function () {
      if (!window.confirm("¿Descartar la solicitud de " + s.correo + "? No se le avisa nada al cliente.")) return;
      ocupado(true);
      llamar({ accion: "descartar" }).then(function (r) {
        if (r.ok) aviso("ok", "Solicitud descartada."); else { msg.textContent = r.error || "No se pudo descartar."; msg.hidden = false; ocupado(false); }
      }).catch(function () { msg.textContent = "No se pudo conectar."; msg.hidden = false; ocupado(false); });
    };
  }

  if (!ID || !T || !cfg.SUPABASE_URL) { aviso("no", "Este enlace no es válido. Ábrelo desde el botón «Aceptar solicitud» del correo de aviso."); return; }
  llamar({ accion: "ver" }).then(function (d) {
    if (d.solicitud && d._status === 200) mostrar(d);
    else aviso("no", d.error || "No se pudo abrir la solicitud.");
  }).catch(function () { aviso("no", "No se pudo conectar. Revisa tu internet y vuelve a intentarlo."); });
})();
