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

-- Seguridad: cualquiera puede LEER; solo la llave service_role (que vive en los
-- secretos de GitHub, nunca en la página) puede ESCRIBIR.
alter table sitios enable row level security;
alter table estado enable row level security;
alter table clientes enable row level security;
alter table clientes_contacto enable row level security;   -- sin política: nadie con la llave pública puede leerla
alter table alertas enable row level security;

drop policy if exists "lectura publica sitios" on sitios;
create policy "lectura publica sitios" on sitios for select using (true);

drop policy if exists "lectura publica estado" on estado;
create policy "lectura publica estado" on estado for select using (true);

-- Prototipo: el panel público lee clientes y alertas. En producción, cada cliente debe entrar con su
-- cuenta (Supabase Auth) y ver solo sus alertas: cambia estas dos políticas por
--   using (cliente_id = (auth.jwt() ->> 'cliente_id'))
drop policy if exists "lectura publica clientes" on clientes;
create policy "lectura publica clientes" on clientes for select using (true);

drop policy if exists "lectura publica alertas" on alertas;
create policy "lectura publica alertas" on alertas for select using (true);

-- Para dar de alta un cliente (cambia los datos):
-- insert into clientes (id, nombre, marca, palabras, dominios)
--   values ('bbva', 'BBVA México', 'bbva', '{bbva}', '{bbva.mx,bbva.com}');
-- insert into clientes_contacto (cliente_id, correo) values ('bbva', 'CORREO-DE-SEGURIDAD-DEL-CLIENTE');
