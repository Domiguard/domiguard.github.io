// Domiguard: avisa al instante por correo al equipo cada solicitud de contratación (tabla solicitudes).
// La dispara un Database Webhook al insertar en solicitudes. No confía en lo que recibe: siempre lee de la base
// las solicitudes sin avisar (notificada_en vacío), manda un correo por cada una y las marca como avisadas.
// Secretos de la función (Supabase > Edge Functions > Secrets): SMTP_USER (Gmail), SMTP_PASS (contraseña de
// aplicación) y AVISOS_CORREO (a quién llega el aviso). Gmail por el puerto 465: las funciones no salen por el 587.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EDITOR = "https://supabase.com/dashboard/project/lrjlrznvhdoiciwitthf/editor";
const PLANES: Record<string, string> = {
  basico: "Básico (hasta 3 dominios)",
  profesional: "Profesional (hasta 10 dominios)",
  empresarial: "Empresarial (más de 10 dominios)",
};

// Enlace firmado para aceptar la solicitud desde el correo (lo comprueba la función aceptar-solicitud)
async function firma(id: number | string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(LLAVE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("aceptar:" + id)));
  return Array.from(s.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
const ACEPTAR = "https://domiguard.github.io/aceptar.html";

function encabezados(extra: Record<string, string> = {}) {
  return { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, "Content-Type": "application/json", ...extra };
}
function esc(t: unknown) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function correo(s: Record<string, any>, enlace: string) {
  const plan = PLANES[s.plan] || s.plan;
  const dominios: string[] = s.dominios || [];
  const fecha = new Date(s.creada_en).toLocaleString("es-MX", { timeZone: "America/Merida", dateStyle: "long", timeStyle: "short" });
  const pasos = [
    `Abre el enlace para aceptarla: ${enlace}`,
    "Elige el banco (uno existente como bbva o uno nuevo en minúsculas) y toca Aceptar e invitar.",
    "Sus dominios se suman solos a la vigilancia y al cliente le llega la invitación para entrar a su panel.",
  ];
  const texto = [
    "Nueva solicitud de contratación en Domiguard (pago de demostración).", "",
    `Plan: ${plan}`, `Empresa: ${s.empresa || "(no la escribió)"}`, `Correo para alertas: ${s.correo}`, `Fecha: ${fecha} (hora de Mérida)`, "",
    `Dominios (${dominios.length}):`, ...dominios.map((d) => `  - ${d}`), "",
    "Para aceptarla:", ...pasos.map((p, i) => `  ${i + 1}. ${p}`),
  ].join("\n");
  const html = `<h2>Nueva solicitud de contratación</h2>
<p>Pago de demostración (no se cobró nada).</p>
<p><b>Plan:</b> ${esc(plan)}<br><b>Empresa:</b> ${esc(s.empresa || "(no la escribió)")}<br>
<b>Correo para alertas:</b> ${esc(s.correo)}<br><b>Fecha:</b> ${esc(fecha)} (hora de Mérida)</p>
<p><b>Dominios (${dominios.length}):</b></p><ul>${dominios.map((d) => `<li><code>${esc(d)}</code></li>`).join("")}</ul>
<p><a href="${esc(enlace)}" style="display:inline-block;background:#11212D;color:#CCD0CF;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">Aceptar solicitud</a></p>
<p>Ahí eliges el banco y tocas <b>Aceptar e invitar</b>: sus dominios se suman solos a la vigilancia y al cliente le llega la invitación para entrar a su panel.</p>
<p style="color:#4A5C6A;font-size:13px">También puedes aceptarla a mano en Supabase &gt; Table Editor &gt; <a href="${EDITOR}">solicitudes</a> (fila ${esc(s.id)}).</p>`;
  return { asunto: `Nueva solicitud: ${s.empresa || s.correo} · Plan ${plan.split(" ")[0]}`, texto, html };
}

Deno.serve(async () => {
  const r = await fetch(`${URL_BASE}/rest/v1/solicitudes?select=*&notificada_en=is.null&order=creada_en&limit=20`, { headers: encabezados() });
  if (!r.ok) return new Response(`No se pudieron leer las solicitudes: ${r.status}`, { status: 500 });
  const pendientes = await r.json();
  if (!pendientes.length) return new Response("Sin solicitudes nuevas");

  const usuario = Deno.env.get("SMTP_USER") || "";
  const destino = Deno.env.get("AVISOS_CORREO") || usuario;
  const clave = (Deno.env.get("SMTP_PASS") || "").replace(/\s/g, "");   // la contraseña de aplicación se copia con espacios
  if (!usuario || !clave) return new Response("Faltan los secretos SMTP_USER o SMTP_PASS", { status: 500 });

  const cliente = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: usuario, password: clave } } });
  const avisadas: number[] = [];
  try {
    for (const s of pendientes) {
      const c = correo(s, `${ACEPTAR}#id=${s.id}&t=${await firma(s.id)}`);
      await cliente.send({ from: `Domiguard <${usuario}>`, to: destino, subject: c.asunto, content: c.texto, html: c.html });
      avisadas.push(s.id);
    }
  } catch (e) {
    console.error("No se pudo enviar el aviso:", e);
  } finally {
    await cliente.close();
  }
  if (avisadas.length) {
    await fetch(`${URL_BASE}/rest/v1/solicitudes?id=in.(${avisadas.join(",")})`, {
      method: "PATCH", headers: encabezados({ Prefer: "return=minimal" }), body: JSON.stringify({ notificada_en: new Date().toISOString() }),
    });
  }
  return new Response(`Avisos enviados: ${avisadas.length} de ${pendientes.length}`, { status: avisadas.length === pendientes.length ? 200 : 500 });
});
