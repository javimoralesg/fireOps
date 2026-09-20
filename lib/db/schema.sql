-- =====================================================================
-- ATALAYA INCENDIOS · Esquema de Supabase (Postgres + pgvector)
-- ---------------------------------------------------------------------
-- DUEÑO: constructor A. Se aplica UNA vez con el conector de Supabase
-- (o a mano en el SQL editor del proyecto: ver README, «La base de datos»).
--
-- Diseño: el estado vivo está en memoria en el proceso Node; aquí se
-- persiste de forma asíncrona. Por eso casi todas las tablas son
-- "genéricas": id + ejecución + incendio + el objeto completo en jsonb.
-- Así el contrato de lib/dominio/tipos.ts puede crecer sin migraciones.
--
-- SEGURIDAD: SIN RLS a propósito. A estas tablas solo accede el servidor
-- con SUPABASE_SERVICE_ROLE_KEY (que nunca sale del proceso Node); no hay
-- cliente de navegador que hable con Supabase. Si algún día la UI leyera
-- directamente, habría que activar RLS y políticas por ejecución.
-- =====================================================================

-- dimensiones = EMBEDDINGS_DIMENSIONES (512): las fija el proveedor de
-- embeddings (HelmCode qwen3-embedding). Si se cambia de proveedor hay que
-- recrear las columnas `embedding` y las funciones de búsqueda.
create extension if not exists vector;

-- ---------------------------------------------------------------------
-- Ejecuciones (una "partida" completa, con sus métricas)
-- ---------------------------------------------------------------------
create table if not exists ejecuciones (
  id          text primary key,
  nombre      text,
  inicio      timestamptz,
  fin         timestamptz,
  estado      text,
  metricas    jsonb,
  comparativa text,
  datos       jsonb
);
create index if not exists ejecuciones_estado_idx on ejecuciones (estado, inicio desc);

-- ---------------------------------------------------------------------
-- Tablas genéricas de entidades del dominio
-- ---------------------------------------------------------------------
create table if not exists incendios (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists unidades (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists poblaciones (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists observaciones (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists decisiones (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists informes (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists comunicados (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists eventos (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create table if not exists camaras_analisis (
  id             text primary key,
  ejecucion_id   text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);

create index if not exists incendios_ejecucion_idx        on incendios (ejecucion_id);
create index if not exists unidades_ejecucion_idx         on unidades (ejecucion_id);
create index if not exists poblaciones_ejecucion_idx      on poblaciones (ejecucion_id);
create index if not exists observaciones_ejecucion_idx    on observaciones (ejecucion_id);
create index if not exists decisiones_ejecucion_idx       on decisiones (ejecucion_id);
create index if not exists informes_ejecucion_idx         on informes (ejecucion_id);
create index if not exists comunicados_ejecucion_idx      on comunicados (ejecucion_id);
create index if not exists eventos_ejecucion_idx          on eventos (ejecucion_id, actualizado_en desc);
create index if not exists camaras_analisis_ejecucion_idx on camaras_analisis (ejecucion_id, actualizado_en desc);

-- ---------------------------------------------------------------------
-- Política de autonomía (una fila: la vigente; el histórico queda por id)
-- ---------------------------------------------------------------------
create table if not exists politica (
  id             text primary key,
  datos          jsonb,
  actualizada_en timestamptz default now()
);

-- ---------------------------------------------------------------------
-- Conocimiento: documentos, fragmentos y embeddings
-- dimensiones = EMBEDDINGS_DIMENSIONES (512)
-- ---------------------------------------------------------------------
create table if not exists documentos (
  id             text primary key,
  titulo         text,
  nombre_archivo text,
  ambito         text,
  territorio     text,
  subido_en      timestamptz default now(),
  tamano_bytes   int,
  num_chunks     int,
  estado         text,
  error          text,
  datos          jsonb
);

create table if not exists chunks (
  id           text primary key,
  documento_id text references documentos(id) on delete cascade,
  indice       int,
  seccion      text,
  texto        text,
  entidades    text[] default '{}',
  relacionados text[] default '{}',
  embedding    vector(512),
  datos        jsonb
);
create index if not exists chunks_documento_idx on chunks (documento_id, indice);
-- Similitud coseno. ivfflat necesita ANALYZE y datos para ser útil; con pocos
-- documentos el planner hará seq scan, que también es correcto.
create index if not exists chunks_embedding_idx
  on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------
-- Lecciones aprendidas entre ejecuciones
-- ---------------------------------------------------------------------
create table if not exists lecciones (
  id             text primary key,
  ejecucion_id   text,
  agente_id      text,
  categoria      text,
  texto          text,
  evidencia      text,
  cambio         text,
  peso           real default 0.5,
  creada_en      timestamptz default now(),
  veces_aplicada int default 0,
  origen         text,
  embedding      vector(512),
  datos          jsonb
);
create index if not exists lecciones_agente_idx on lecciones (agente_id, peso desc);
create index if not exists lecciones_embedding_idx
  on lecciones using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Funciones de búsqueda por similitud (las llama el servidor por RPC)
-- ---------------------------------------------------------------------
create or replace function buscar_chunks(
  consulta   vector(512),
  k          int,
  territorio text default null
)
returns table (
  id           text,
  documento_id text,
  seccion      text,
  texto        text,
  entidades    text[],
  relacionados text[],
  similitud    float
)
language sql stable as $$
  select c.id,
         c.documento_id,
         c.seccion,
         c.texto,
         c.entidades,
         c.relacionados,
         1 - (c.embedding <=> consulta) as similitud
  from chunks c
  join documentos d on d.id = c.documento_id
  where c.embedding is not null
    -- cualificado con el nombre de la función: en SQL la columna ganaría al parámetro
    and (buscar_chunks.territorio is null or d.territorio is null or d.territorio = buscar_chunks.territorio)
  order by c.embedding <=> consulta
  limit greatest(k, 1);
$$;

create or replace function buscar_lecciones(
  consulta  vector(512),
  k         int,
  agente_id text default null
)
returns table (
  id        text,
  datos     jsonb,
  similitud float
)
language sql stable as $$
  select l.id,
         l.datos,
         1 - (l.embedding <=> consulta) as similitud
  from lecciones l
  where l.embedding is not null
    and (buscar_lecciones.agente_id is null or l.agente_id = buscar_lecciones.agente_id or l.agente_id = '*')
  order by l.embedding <=> consulta
  limit greatest(k, 1);
$$;

-- ---------------------------------------------------------------------
-- Trazas de ciclo de agente (auditoría: qué vio, qué preguntó a la IA y
-- qué produjo cada ciclo). AÑADIDO 2026-09-19 por el requisito de auditar
-- absolutamente todo. Se persiste cada traza al cerrarse (estado ≠ en_curso).
-- ---------------------------------------------------------------------
create table if not exists trazas (
  id             text primary key,
  ejecucion_id   text,
  agente_id      text,
  incendio_id    text,
  datos          jsonb not null,
  actualizado_en timestamptz default now()
);
create index if not exists trazas_ejecucion_idx on trazas (ejecucion_id, actualizado_en desc);
create index if not exists trazas_agente_idx    on trazas (agente_id, actualizado_en desc);
