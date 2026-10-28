/* Domiguard: cuentas de clientes (Supabase Auth). El panel se activa cuando el equipo de Domiguard acepta
   la contratación de un plan (tabla solicitudes) hecha con el MISMO correo de la cuenta: ahí la base le asigna
   su banco (perfiles.cliente_id) y la aprueba. La base solo entrega las alertas de ese banco: lo garantizan
   las reglas de supabase/schema.sql, no esta página. */
(function () {
  "use strict";
  var cfg = window.DOMIGUARD_CONFIG || {};
  var BASE = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  var CLAVE = "domiguard.sesion";
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  /* la sesión se recuerda en este navegador; si el navegador no deja guardarla, dura mientras la pestaña esté abierta */
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch (e) { return null; } }
  var actual = leer();
  function guardar(s) { actual = s; try { if (s) localStorage.setItem(CLAVE, JSON.stringify(s)); else localStorage.removeItem(CLAVE); } catch (e) {} }

  /* Al confirmar el correo, Supabase regresa a esta página con la sesión en la dirección (#access_token=...):
     se guarda y se limpia la dirección para que la llave no quede a la vista. */
  var errorEnlace = "", tipoEnlace = "";
  (function desdeEnlace() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (!h.get("access_token") && !h.get("error")) return;
    if (h.get("access_token")) {
      tipoEnlace = h.get("type") || "";          // "invite": llegó por la invitación y todavía no tiene contraseña
      var correo = "";
      try { correo = JSON.parse(atob(h.get("access_token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch (e) {}
      guardar({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), correo: correo,
                expira: Number(h.get("expires_at")) || Math.floor(Date.now() / 1000) + (Number(h.get("expires_in")) || 3600) });
    } else {
      errorEnlace = /expired|invalid/i.test(h.get("error_description") || "") ? "El enlace ya venció o ya se usó. Inicia sesión; si no tienes contraseña, pídele al equipo de Domiguard una invitación nueva."
                                                                              : "No se pudo confirmar el correo. Vuelve a intentarlo.";
    }
    history.replaceState(null, "", location.pathname + location.search);
  })();

  var MENSAJES = [
    [/invalid login credentials/i, "El correo o la contraseña no coinciden."],
    [/already registered|already been registered|user already exists/i, "Ya existe una cuenta con ese correo. Inicia sesión."],
    [/password should be at least|weak password|password is too short/i, "La contraseña debe tener al menos 6 caracteres."],
    [/unable to validate email|invalid email|email address .* is invalid/i, "Revisa que el correo esté bien escrito."],
    [/database error saving new user/i, "No se pudo crear la cuenta. Vuelve a intentarlo en un momento."],
    [/rate limit|too many requests/i, "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar."],
    [/email not confirmed/i, "Falta confirmar el correo de esta cuenta."],
    [/signups not allowed|signup is disabled/i, "Por ahora no se pueden crear cuentas nuevas."]
  ];
  function mensaje(d) {
    var t = (d && (d.msg || d.message || d.error_description || d.error)) || "";
    for (var i = 0; i < MENSAJES.length; i++) if (MENSAJES[i][0].test(t)) return MENSAJES[i][1];
    return "No se pudo completar. Vuelve a intentarlo en un momento.";
  }
  function auth(ruta, cuerpo, token, metodo) {
    var h = { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(BASE + "/auth/v1" + ruta, { method: metodo || "POST", headers: h, body: JSON.stringify(cuerpo || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(mensaje(d)); return d; }); });
  }
  function aSesion(d) {
    if (!d || !d.access_token) return null;
    return { access_token: d.access_token, refresh_token: d.refresh_token, correo: d.user && d.user.email,
             expira: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) };
  }
  /* la llave de acceso dura una hora: se renueva sola un minuto antes */
  function vigente() {
    var s = actual;
    if (!s) return Promise.resolve(null);
    if (s.expira - 60 > Date.now() / 1000) return Promise.resolve(s);
    return auth("/token?grant_type=refresh_token", { refresh_token: s.refresh_token })
      .then(function (d) { var n = aSesion(d); if (n && !n.correo) n.correo = s.correo; guardar(n); return n; })
      .catch(function () { guardar(null); return null; });
  }
  function encabezados() {
    return vigente().then(function (s) {
      var h = { apikey: cfg.SUPABASE_ANON_KEY };
      if (s) h.Authorization = "Bearer " + s.access_token;
      else if (/^eyJ/.test(cfg.SUPABASE_ANON_KEY || "")) h.Authorization = "Bearer " + cfg.SUPABASE_ANON_KEY;  // llaves antiguas
      return h;
    });
  }
  function rest(ruta) {
    return encabezados().then(function (h) { return fetch(BASE + "/rest/v1" + ruta, { headers: h }); })
      .then(function (r) { if (!r.ok) throw new Error(ruta + " " + r.status); return r.json(); });
  }
  function entrar(correo, clave) { return auth("/token?grant_type=password", { email: correo, password: clave }).then(function (d) { guardar(aSesion(d)); return actual; }); }
  function registrar(correo, clave) {
    /* el enlace del correo de confirmación regresa a esta misma página (debe estar en Supabase > URL Configuration) */
    var regreso = location.origin + location.pathname;
    return auth("/signup?redirect_to=" + encodeURIComponent(regreso), { email: correo, password: clave })
      .then(function (d) { var s = aSesion(d); if (s) guardar(s); return s; });   // sin sesión si Supabase pide confirmar el correo
  }
  function salir() { var s = actual; guardar(null); if (s) auth("/logout", {}, s.access_token).catch(function () {}); location.reload(); }
  function perfil() { return rest("/perfiles?select=user_id,cliente_id,aprobado,correo").then(function (f) { return f[0] || null; }); }

  /* ---------- pantalla de acceso ---------- */
  function campo(id, texto, tipo, extra) {
    var f = el("div", "field"), l = el("label", "", texto), i = el(tipo === "select" ? "select" : "input");
    l.htmlFor = id; i.id = id; if (tipo !== "select") i.type = tipo;
    for (var k in (extra || {})) i.setAttribute(k, extra[k]);
    f.appendChild(l); f.appendChild(i); return f;
  }
  /* Olvidé mi contraseña: Supabase manda un enlace que regresa a esta página con type=recovery (ahí se crea la nueva) */
  function olvido(caja, clientes, alEntrar) {
    caja.textContent = "";
    var card = el("div", "card acceso");
    card.appendChild(el("h3", "", "¿Olvidaste tu contraseña?"));
    card.appendChild(el("p", "", "Escribe el correo de tu cuenta y te mandamos un enlace para crear una contraseña nueva."));
    var form = el("form", "form");
    form.appendChild(campo("ac-correo", "Correo", "email", { required: "", autocomplete: "email" }));
    var btn = el("button", "btn p", "Enviar enlace"); btn.type = "submit";
    var pie = el("div", "acceso-pie"); pie.appendChild(btn); form.appendChild(pie);
    var aviso = el("p", "msg no"); aviso.hidden = true; aviso.setAttribute("role", "alert"); form.appendChild(aviso);
    form.onsubmit = function (e) {
      e.preventDefault(); aviso.hidden = true; btn.disabled = true;
      var correo = form.querySelector("#ac-correo").value.trim();
      auth("/recover?redirect_to=" + encodeURIComponent(location.origin + location.pathname), { email: correo })
        .then(function () {
          // mismo mensaje exista o no la cuenta, para que nadie pueda averiguar quién es cliente
          aviso.className = "msg ok"; aviso.textContent = "Si existe una cuenta con ese correo, te mandamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam."; aviso.hidden = false;
        })
        .catch(function (err) { aviso.className = "msg no"; aviso.textContent = err.message; aviso.hidden = false; btn.disabled = false; });
    };
    card.appendChild(form);
    var volver = el("button", "enlace", "Volver a iniciar sesión"); volver.type = "button";
    volver.onclick = function () { formulario(caja, clientes, "entrar", alEntrar); };
    card.appendChild(volver);
    caja.appendChild(card);
    form.querySelector("input").focus();
  }
  function formulario(caja, clientes, modo, alEntrar) {
    caja.textContent = "";
    var card = el("div", "card acceso");
    var pest = el("div", "chips"); pest.setAttribute("role", "group"); pest.setAttribute("aria-label", "Elegir acción");
    [["entrar", "Iniciar sesión"], ["crear", "Crear cuenta"]].forEach(function (p) {
      var b = el("button", "chip", p[1]); b.type = "button"; b.setAttribute("aria-pressed", String(modo === p[0]));
      b.onclick = function () { formulario(caja, clientes, p[0], alEntrar); }; pest.appendChild(b);
    });
    card.appendChild(pest);
    var form = el("form", "form"); form.noValidate = false;
    form.appendChild(campo("ac-correo", "Correo", "email", { required: "", autocomplete: "email" }));
    form.appendChild(campo("ac-clave", "Contraseña", "password", { required: "", minlength: "6", autocomplete: modo === "crear" ? "new-password" : "current-password" }));
    var btn = el("button", "btn p", modo === "crear" ? "Crear cuenta" : "Entrar"); btn.type = "submit";
    var pie = el("div", "acceso-pie"); pie.appendChild(btn); form.appendChild(pie);
    var aviso = el("p", "msg no"); aviso.hidden = true; aviso.setAttribute("role", "alert");
    form.appendChild(aviso);
    if (modo === "crear") form.appendChild(el("p", "note", "Usa el mismo correo con el que contrataste tu plan. Tu panel se activa con tu banco cuando el equipo de Domiguard acepte la contratación."));
    if (modo === "entrar") {
      var olv = el("button", "enlace", "¿Olvidaste tu contraseña?"); olv.type = "button";
      olv.onclick = function () { olvido(caja, clientes, alEntrar); };
      form.appendChild(olv);
    }
    form.onsubmit = function (e) {
      e.preventDefault(); aviso.hidden = true; btn.disabled = true;
      var correo = form.querySelector("#ac-correo").value.trim(), clave = form.querySelector("#ac-clave").value;
      var p = modo === "crear" ? registrar(correo, clave) : entrar(correo, clave);
      p.then(function (s) {
        if (s) { alEntrar(); return; }
        aviso.className = "msg ok"; aviso.textContent = "Cuenta creada. Te mandamos un correo a " + correo + ": abre el enlace para confirmarla y entrarás a tu panel. Si no lo ves, revisa la carpeta de spam."; aviso.hidden = false; btn.disabled = false;
      }).catch(function (err) { aviso.className = "msg no"; aviso.textContent = err.message; aviso.hidden = false; btn.disabled = false; });
    };
    card.appendChild(form); caja.appendChild(card);
    var primero = card.querySelector("input"); if (primero) primero.focus();
  }
  /* Invitación: la persona entra con el enlace del correo y aquí crea la contraseña para sus próximas visitas */
  function crearClave(caja, correo, alTerminar) {
    caja.textContent = "";
    var card = el("div", "card acceso");
    var nueva = tipoEnlace === "recovery";
    card.appendChild(el("h3", "", nueva ? "Crea tu nueva contraseña" : "Crea tu contraseña"));
    card.appendChild(el("p", "", nueva ? "Escribe una contraseña nueva para " + correo + ". Desde ahora entrarás con ella."
                                       : "Bienvenido a Domiguard. Crea una contraseña para " + correo + "; la usarás para entrar a tu panel la próxima vez."));
    var form = el("form", "form");
    form.appendChild(campo("ac-nueva", "Contraseña nueva", "password", { required: "", minlength: "6", autocomplete: "new-password" }));
    form.appendChild(campo("ac-repite", "Repite la contraseña", "password", { required: "", minlength: "6", autocomplete: "new-password" }));
    var btn = el("button", "btn p", "Guardar y entrar"); btn.type = "submit";
    var pie = el("div", "acceso-pie"); pie.appendChild(btn); form.appendChild(pie);
    var aviso = el("p", "msg no"); aviso.hidden = true; aviso.setAttribute("role", "alert"); form.appendChild(aviso);
    form.onsubmit = function (e) {
      e.preventDefault(); aviso.hidden = true;
      var a = form.querySelector("#ac-nueva").value, b = form.querySelector("#ac-repite").value;
      if (a !== b) { aviso.textContent = "Las dos contraseñas no coinciden."; aviso.hidden = false; return; }
      btn.disabled = true;
      vigente().then(function (s) {
        if (!s) throw new Error("La sesión venció. Pídele al equipo de Domiguard una invitación nueva.");
        return auth("/user", { password: a }, s.access_token, "PUT");
      }).then(function () { tipoEnlace = ""; alTerminar(); })
        .catch(function (err) { aviso.textContent = err.message; aviso.hidden = false; btn.disabled = false; });
    };
    card.appendChild(form); caja.appendChild(card);
    form.querySelector("input").focus();
  }
  function barra(correo, nombreBanco) {
    var b = document.getElementById("sesion-barra"); if (!b) return;
    b.textContent = "";
    b.appendChild(el("span", "", (nombreBanco ? nombreBanco + " · " : "") + (correo || "")));
    var s = el("button", "salir", "Cerrar sesión"); s.type = "button"; s.onclick = salir; b.appendChild(s);
  }
  /* Muestra el formulario, el aviso de "pendiente" o el contenido; llama listo(perfil) cuando la cuenta está aprobada. */
  function proteger(listo) {
    var caja = document.getElementById("acceso"), contenido = document.getElementById("contenido");
    var estado = document.getElementById("m-estado") || document.getElementById("t-estado");
    function sinSesion() {
      contenido.hidden = true; caja.hidden = false; if (estado) estado.textContent = "";
      formulario(caja, [], "entrar", revisar);
      if (errorEnlace) { var a = caja.querySelector("[role=alert]"); a.className = "msg no"; a.textContent = errorEnlace; a.hidden = false; errorEnlace = ""; }
    }
    function revisar() {
      vigente().then(function (s) {
        if (!s) { sinSesion(); return; }
        if (tipoEnlace === "invite" || tipoEnlace === "recovery") {
          contenido.hidden = true; caja.hidden = false; if (estado) estado.textContent = "";
          crearClave(caja, s.correo, revisar); return;
        }
        return Promise.all([perfil(), rest("/clientes?select=id,nombre")]).then(function (res) {
          var p = res[0], nombres = {}; res[1].forEach(function (c) { nombres[c.id] = c.nombre; });
          barra(s.correo, p && nombres[p.cliente_id]);
          menu();
          if (p && p.aprobado) { caja.hidden = true; contenido.hidden = false; listo(p); return; }
          contenido.hidden = true; caja.hidden = false; caja.textContent = ""; if (estado) estado.textContent = "";
          var card = el("div", "card acceso");
          if (p && p.cliente_id) {          // tenía plan, pero el equipo lo suspendió o lo está revisando
            card.appendChild(el("h3", "", "Tu plan está en revisión"));
            card.appendChild(el("p", "", "Tu cuenta corresponde a " + (nombres[p.cliente_id] || p.cliente_id) + ". En cuanto el equipo de Domiguard reactive tu plan, aquí verás sus alertas."));
          } else {
            card.appendChild(el("h3", "", "Tu cuenta está lista; falta activar tu plan"));
            card.appendChild(el("p", "", "Todavía no hay un plan aceptado con el correo " + s.correo + ". Contrata un plan con este mismo correo; en cuanto el equipo de Domiguard lo acepte, tu panel se activa con tu banco."));
            var ir = el("a", "btn p", "Ver planes"); ir.href = "planes.html"; card.appendChild(ir);
          }
          var otra = el("button", "btn s", "Volver a revisar"); otra.type = "button"; otra.onclick = revisar; card.appendChild(otra);
          caja.appendChild(card);
        });
      }).catch(function () { caja.hidden = false; caja.textContent = ""; caja.appendChild(el("p", "msg no", "No se pudo conectar. Vuelve a intentarlo en un momento.")); });
    }
    revisar();
  }

  /* Menú según la cuenta: el visitante ve "Entrar"; una cuenta con plan aceptado ve Tendencias y Panel del cliente;
     una cuenta sin plan aceptado ve "Mi cuenta". Los elementos llevan data-menu="cliente" o data-menu="visitante". */
  function menu() {
    function poner(modo) {
      document.querySelectorAll('[data-menu="cliente"]').forEach(function (e) { e.hidden = modo !== "cliente"; });
      document.querySelectorAll('[data-menu="visitante"]').forEach(function (e) {
        e.hidden = modo === "cliente";
        var a = e.querySelector("a") || e; if (a.dataset.textoVisitante === undefined) a.dataset.textoVisitante = a.textContent;
        a.textContent = modo === "pendiente" ? "Mi cuenta" : a.dataset.textoVisitante;
      });
    }
    if (!BASE) { poner("cliente"); return Promise.resolve(); }      // demostración sin base: todo visible
    return vigente().then(function (s) {
      if (!s) { poner("visitante"); return; }
      return perfil().then(function (p) { poner(p && p.aprobado ? "cliente" : "pendiente"); });
    }).catch(function () { poner(actual ? "pendiente" : "visitante"); });
  }

  window.DomiguardSesion = { encabezados: encabezados, proteger: proteger, salir: salir, menu: menu };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", menu); else menu();
})();
