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

-- Cuentas de clientes (Supabase Auth). Cada cuenta elige su banco al registrarse y no ve nada
-- hasta que el equipo de Domiguard la aprueba: Table Editor > perfiles > aprobado = true.
create table if not exists perfiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  cliente_id  text not null references clientes(id),
  aprobado    boolean not null default false,
  correo      text,
  creado_en   timestamptz not null default now()
);
-- Al registrarse, el perfil se crea solo con el banco que eligió (si el banco no existe, el registro falla)
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (user_id, cliente_id, correo)
  values (new.id, new.raw_user_meta_data->>'cliente_id', new.email)
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

-- Solicitudes de contratación desde planes.html (pago de DEMOSTRACIÓN: no se cobra nada).
-- La página solo puede agregar; nadie puede leerlas con la llave pública. El equipo las ve en Table Editor.
create table if not exists solicitudes (
  id         bigint generated always as identity primary key,
  plan       text not null check (plan in ('basico','profesional','empresarial')),
  empresa    text check (char_length(empresa) <= 120),
  dominios   text[] not null check (cardinality(dominios) between 1 and 100),
  correo     text not null check (char_length(correo) <= 254 and correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  estado     text not null default 'nueva' check (estado in ('nueva','en_revision','activa','descartada')),
  creada_en  timestamptz not null default now()
);
alter table solicitudes enable row level security;
drop policy if exists "enviar solicitud" on solicitudes;
create policy "enviar solicitud" on solicitudes for insert to anon, authenticated with check (estado = 'nueva');
