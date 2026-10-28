// Domiguard: acepta (o descarta) una solicitud de contratación desde el enlace del correo de aviso e invita al cliente.
// La llama la página aceptar.html. Solo funciona con el enlace firmado que manda avisar-solicitud: la firma es un
// HMAC del id de la solicitud con la llave de servicio, así que nadie puede fabricar un enlace válido.
// Aceptar: pone el banco (cliente_id) y estado 'activa' (el disparador activar_solicitud suma sus dominios y activa
// la cuenta si ya existía) y después invita al correo con Supabase Auth; si la cuenta ya existía, le avisa por correo.
// Secretos: los mismos de avisar-solicitud (SMTP_USER, SMTP_PASS), para el aviso a una cuenta que ya existía.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PANEL = "https://domiguard.github.io/panel.html";
const CORS = {
  "Access-Control-Allow-Origin": "https://domiguard.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function firma(id: number | string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(LLAVE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("aceptar:" + id)));
  return Array.from(s.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function base(ruta: string, init: RequestInit = {}) {
  return fetch(URL_BASE + ruta, {
    ...init,
    headers: { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function esc(t: unknown) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

async function avisarActivo(correo: string, banco: string) {
  const usuario = Deno.env.get("SMTP_USER") || "";
  const clave = (Deno.env.get("SMTP_PASS") || "").replace(/\s/g, "");
  if (!usuario || !clave) return false;
  const cliente = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: usuario, password: clave } } });
  try {
    await cliente.send({
      from: `Domiguard <${usuario}>`, to: correo, subject: "Tu panel de Domiguard ya está activo",
      content: `Aceptamos tu contratación. Tu panel ya muestra las alertas de ${banco}.\n\nEntra con tu correo y tu contraseña: ${PANEL}\n\nDomiguard`,
      html: `<h2>Tu panel ya está activo</h2><p>Aceptamos tu contratación. Tu panel ya muestra las alertas de <b>${esc(banco)}</b>.</p>
<p><a href="${PANEL}" style="display:inline-block;background:#11212D;color:#CCD0CF;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Entrar a mi panel</a></p>
<p style="color:#4A5C6A">Entra con tu correo y la contraseña que ya creaste.</p>`,
    });
    return true;
  } catch (e) {
    console.error("No se pudo avisar al cliente:", e);
    return false;
  } finally {
    await cliente.close();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);
  let d: Record<string, any>;
  try { d = await req.json(); } catch { return respuesta({ error: "Datos no válidos" }, 400); }
  const id = Number(d.id);
  if (!Number.isInteger(id) || id <= 0 || typeof d.t !== "string" || !iguales(d.t, await firma(id))) {
    return respuesta({ error: "El enlace no es válido." }, 403);
  }

  const r = await base(`/rest/v1/solicitudes?id=eq.${id}&select=id,plan,empresa,dominios,correo,estado,cliente_id,creada_en`);
  const s = (await r.json())[0];
  if (!s) return respuesta({ error: "La solicitud ya no existe." }, 404);

  if (d.accion === "ver") {
    const c = await base("/rest/v1/clientes?select=id,nombre&order=id");
    return respuesta({ solicitud: s, clientes: await c.json() });
  }
  if (s.estado === "activa" || s.estado === "descartada") {
    return respuesta({ error: s.estado === "activa" ? "Esta solicitud ya fue aceptada." : "Esta solicitud ya fue descartada.", solicitud: s }, 409);
  }
  if (d.accion === "descartar") {
    await base(`/rest/v1/solicitudes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ estado: "descartada" }) });
    return respuesta({ ok: true, estado: "descartada" });
  }
  if (d.accion !== "aceptar") return respuesta({ error: "Acción no válida" }, 400);

  const banco = String(d.cliente_id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(banco)) return respuesta({ error: "El banco debe ir en minúsculas, sin espacios (por ejemplo bbva)." }, 400);

  // 1. activar la solicitud: el disparador suma los dominios del banco y activa la cuenta si ya existía
  const a = await base(`/rest/v1/solicitudes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ cliente_id: banco, estado: "activa" }) });
  if (!a.ok) return respuesta({ error: "No se pudo activar la solicitud: " + (await a.text()).slice(0, 200) }, 500);
  const nombre = ((await (await base(`/rest/v1/clientes?id=eq.${banco}&select=nombre`)).json())[0] || {}).nombre || banco;

  // 2. invitar al correo: Supabase le manda el enlace para crear su contraseña y entrar a su panel
  const inv = await base(`/auth/v1/invite?redirect_to=${encodeURIComponent(PANEL)}`, { method: "POST", body: JSON.stringify({ email: s.correo }) });
  if (inv.ok) return respuesta({ ok: true, estado: "activa", banco: nombre, invitacion: "enviada", correo: s.correo });
  const err = await inv.text();
  if (/already|exists|registered/i.test(err)) {
    const avisado = await avisarActivo(s.correo, nombre);
    return respuesta({ ok: true, estado: "activa", banco: nombre, invitacion: avisado ? "ya_tenia_cuenta" : "ya_tenia_cuenta_sin_aviso", correo: s.correo });
  }
  console.error("No se pudo invitar:", inv.status, err);
  return respuesta({ ok: true, estado: "activa", banco: nombre, invitacion: "fallo", detalle: err.slice(0, 200), correo: s.correo });
});
