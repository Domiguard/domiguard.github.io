-- Domiguard: esquema para Supabase (Postgres).
-- Pégalo completo en Supabase > SQL Editor > New query > Run.

create table if not exists sitios (
  id            text primary key,          -- host normalizado, p. ej. "bancoejemp1o-mx"
  host          text not null,             -- dominio en texto plano; la página lo muestra desactivado
  marca         text,                      -- marca suplantada según la fuente
  pais          text,
  asn           text,
  cert          text,
  visto_en      timestamptz,               -- último avistamiento en la fuente
  primer_dia    date not null,             -- primer día que entró a nuestra base
  ultimo_dia    date not null,             -- último día que apareció en la fuente
  puntaje       int  not null,             -- probabilidad de phishing (0 a 100) según el modelo
  tls           boolean,
  fuente        text default 'phishunt',
  dns_ok        boolean,                   -- false = el dominio ya no resuelve en DNS
  dns_revisado  timestamptz,
  x             jsonb not null             -- las 15 columnas del Excel (Structured data 5)
);

create table if not exists estado (
  id     text primary key,                 -- usamos una sola fila: 'ultima'
  datos  jsonb not null
);

-- Clientes que vigilamos (fintechs y bancos). Los correos viven en otra tabla que NO es pública.
create table if not exists clientes (
  id                   text primary key,   -- p. ej. 'bbva'
  nombre               text not null,
  marca                text not null,      -- nombre de la marca como lo escribe la fuente de reportes
  palabras             text[] not null default '{}',   -- nombres que no deben aparecer en dominios ajenos
  dominios             text[] not null,    -- dominios oficiales
  activo               boolean not null default true,
  variantes_vigiladas  int default 0,
  destacado            boolean not null default false   -- sale primero en el selector del panel
);

create table if not exists clientes_contacto (
  cliente_id text not null references clientes(id) on delete cascade,
  correo     text not null,
  primary key (cliente_id, correo)
);

-- Cada alerta: un sitio que parece suplantar a un cliente, con su evidencia.
create table if not exists alertas (
  id            text primary key,          -- 'cliente:sitio'
  cliente_id    text not null references clientes(id) on delete cascade,
  sitio_id      text,
  host          text not null,
  canal         text not null,           -- reporte, busqueda, nuevo_registro o certificado (ver regla abajo)
  motivo        text,
  similitud     int,
  prioridad     text not null check (prioridad in ('alta','media','baja')),
  estado        text not null default 'nueva'
                check (estado in ('nueva','enviada','en_baja','dada_de_baja','falsa_alarma')),
  creada_en     date not null,
  puntaje       int,
  tls           boolean,
  pais          text,
  asn           text,
  dns_ok        boolean,
  dns_revisado  timestamptz,
  enviada_en    timestamptz,
  evidencia     jsonb not null default '{}',
  detectada_en  timestamptz not null default now()   -- hora exacta de detección: el panel muestra solo las últimas 48 horas
);
-- Para bases creadas antes de esta columna (no hace nada si ya existe):
alter table alertas add column if not exists detectada_en timestamptz not null default now();
-- Canales de detección permitidos (se puede correr de nuevo sin problema)
alter table alertas drop constraint if exists alertas_canal_check;
alter table alertas add constraint alertas_canal_check
  check (canal in ('reporte','busqueda','nuevo_registro','certificado'));
create index if not exists alertas_cliente_idx on alertas (cliente_id, creada_en desc);
create index if not exists alertas_detectada_idx on alertas (detectada_en desc);

create index if not exists sitios_visto_en_idx on sitios (visto_en desc);
create index if not exists sitios_ultimo_dia_idx on sitios (ultimo_dia);

-- Solicitudes de contratación desde planes.html (pago de DEMOSTRACIÓN: no se cobra nada).
-- La página solo puede agregar; nadie puede leerlas con la llave pública. El equipo las ve en Table Editor.
create table if not exists solicitudes (
  id         bigint generated always as identity primary key,
  plan       text not null check (plan in ('basico','profesional','empresarial')),
  empresa    text check (char_length(empresa) <= 120),
  dominios   text[] not null check (cardinality(dominios) between 1 and 100),
  correo     text not null check (char_length(correo) <= 254 and correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  cliente_id text,                                    -- el banco que asigna el equipo al aceptar
  estado     text not null default 'nueva' check (estado in ('nueva','en_revision','activa','descartada')),
  creada_en  timestamptz not null default now()
);
alter table solicitudes enable row level security;
drop policy if exists "enviar solicitud" on solicitudes;
create policy "enviar solicitud" on solicitudes for insert to anon, authenticated with check (estado = 'nueva' and cliente_id is null);

-- Aceptar una contratación: lo normal es el botón «Aceptar solicitud» del correo de aviso (web/aceptar.html y la
-- Edge Function aceptar-solicitud, que además invita al cliente por correo). A mano también se puede:
-- en Table Editor > solicitudes, escribe el banco en cliente_id (uno existente como
-- 'bbva' o uno nuevo) y cambia estado a 'activa'. La base crea o completa el banco con sus dominios, guarda
-- el correo de alertas y activa la cuenta con ese correo. Si después se cambia a otro estado, se desactiva.
create or replace function public.activar_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'activa' and coalesce(trim(new.cliente_id), '') <> '' then
    new.cliente_id := lower(trim(new.cliente_id));
    insert into clientes (id, nombre, marca, palabras, dominios)
    values (new.cliente_id, coalesce(nullif(trim(new.empresa), ''), new.cliente_id), new.cliente_id, array[new.cliente_id], new.dominios)
    on conflict (id) do update set dominios = array(select distinct d from unnest(clientes.dominios || excluded.dominios) d);
    insert into clientes_contacto (cliente_id, correo) values (new.cliente_id, lower(new.correo)) on conflict do nothing;
    update perfiles set cliente_id = new.cliente_id, aprobado = true where lower(correo) = lower(new.correo);
  elsif tg_op = 'UPDATE' and old.estado = 'activa' and new.estado <> 'activa' then
    update perfiles set aprobado = false where lower(correo) = lower(new.correo) and cliente_id = old.cliente_id;
  end if;
  return new;
end $$;
drop trigger if exists al_activar_solicitud on solicitudes;
create trigger al_activar_solicitud before update on solicitudes for each row execute function public.activar_solicitud();

-- Cuentas de clientes (Supabase Auth). El panel se activa cuando el equipo de Domiguard acepta la
-- contratación (tabla solicitudes, más abajo) hecha con el mismo correo de la cuenta.
create table if not exists perfiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  cliente_id  text references clientes(id),           -- vacío hasta que se acepte su contratación
  aprobado    boolean not null default false,
  correo      text,
  creado_en   timestamptz not null default now()
);
-- Al registrarse: si ya hay una contratación aceptada con ese correo, la cuenta entra activada con su banco
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare banco text;
begin
  select cliente_id into banco from public.solicitudes
   where lower(correo) = lower(new.email) and estado = 'activa' and cliente_id is not null
   order by creada_en desc limit 1;
  insert into public.perfiles (user_id, cliente_id, aprobado, correo)
  values (new.id, banco, banco is not null, new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users for each row execute function public.crear_perfil();

-- Seguridad: solo la llave secreta (en los secretos de GitHub, nunca en la página) puede ESCRIBIR.
-- Con la llave pública se leen los bancos (para elegir uno al registrarse) y el estado de la última corrida;
-- las alertas solo las ve una cuenta aprobada, y solo las de su banco. sitios y clientes_contacto: nadie.
alter table sitios enable row level security;
alter table estado enable row level security;
alter table clientes enable row level security;
alter table clientes_contacto enable row level security;
alter table alertas enable row level security;
alter table perfiles enable row level security;

drop policy if exists "lectura publica sitios" on sitios;

drop policy if exists "lectura publica estado" on estado;
create policy "lectura publica estado" on estado for select using (true);

drop policy if exists "lectura publica clientes" on clientes;
create policy "lectura publica clientes" on clientes for select using (true);

drop policy if exists "lectura publica alertas" on alertas;
drop policy if exists "alertas de mi banco" on alertas;
create policy "alertas de mi banco" on alertas for select to authenticated
  using (exists (select 1 from perfiles p where p.user_id = auth.uid() and p.aprobado and p.cliente_id = alertas.cliente_id));

drop policy if exists "ver mi perfil" on perfiles;
create policy "ver mi perfil" on perfiles for select to authenticated using (user_id = auth.uid());

-- Para dar de alta un cliente (cambia los datos):
-- insert into clientes (id, nombre, marca, palabras, dominios)
--   values ('bbva', 'BBVA México', 'bbva', '{bbva}', '{bbva.mx,bbva.com}');
-- insert into clientes_contacto (cliente_id, correo) values ('bbva', 'CORREO-DE-SEGURIDAD-DEL-CLIENTE');


-- Aviso al instante al equipo por cada solicitud nueva: el disparador llama a la Edge Function avisar-solicitud
-- (supabase/functions/avisar-solicitud), que manda el correo por Gmail y marca notificada_en.
-- Requiere la integración Database Webhooks (extensión pg_net). Va con la llave PÚBLICA: la función no confía en lo
-- que recibe, solo lee de la base las solicitudes sin avisar. Secretos de la función: SMTP_USER, SMTP_PASS, AVISOS_CORREO.
alter table solicitudes add column if not exists notificada_en timestamptz;
create or replace function public.avisar_solicitud() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://lrjlrznvhdoiciwitthf.supabase.co/functions/v1/avisar-solicitud',
    body := jsonb_build_object('solicitud', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_xLrZz35uDZuv7LHJVM8n_w_osM6pRSa'),
    timeout_milliseconds := 10000);
  return new;
end $$;
drop trigger if exists al_crear_solicitud on solicitudes;
create trigger al_crear_solicitud after insert on solicitudes for each row execute function public.avisar_solicitud();

-- Registro de variantes: cada variante de los dominios oficiales que el robot revisa por DNS, con su último
-- resultado. Se sobrescribe en cada corrida (una fila por banco y variante), así que no crece sin límite.
-- existe: true = el dominio existe en DNS, false = no existe, vacío = no respondió a tiempo.
-- existe_desde: la primera vez que el robot la vio existir (lo pone la base). Solo la ve el equipo (Table Editor).
create table if not exists variantes (
  cliente_id       text not null references clientes(id) on delete cascade,
  host             text not null,
  dominio_oficial  text not null,
  existe           boolean,
  revisada_en      timestamptz not null default now(),
  existe_desde     timestamptz,
  primary key (cliente_id, host)
);
create index if not exists variantes_existe_idx on variantes (existe, revisada_en desc);
alter table variantes enable row level security;
create or replace function public.marcar_existe_desde() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.existe_desde := old.existe_desde;
  end if;
  if new.existe and new.existe_desde is null then
    new.existe_desde := new.revisada_en;
  end if;
  return new;
end $$;
drop trigger if exists al_guardar_variante on variantes;
create trigger al_guardar_variante before insert or update on variantes for each row execute function public.marcar_existe_desde();

-- Estado de cada alerta marcado por el cliente desde su panel: «Pedí la baja», «Ya la dieron de baja», «Falsa alarma»
-- o «Volver a nueva». Solo con esta función (no hay permiso de UPDATE directo): comprueba que la cuenta esté aprobada
-- y que la alerta sea de SU banco, y cambia solo el estado y sus fechas. Las fechas alimentan «días hasta la baja».
alter table alertas add column if not exists baja_pedida_en  timestamptz;
alter table alertas add column if not exists dada_de_baja_en timestamptz;
alter table alertas add column if not exists estado_cambiado_por uuid;
create or replace function public.marcar_alerta(p_id text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare banco text; fila alertas;
begin
  if p_estado not in ('nueva', 'en_baja', 'dada_de_baja', 'falsa_alarma') then
    raise exception 'Estado no válido';
  end if;
  select cliente_id into banco from perfiles where user_id = auth.uid() and aprobado and cliente_id is not null;
  if banco is null then raise exception 'Tu cuenta no tiene un plan activo'; end if;
  update alertas set
    estado = p_estado,
    baja_pedida_en = case when p_estado = 'nueva' then null
                          when p_estado in ('en_baja', 'dada_de_baja') then coalesce(baja_pedida_en, now())
                          else baja_pedida_en end,
    dada_de_baja_en = case when p_estado = 'dada_de_baja' then coalesce(dada_de_baja_en, now()) else null end,
    estado_cambiado_por = auth.uid()
  where id = p_id and cliente_id = banco
  returning * into fila;
  if not found then raise exception 'Alerta no encontrada'; end if;
  return jsonb_build_object('id', fila.id, 'estado', fila.estado, 'baja_pedida_en', fila.baja_pedida_en, 'dada_de_baja_en', fila.dada_de_baja_en);
end $$;
revoke all on function public.marcar_alerta(text, text) from public, anon;
grant execute on function public.marcar_alerta(text, text) to authenticated;

-- Folio e historial de cada alerta (expediente). folio: número fijo del caso; el panel lo muestra como
-- DG-AAAA-00123 (año de detección). Las alertas que ya existían reciben su folio por orden de detección.
create sequence if not exists alertas_folio_seq;
alter table alertas add column if not exists folio bigint;
update alertas a set folio = n.num
  from (select id, (select coalesce(max(folio), 0) from alertas) + row_number() over (order by creada_en, detectada_en, id) as num
          from alertas where folio is null) n
 where a.id = n.id;
select setval('alertas_folio_seq', (select coalesce(max(folio), 0) + 1 from alertas), false);
alter table alertas alter column folio set default nextval('alertas_folio_seq');
create unique index if not exists alertas_folio_idx on alertas (folio);

-- Historial: una fila por cada cosa que le pasó a la alerta. Lo escribe solo la base (disparador), nadie más.
-- evento: detectada (despues = canal), estado (antes/despues = estado), prioridad (antes/despues) o
-- dns (despues = responde / no_responde; revisión por DNS, no se abre el sitio).
-- por: la cuenta que hizo el cambio desde el panel; vacío = el robot. solo_fecha: de las alertas que ya
-- existían solo se sabe el día de detección, no la hora.
create table if not exists alertas_historial (
  id          bigserial primary key,
  alerta_id   text not null references alertas(id) on delete cascade,
  cliente_id  text not null,
  en          timestamptz not null default now(),
  evento      text not null check (evento in ('detectada', 'estado', 'prioridad', 'dns')),
  antes       text,
  despues     text,
  por         uuid,
  solo_fecha  boolean not null default false
);
create index if not exists alertas_historial_alerta_idx on alertas_historial (alerta_id, en);
alter table alertas_historial enable row level security;
drop policy if exists "historial de mi banco" on alertas_historial;
create policy "historial de mi banco" on alertas_historial for select to authenticated
  using (exists (select 1 from perfiles p where p.user_id = auth.uid() and p.aprobado and p.cliente_id = alertas_historial.cliente_id));

create or replace function public.anotar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into alertas_historial (alerta_id, cliente_id, en, evento, despues)
    values (new.id, new.cliente_id, new.detectada_en, 'detectada', new.canal);
    return null;
  end if;
  if new.estado is distinct from old.estado then
    insert into alertas_historial (alerta_id, cliente_id, evento, antes, despues, por)
    values (new.id, new.cliente_id, 'estado', old.estado, new.estado, auth.uid());   -- auth.uid() vacío = el robot
  end if;
  if new.prioridad is distinct from old.prioridad then
    insert into alertas_historial (alerta_id, cliente_id, evento, antes, despues)
    values (new.id, new.cliente_id, 'prioridad', old.prioridad, new.prioridad);
  end if;
  if new.dns_ok is not null and new.dns_ok is distinct from old.dns_ok then
    insert into alertas_historial (alerta_id, cliente_id, evento, antes, despues)
    values (new.id, new.cliente_id, 'dns',
            case when old.dns_ok then 'responde' when old.dns_ok = false then 'no_responde' end,
            case when new.dns_ok then 'responde' else 'no_responde' end);
  end if;
  return null;
end $$;
drop trigger if exists al_cambiar_alerta on alertas;
create trigger al_cambiar_alerta after insert or update on alertas for each row execute function public.anotar_historial();

-- Historial de las alertas que ya existían, con lo que se sabe de ellas (solo si todavía no tienen historial).
-- detectada_en se agregó después que creada_en: si no coinciden en el día, solo se conoce el día.
insert into alertas_historial (alerta_id, cliente_id, en, evento, antes, despues, por, solo_fecha)
select a.id, a.cliente_id, x.en, x.evento, x.antes, x.despues, x.por, x.solo_fecha
  from alertas a
  cross join lateral (values
    (case when (a.detectada_en at time zone 'America/Merida')::date = a.creada_en then a.detectada_en
          else a.creada_en::timestamp at time zone 'America/Merida' end,
     'detectada', null::text, a.canal, null::uuid, (a.detectada_en at time zone 'America/Merida')::date <> a.creada_en),
    (a.enviada_en, 'estado', 'nueva', 'enviada', null::uuid, false),
    (a.baja_pedida_en, 'estado', null, 'en_baja', a.estado_cambiado_por, false),
    (a.dada_de_baja_en, 'estado', null, 'dada_de_baja', a.estado_cambiado_por, false)
  ) as x(en, evento, antes, despues, por, solo_fecha)
 where x.en is not null
   and not exists (select 1 from alertas_historial h where h.alerta_id = a.id);

-- Estados nuevos que marca el cliente: «Sí es phishing» (confirmada) y «Ya me respondieron» (en_seguimiento:
-- respondieron al reporte y falta que lo retiren). Orden: nueva → confirmada → en_baja → en_seguimiento → dada_de_baja.
alter table alertas drop constraint if exists alertas_estado_check;
alter table alertas add constraint alertas_estado_check
  check (estado in ('nueva','enviada','confirmada','en_baja','en_seguimiento','dada_de_baja','falsa_alarma'));
create or replace function public.marcar_alerta(p_id text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare banco text; fila alertas;
begin
  if p_estado not in ('nueva', 'confirmada', 'en_baja', 'en_seguimiento', 'dada_de_baja', 'falsa_alarma') then
    raise exception 'Estado no válido';
  end if;
  select cliente_id into banco from perfiles where user_id = auth.uid() and aprobado and cliente_id is not null;
  if banco is null then raise exception 'Tu cuenta no tiene un plan activo'; end if;
  update alertas set
    estado = p_estado,
    baja_pedida_en = case when p_estado in ('nueva', 'confirmada') then null
                          when p_estado in ('en_baja', 'en_seguimiento', 'dada_de_baja') then coalesce(baja_pedida_en, now())
                          else baja_pedida_en end,
    dada_de_baja_en = case when p_estado = 'dada_de_baja' then coalesce(dada_de_baja_en, now()) else null end,
    estado_cambiado_por = auth.uid()
  where id = p_id and cliente_id = banco
  returning * into fila;
  if not found then raise exception 'Alerta no encontrada'; end if;
  return jsonb_build_object('id', fila.id, 'estado', fila.estado, 'baja_pedida_en', fila.baja_pedida_en, 'dada_de_baja_en', fila.dada_de_baja_en);
end $$;
revoke all on function public.marcar_alerta(text, text) from public, anon;
grant execute on function public.marcar_alerta(text, text) to authenticated;
