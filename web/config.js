// Configuración pública de la página. Estos dos valores NO son secretos:
// la llave pública solo puede leer (lo garantiza supabase/schema.sql).
// NUNCA pegues aquí la llave secreta (service_role o sb_secret_...).
window.DOMIGUARD_CONFIG = {
  SUPABASE_URL: "https://lrjlrznvhdoiciwitthf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_xLrZz35uDZuv7LHJVM8n_w_osM6pRSa"    // la llave pública: "anon public" o "sb_publishable_..."
};
// Si SUPABASE_URL está vacío, la página usa data/demo.json (12 detecciones reales de fuentes públicas).
