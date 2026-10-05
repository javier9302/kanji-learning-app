-- =========================================
-- KANJI LEARNING APP - supabase/schema.sql
-- Tablas de datos por usuario. Ejecuta este archivo entero en
-- Supabase: SQL Editor -> New query -> pegar -> Run.
-- Se puede ejecutar más de una vez sin perder datos.
-- =========================================

-- Elementos (kanjis y palabras) del modelo antiguo, donde eran un mismo tipo
-- de registro. La app ya no la usa (el progreso está en user_words y
-- user_kanji); se conserva por si hiciera falta recuperar datos.
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,                         -- "kanji:日" o "word:日曜日"
  type text not null check (type in ('kanji', 'word')),
  value text not null,
  level text check (level in ('N5', 'N4', 'N3', 'N2', 'N1')),
  source text,
  studied boolean not null default false,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  repetitions integer not null default 0,
  interval_days integer not null default 0,
  ease double precision not null default 2.5,
  last_reviewed timestamptz,
  next_review date,
  status text not null default 'new' check (status in ('new', 'learning', 'mature')),
  dictionary jsonb,                         -- lecturas y significados
  lookup_status text,
  created_at timestamptz not null default now(),
  client_updated_at bigint not null default 0, -- reloj del dispositivo (ms): gana el más reciente
  deleted_at timestamptz,                   -- borrado: se conserva la fila para avisar a los demás dispositivos
  updated_at timestamptz not null default now(), -- reloj del servidor: para descargar solo lo nuevo
  primary key (user_id, id)
);

create index if not exists items_user_updated_idx on public.items (user_id, updated_at);

-- Historial diario (racha y gráficas)
create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  reviews integer not null default 0,
  correct integer not null default 0,
  new_items integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists days_user_updated_idx on public.days (user_id, updated_at);

-- updated_at lo pone siempre el servidor
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before insert or update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists days_set_updated_at on public.days;
create trigger days_set_updated_at
  before insert or update on public.days
  for each row execute function public.set_updated_at();

-- Row Level Security: cada usuario solo ve y modifica sus propias filas
alter table public.items enable row level security;
alter table public.days enable row level security;

revoke all on public.items, public.days from anon;
grant select, insert, update, delete on public.items, public.days to authenticated;

drop policy if exists "items_select_own" on public.items;
create policy "items_select_own" on public.items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "items_insert_own" on public.items;
create policy "items_insert_own" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "items_update_own" on public.items;
create policy "items_update_own" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "items_delete_own" on public.items;
create policy "items_delete_own" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "days_select_own" on public.days;
create policy "days_select_own" on public.days
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "days_insert_own" on public.days;
create policy "days_insert_own" on public.days
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "days_update_own" on public.days;
create policy "days_update_own" on public.days
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "days_delete_own" on public.days;
create policy "days_delete_own" on public.days
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================
-- LECTURA: textos, progreso por palabra, sesiones y perfil
-- =========================================

-- Textos. Cada uno pertenece a quien lo subió y nace "pending": solo lo ve
-- su dueño. Cuando un administrador lo pone en "approved" lo ven todos.
create table if not exists public.texts (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  title_en text,
  title_es text,
  topic text,
  level text check (level in ('N5', 'N4', 'N3', 'N2', 'N1')),
  source text not null default 'manual',     -- manual | api
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  data jsonb not null,                        -- el JSON completo del texto
  lemmas jsonb not null default '{}'::jsonb,  -- { "lemma|lectura": veces } para la cobertura
  total integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists texts_updated_idx on public.texts (updated_at);
create index if not exists texts_status_idx on public.texts (status);

-- Estado de cada texto para cada usuario (leído, descartado, oculto)
create table if not exists public.text_states (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text_id text not null,
  read_at timestamptz,
  discarded_at timestamptz,
  hidden_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, text_id)
);

create index if not exists text_states_user_updated_idx on public.text_states (user_id, updated_at);

-- Progreso del usuario por palabra
create table if not exists public.user_words (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,                           -- "lemma|lectura"
  lemma text not null,
  reading text not null,
  status text not null default 'unknown' check (status in ('unknown', 'pre_known', 'learning', 'mastered')),
  can_read_kanji boolean not null default false,
  knows_meaning boolean not null default false,
  can_write boolean not null default false,
  seen integer not null default 0,
  lookups integer not null default 0,
  eval_correct integer not null default 0,
  eval_wrong integer not null default 0,
  first_seen timestamptz,
  last_seen timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Repaso espaciado de la palabra (sección Estudio)
alter table public.user_words add column if not exists studied boolean not null default false;
alter table public.user_words add column if not exists repetitions integer not null default 0;
alter table public.user_words add column if not exists interval_days integer not null default 0;
alter table public.user_words add column if not exists ease double precision not null default 2.5;
alter table public.user_words add column if not exists next_review date;
alter table public.user_words add column if not exists last_reviewed timestamptz;
alter table public.user_words add column if not exists correct_count integer not null default 0;
alter table public.user_words add column if not exists incorrect_count integer not null default 0;
alter table public.user_words add column if not exists streak_days integer not null default 0;
alter table public.user_words add column if not exists last_correct_day date;

create index if not exists user_words_user_updated_idx on public.user_words (user_id, updated_at);

-- Progreso del usuario por kanji: significado (Estudio) y escritura (Escribir).
-- A un kanji suelto nunca se le pide la lectura; eso va en user_words.
create table if not exists public.user_kanji (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,                           -- el carácter
  status text not null default 'unknown' check (status in ('unknown', 'pre_known', 'learning', 'mastered')),
  knows_meaning boolean not null default false,
  can_write boolean not null default false,
  writes integer not null default 0,
  studied boolean not null default false,
  repetitions integer not null default 0,
  interval_days integer not null default 0,
  ease double precision not null default 2.5,
  next_review date,
  last_reviewed timestamptz,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  streak_days integer not null default 0,
  last_correct_day date,
  first_seen timestamptz,
  last_seen timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists user_kanji_user_updated_idx on public.user_kanji (user_id, updated_at);

-- Sesiones de lectura: qué texto, cuándo, qué palabras se consultaron y la evaluación
create table if not exists public.reading_sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  text_id text not null,
  started_at timestamptz,
  finished_at timestamptz,
  discarded boolean not null default false,
  clicks jsonb not null default '{}'::jsonb,
  evaluation jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists reading_sessions_user_updated_idx on public.reading_sessions (user_id, updated_at);

-- Perfil de lectura: nivel de los textos y vocabulario que se da por conocido
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  reading_level text,
  assumed_level text,
  placed_at timestamptz,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

do $$
declare tbl text;
begin
  foreach tbl in array array['texts', 'text_states', 'user_words', 'user_kanji', 'reading_sessions', 'profiles'] loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_set_updated_at', tbl);
    execute format('create trigger %I before insert or update on public.%I
      for each row execute function public.set_updated_at()', tbl || '_set_updated_at', tbl);
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
  end loop;
end $$;

-- Administradores: pueden ver todos los textos y aprobarlos desde admin.html.
-- Se añaden a mano desde el SQL Editor (ver SETUP.md); nadie puede añadirse solo.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Un usuario normal no puede aprobar textos: el estado solo lo cambia un
-- administrador (desde admin.html o desde el panel de Supabase).
create or replace function public.protect_text_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending';
    else
      new.status := old.status;
      new.user_id := old.user_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists texts_protect_status on public.texts;
create trigger texts_protect_status
  before insert or update on public.texts
  for each row execute function public.protect_text_status();

-- Textos: cada uno ve los suyos y los aprobados, y solo modifica los suyos.
-- Los administradores ven y modifican todos.
drop policy if exists "texts_select_own_or_approved" on public.texts;
create policy "texts_select_own_or_approved" on public.texts
  for select to authenticated
  using ((select auth.uid()) = user_id or status = 'approved' or (select public.is_admin()));

drop policy if exists "texts_insert_own" on public.texts;
create policy "texts_insert_own" on public.texts
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "texts_update_own" on public.texts;
create policy "texts_update_own" on public.texts
  for update to authenticated
  using ((select auth.uid()) = user_id or (select public.is_admin()))
  with check ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "texts_delete_own" on public.texts;
create policy "texts_delete_own" on public.texts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- El resto: cada usuario solo ve y modifica sus propias filas
do $$
declare tbl text;
begin
  foreach tbl in array array['text_states', 'user_words', 'user_kanji', 'reading_sessions', 'profiles'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_own', tbl);
    execute format('create policy %I on public.%I for select to authenticated
      using ((select auth.uid()) = user_id)', tbl || '_select_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_own', tbl);
    execute format('create policy %I on public.%I for insert to authenticated
      with check ((select auth.uid()) = user_id)', tbl || '_insert_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_own', tbl);
    execute format('create policy %I on public.%I for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', tbl || '_update_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_own', tbl);
    execute format('create policy %I on public.%I for delete to authenticated
      using ((select auth.uid()) = user_id)', tbl || '_delete_own', tbl);
  end loop;
end $$;

-- =========================================
-- GENERACIÓN DE TEXTOS CON IA
-- =========================================

-- Registro de cada llamada a la IA (función generate-text): sirve para el límite
-- diario por usuario y para calcular costes por modelo. Solo la función puede
-- leerla y escribirla (no hay políticas para los usuarios).
create table if not exists public.generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text,
  level text,
  length integer,
  is_fix boolean not null default false,
  prompt_tokens integer,
  output_tokens integer,
  thought_tokens integer,
  ok boolean not null default false,
  error text
);

-- Qué clave de la IA respondió y qué intentos fallaron antes (p. ej. "personal/gemini-3.8-flash:429")
alter table public.generations add column if not exists key_label text;
alter table public.generations add column if not exists attempts text;

create index if not exists generations_user_created_idx on public.generations (user_id, created_at);

alter table public.generations enable row level security;
revoke all on public.generations from anon, authenticated;
