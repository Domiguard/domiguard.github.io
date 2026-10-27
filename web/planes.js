/* Domiguard: contratar un plan. Pago de DEMOSTRACIÓN (no se cobra ni se piden datos de tarjeta) y después
   un formulario con los dominios y el correo de alertas, que se guarda en Supabase (tabla solicitudes).
   La página solo puede agregar solicitudes; el equipo de Domiguard las ve en Table Editor. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  var cfg = window.DOMIGUARD_CONFIG || {};
  var PLANES = {
    basico: { nombre: "Básico", precio: "USD 250 al mes", max: 3, detalle: "Hasta 3 dominios" },
    profesional: { nombre: "Profesional", precio: "USD 700 al mes", max: 10, detalle: "Hasta 10 dominios" },
    empresarial: { nombre: "Empresarial", precio: "Desde USD 1,500 al mes", max: 100, detalle: "Más de 10 dominios" }
  };
  var caja = $("contratar");

  /* "https://www.mibanco.mx/login" -> "mibanco.mx"; solo nombres de dominio válidos, sin repetir */
  function limpiarDominios(texto) {
    var vistos = {}, buenos = [], malos = [];
    String(texto).split(/[\s,;]+/).forEach(function (d) {
      d = d.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
      if (!d) return;
      if (/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) { if (!vistos[d]) { vistos[d] = 1; buenos.push(d); } }
      else malos.push(d);
    });
    return { buenos: buenos, malos: malos };
  }
  function mostrar(paso) { caja.hidden = false; caja.textContent = ""; caja.appendChild(paso); caja.scrollIntoView({ behavior: "smooth", block: "start" }); var f = paso.querySelector("input, textarea, button"); if (f) f.focus({ preventScroll: true }); }
  function encabezado(card, plan, titulo) {
    card.appendChild(el("p", "tiny paso", titulo));
    card.appendChild(el("h3", "", "Plan " + plan.nombre));
    card.appendChild(el("p", "lead", plan.precio + " · " + plan.detalle));
  }

  /* 1. resumen y pago de demostración */
  function resumen(clave) {
    var plan = PLANES[clave], card = el("div", "card contratar");
    encabezado(card, plan, "Paso 1 de 2 · Pago");
    var demo = el("div", "msg aviso-demo");
    demo.appendChild(el("strong", "", "Demostración: "));
    demo.appendChild(document.createTextNode("no se realiza ningún cobro ni se piden datos de tarjeta. En la versión comercial, aquí iría el pago seguro de un proveedor como Stripe o Mercado Pago."));
    card.appendChild(demo);
    var fila = el("div", "acciones");
    var ok = el("button", "btn p", "Confirmar pago (demostración)"); ok.type = "button"; ok.onclick = function () { formulario(clave); };
    var no = el("button", "btn s", "Cancelar"); no.type = "button"; no.onclick = function () { caja.hidden = true; caja.textContent = ""; };
    fila.appendChild(ok); fila.appendChild(no); card.appendChild(fila);
    mostrar(card);
  }

  /* 2. formulario: dominios y correo de alertas */
  function formulario(clave) {
    var plan = PLANES[clave], card = el("div", "card contratar");
    encabezado(card, plan, "Paso 2 de 2 · Qué vigilamos");
    card.appendChild(el("p", "msg ok", "Pago confirmado (demostración). Ahora dinos qué dominios quieres proteger y a dónde te mandamos las alertas."));
    var form = el("form", "form");
    function campo(id, texto, nodo, ayuda) {
      var f = el("div", "field"), l = el("label", "", texto); l.htmlFor = id; nodo.id = id; f.appendChild(l); f.appendChild(nodo);
      if (ayuda) { var a = el("span", "tiny", ayuda); a.id = id + "-ayuda"; nodo.setAttribute("aria-describedby", a.id); f.appendChild(a); }
      form.appendChild(f); return nodo;
    }
    var empresa = campo("sol-empresa", "Nombre de tu banco o empresa (opcional)", el("input"));
    empresa.type = "text"; empresa.maxLength = 120; empresa.autocomplete = "organization";
    var dom = campo("sol-dominios", "Dominios que quieres proteger", el("textarea"),
      "Uno por línea, por ejemplo mibanco.mx. Tu plan incluye " + (plan.max >= 100 ? "más de 10 dominios" : "hasta " + plan.max) + ".");
    dom.rows = 4; dom.required = true; dom.spellcheck = false; dom.autocapitalize = "none";
    var correo = campo("sol-correo", "Correo donde te mandamos las alertas", el("input"), "De preferencia, el del equipo de seguridad.");
    correo.type = "email"; correo.required = true; correo.maxLength = 254; correo.autocomplete = "email";
    var aviso = el("p", "msg no"); aviso.hidden = true; aviso.setAttribute("role", "alert");
    var btn = el("button", "btn p", "Enviar solicitud"); btn.type = "submit";
    var fila = el("div", "acciones"); fila.appendChild(btn); form.appendChild(fila); form.appendChild(aviso);
    form.onsubmit = function (e) {
      e.preventDefault(); aviso.hidden = true;
      var d = limpiarDominios(dom.value), c = correo.value.trim();
      var error = !d.buenos.length ? "Escribe al menos un dominio, por ejemplo mibanco.mx."
        : d.malos.length ? "Revisa estos dominios: " + d.malos.slice(0, 5).join(", ") + "."
        : d.buenos.length > plan.max ? "Tu plan incluye hasta " + plan.max + " dominios y escribiste " + d.buenos.length + ". Quita algunos o elige otro plan."
        : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? "Revisa que el correo esté bien escrito." : "";
      if (error) { aviso.textContent = error; aviso.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Enviando…";
      var cuerpo = { plan: clave, dominios: d.buenos, correo: c };
      if (empresa.value.trim()) cuerpo.empresa = empresa.value.trim();
      fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/solicitudes", {
        method: "POST",
        headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(cuerpo)
      }).then(function (r) { if (!r.ok) throw new Error(r.status); listo(plan, d.buenos, c); })
        .catch(function () { aviso.textContent = "No se pudo enviar. Revisa tu conexión y vuelve a intentarlo."; aviso.hidden = false; btn.disabled = false; btn.textContent = "Enviar solicitud"; });
    };
    card.appendChild(form);
    mostrar(card);
  }

  /* 3. confirmación */
  function listo(plan, dominios, correo) {
    var card = el("div", "card contratar");
    card.appendChild(el("h3", "", "¡Recibimos tu solicitud!"));
    card.appendChild(el("p", "", "El equipo de Domiguard dará de alta " + (dominios.length === 1 ? "tu dominio" : "tus " + dominios.length + " dominios") +
      " en el plan " + plan.nombre + " y te escribirá a " + correo + "."));
    var lista = el("div", "chips"); dominios.forEach(function (d) { lista.appendChild(el("span", "tag mono", d)); }); card.appendChild(lista);
    card.appendChild(el("p", "tiny", "Para ver tus alertas, crea tu cuenta en el panel del cliente con el mismo correo."));
    mostrar(card);
  }

  document.querySelectorAll("[data-plan]").forEach(function (b) { b.addEventListener("click", function () { resumen(b.getAttribute("data-plan")); }); });
})();
