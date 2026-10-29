// Domiguard: manda el reporte de abuso al registrador de las alertas seguras (ver reportes_pendientes en schema.sql).
// La llama el robot al final de cada corrida. No confía en lo que recibe: lee de la base qué falta reportar, con un
// límite por corrida y por día, y nunca manda dos veces el mismo dominio.
// Modo (tabla estado, id 'reportes'): «prueba» manda el correo al equipo (AVISOS_CORREO) para ver qué recibiría el
// registrador; «real» lo manda al correo de abuso del registrador; «apagado» no manda nada.
// Secretos: los mismos de avisar-solicitud (SMTP_USER, SMTP_PASS, AVISOS_CORREO). El reporte va como Domiguard,
// nunca en nombre del banco, y con el dominio desactivado (hxxps://sitio[.]com): no lleva enlaces al sitio.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function base(ruta: string, init: RequestInit = {}) {
  return fetch(URL_BASE + ruta, {
    ...init,
    headers: { apikey: LLAVE, Authorization: `Bearer ${LLAVE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
}
function entre(v: unknown, def: number, min: number, max: number) {
  const n = Number(v ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}
function esc(t: unknown) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
const desactivar = (host: string, tls: boolean) => (tls ? "hxxps://" : "hxxp://") + host.replace(/\./g, "[.]");
const folioDe = (f: any) => f.folio ? `DG-${String(f.creada_en).slice(0, 4)}-${String(f.folio).padStart(5, "0")}` : "";

// medianoche de hoy en Mérida (UTC-6 todo el año)
function inicioDelDia() {
  const d = new Date(Date.now() - 6 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6)).toISOString();
}

function armar(f: any) {
  const e = f.evidencia || {};
  const dominio = desactivar(f.host, f.tls);
  const oficial = e.oficial ? String(e.oficial).replace(/\./g, "[.]") : "";
  const razon = {
    fuente: "This domain is listed as phishing in a public phishing feed (PhishHunt or Phishing.Database).",
    confirmada: "A member of our team reviewed this alert and confirmed it as phishing.",
    parecido: "The domain closely imitates the brand's official domain, was registered recently" +
      (e.registrado ? ` (${e.registrado})` : "") + " and currently resolves in DNS.",
  }[f.motivo_envio as string] || "";
  const filas: [string, string][] = [
    ["Domain", `${dominio}  (dots replaced with [.] so it is not a link)`],
    ["Impersonated brand", f.banco + (oficial ? ` (official site: ${oficial})` : "")],
    ["Registrar", e.registrador || "unknown"],
    ["Registered on", e.registrado || "unknown"],
    ["First detected", String(f.creada_en)],
    ["Reference", folioDe(f)],
  ];
  const asunto = `Phishing report: ${dominio} impersonating ${f.banco}` + (folioDe(f) ? ` [${folioDe(f)}]` : "");
  const texto = [
    "Hello,", "",
    `We are reporting a domain that appears to impersonate ${f.banco} for phishing.`, "",
    ...filas.map(([k, v]) => `${k}: ${v}`), "",
    razon, "",
    "Please review it under your abuse policy and suspend it if it violates your terms.", "",
    `About this report: Domiguard is an academic project (Business Intelligence, ADM4405) that monitors lookalike domains. ` +
      `We are not acting on behalf of ${f.banco}. We did not visit the site: this report is based on DNS, RDAP registration ` +
      "data and public phishing feeds.", "",
    "Reply to this email if you need more information.", "Domiguard",
  ].join("\n");
  const html = `<p>Hello,</p><p>We are reporting a domain that appears to impersonate <b>${esc(f.banco)}</b> for phishing.</p>
<table cellpadding="4" style="border-collapse:collapse">${filas.map(([k, v]) => `<tr><td style="color:#4A5C6A">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p>${esc(razon)}</p><p>Please review it under your abuse policy and suspend it if it violates your terms.</p>
<p style="color:#4A5C6A">About this report: Domiguard is an academic project (Business Intelligence, ADM4405) that monitors lookalike domains.
We are not acting on behalf of ${esc(f.banco)}. We did not visit the site: this report is based on DNS, RDAP registration data and public phishing feeds.</p>
<p>Reply to this email if you need more information.<br>Domiguard</p>`;
  return { asunto, texto, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);
  const ajustes = ((await (await base("/rest/v1/estado?id=eq.reportes&select=datos")).json())[0] || {}).datos || {};
  const modo = ajustes.modo === "real" ? "real" : ajustes.modo === "apagado" ? "apagado" : "prueba";
  if (modo === "apagado") return respuesta({ modo, enviados: 0 });
  const prueba = modo === "prueba";
  const porDia = prueba ? entre(ajustes.prueba_limite_dia, 6, 0, 20) : entre(ajustes.limite_dia, 20, 0, 100);
  const porCorrida = prueba ? entre(ajustes.prueba_por_corrida, 3, 0, 10) : 10;

  const columna = prueba ? "reporte_prueba_en" : "reporte_auto_en";
  const c = await base(`/rest/v1/alertas?select=id&${columna}=gte.${encodeURIComponent(inicioDelDia())}`,
                       { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0" } });
  const hoy = Number((c.headers.get("content-range") || "*/0").split("/")[1]) || 0;
  const cupo = Math.min(porCorrida, porDia - hoy);
  if (cupo <= 0) return respuesta({ modo, enviados: 0, hoy, limite_dia: porDia });

  const r = await base("/rest/v1/rpc/reportes_pendientes", { method: "POST", body: JSON.stringify({ p_prueba: prueba, p_limite: cupo }) });
  if (!r.ok) return respuesta({ error: "No se pudo leer qué reportar: " + (await r.text()).slice(0, 200) }, 500);
  const pendientes: any[] = await r.json();
  if (!pendientes.length) return respuesta({ modo, enviados: 0, hoy });

  const usuario = Deno.env.get("SMTP_USER") || "";
  const clave = (Deno.env.get("SMTP_PASS") || "").replace(/\s/g, "");
  const equipo = Deno.env.get("AVISOS_CORREO") || usuario;
  if (!usuario || !clave) return respuesta({ error: "Faltan los secretos SMTP_USER o SMTP_PASS" }, 500);
  const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: usuario, password: clave } } });
  const hechos: string[] = [], fallidos: string[] = [];
  try {
    for (const f of pendientes) {
      const abuso = String(f.evidencia?.correo_abuso || "").trim();
      const m = armar(f);
      const aviso = `MODO PRUEBA: este correo no salió al registrador. En modo real iría a ${abuso}.`;
      try {
        await smtp.send({
          from: `Domiguard <${usuario}>`, replyTo: usuario,
          to: prueba ? equipo : abuso,
          subject: (prueba ? "[PRUEBA] " : "") + m.asunto,
          content: (prueba ? aviso + "\n\n" : "") + m.texto,
          html: (prueba ? `<p style="background:#F2C46D;color:#06141B;padding:8px 12px"><b>${esc(aviso)}</b></p>` : "") + m.html,
        });
        await base("/rest/v1/rpc/marcar_reporte_auto", { method: "POST", body: JSON.stringify({ p_id: f.id, p_correo: abuso, p_prueba: prueba }) });
        hechos.push(f.id);
      } catch (e) {
        console.error("No se pudo mandar el reporte de", f.id, e);
        fallidos.push(f.id);
      }
    }
  } finally {
    await smtp.close();
  }
  return respuesta({ modo, enviados: hechos.length, fallidos: fallidos.length, hoy: hoy + hechos.length });
});
