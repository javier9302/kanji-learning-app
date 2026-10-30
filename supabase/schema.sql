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

-- Fase 2: tarjeta de FSRS, de dónde salió la palabra y el significado que escribió el usuario
alter table public.user_words add column if not exists fsrs jsonb;
alter table public.user_words add column if not exists origin text check (origin in ('manual', 'lectura', 'frecuencia'));
alter table public.user_words add column if not exists meaning text;

-- Diccionario: una palabra buscada tiene el origen "diccionario". La comprobación
-- anterior no lo admitía, así que se sustituye (se puede repetir sin problema).
alter table public.user_words drop constraint if exists user_words_origin_check;
alter table public.user_words add constraint user_words_origin_check
  check (origin in ('manual', 'lectura', 'frecuencia', 'diccionario', 'traducir'));
-- (Más abajo, en Traducir, se repite igual. Las dos listas tienen que ser la misma:
--  si no, al volver a ejecutar el archivo fallaría con las palabras de origen "traducir".)

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

-- Fase 2: tarjeta de FSRS y cuándo salió el kanji en una lectura terminada
alter table public.user_kanji add column if not exists fsrs jsonb;
alter table public.user_kanji add column if not exists seen_at timestamptz;

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

-- Cada petición de texto lleva un identificador; sus reintentos lo comparten.
-- Al estudiante solo le cuenta la petición que acaba en un texto entregado (ok).
-- raw guarda lo que respondió la IA cuando falló, para poder revisarlo.
alter table public.generations add column if not exists request_id text;
alter table public.generations add column if not exists attempt integer not null default 1;
alter table public.generations add column if not exists raw text;

create index if not exists generations_user_created_idx on public.generations (user_id, created_at);
create index if not exists generations_request_idx on public.generations (user_id, request_id);

-- Versión del prompt, parámetros con que se pidió y tipo de resultado:
--   ok | invalid_json | missing_fields | tokens_mismatch | empty_units | too_short |
--   truncated | empty | provider | quota
-- raw guarda la respuesta de la IA en todos los casos, también cuando fue bien.
alter table public.generations add column if not exists prompt_version text;
alter table public.generations add column if not exists params jsonb;
alter table public.generations add column if not exists result text;

alter table public.generations enable row level security;
revoke all on public.generations from anon, authenticated;

-- Solo la función escribe aquí; los administradores pueden leer para exportar los registros
grant select on public.generations to authenticated;
drop policy if exists "generations_admin_select" on public.generations;
create policy "generations_admin_select" on public.generations
  for select to authenticated using ((select public.is_admin()));

-- Problemas de un texto que no detecta la validación del servidor:
--   kind 'auto': lo que la app tuvo que arreglar al recibirlo (details.repairs)
--   kind 'user': lo que alguien marca con el botón "Reportar error"
create table if not exists public.text_reports (
  id bigint generated always as identity primary key,
  text_id text,
  request_id text,                 -- enlaza con generations.request_id
  prompt_version text,
  model text,
  kind text not null check (kind in ('auto', 'user')),
  category text not null,          -- repaired | translation | reading | tokens | difficulty | other
  comment text,
  details jsonb not null default '{}'::jsonb,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists text_reports_created_idx on public.text_reports (created_at);

alter table public.text_reports enable row level security;
revoke all on public.text_reports from anon;
grant select, insert, delete on public.text_reports to authenticated;

drop policy if exists "text_reports_insert" on public.text_reports;
create policy "text_reports_insert" on public.text_reports
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "text_reports_admin_select" on public.text_reports;
create policy "text_reports_admin_select" on public.text_reports
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "text_reports_admin_delete" on public.text_reports;
create policy "text_reports_admin_delete" on public.text_reports
  for delete to authenticated using ((select public.is_admin()));

-- =========================================
-- DICCIONARIO GENERAL
-- =========================================

-- Palabras que no están en el banco de la app: las de JMdict (se importan
-- una vez, ver SETUP.md) y las que un administrador aprueba al revisarlas.
-- La app consulta aquí solo las palabras de cada texto.
create table if not exists public.dictionary (
  id bigint generated always as identity primary key,
  lemma text not null,
  reading text not null default '',
  meanings jsonb not null default '[]'::jsonb,
  meanings_es jsonb not null default '[]'::jsonb,
  uk boolean not null default false,          -- casi siempre se escribe en kana
  source text not null default 'jmdict' check (source in ('jmdict', 'approved')),
  updated_at timestamptz not null default now(),
  unique (lemma, reading)
);

create index if not exists dictionary_lemma_idx on public.dictionary (lemma);

alter table public.dictionary enable row level security;
revoke all on public.dictionary from anon;
grant select, insert, update, delete on public.dictionary to authenticated;

drop policy if exists "dictionary_select" on public.dictionary;
create policy "dictionary_select" on public.dictionary
  for select to authenticated using (true);

drop policy if exists "dictionary_admin_insert" on public.dictionary;
create policy "dictionary_admin_insert" on public.dictionary
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "dictionary_admin_update" on public.dictionary;
create policy "dictionary_admin_update" on public.dictionary
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "dictionary_admin_delete" on public.dictionary;
create policy "dictionary_admin_delete" on public.dictionary
  for delete to authenticated using ((select public.is_admin()));

-- Buscador del diccionario (dictionary.js): por escritura, por lectura o por
-- significado. Los dos índices sirven para "empieza por"; el significado se
-- busca recorriendo la tabla, que con unas 29.000 filas tarda milisegundos.
create index if not exists dictionary_lemma_prefix_idx on public.dictionary (lemma text_pattern_ops);
create index if not exists dictionary_reading_prefix_idx on public.dictionary (reading text_pattern_ops);

--   q        lo escrito en japonés ('' si no lo es)
--   kana     su lectura en hiragana y kata, la misma en katakana ('' si no hay)
--   meaning  texto para buscar en los significados ('' si se escribió en japonés)
-- Devuelve primero lo exacto, después lo que empieza así y al final lo que
-- coincide por significado; la app vuelve a ordenarlo junto con su banco.
create or replace function public.search_dictionary(
  q text, kana text default '', kata text default '', meaning text default '', lim integer default 60)
returns table (lemma text, reading text, meanings jsonb, meanings_es jsonb, uk boolean, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select
      replace(replace(replace(coalesce(q, ''), '\', '\\'), '%', '\%'), '_', '\_') as w,
      replace(replace(replace(coalesce(kana, ''), '\', '\\'), '%', '\%'), '_', '\_') as k,
      replace(replace(replace(coalesce(kata, ''), '\', '\\'), '%', '\%'), '_', '\_') as kt,
      replace(replace(replace(lower(coalesce(meaning, '')), '\', '\\'), '%', '\%'), '_', '\_') as m
  ),
  found as (
    select d.*,
      case
        when q <> '' and d.lemma = q then 0
        when kana <> '' and d.reading in (kana, kata) then 0
        when q <> '' and d.lemma like p.w || '%' then 1
        when kana <> '' and (d.reading like p.k || '%' or d.reading like p.kt || '%') then 1
        when length(p.m) > 1 and (d.meanings ? lower(meaning) or d.meanings_es ? lower(meaning)) then 2
        when length(p.m) > 1 and (lower(d.meanings::text) like '%' || p.m || '%'
          or lower(d.meanings_es::text) like '%' || p.m || '%') then 3
      end as tier
    from public.dictionary d, p
  )
  select f.lemma, f.reading, f.meanings, f.meanings_es, f.uk, f.source
  from found f
  where f.tier is not null
  order by f.tier, (f.source = 'approved') desc, length(f.lemma), f.lemma
  limit least(greatest(coalesce(lim, 60), 1), 200);
$$;

revoke all on function public.search_dictionary(text, text, text, text, integer) from public, anon;
grant execute on function public.search_dictionary(text, text, text, text, integer) to authenticated;

-- =========================================
-- PALABRAS POR REVISAR
-- =========================================

-- Palabras de los textos que no estaban en el banco de la app: se muestran
-- al estudiante igualmente y quedan aquí para que un administrador las revise.
--   source: jmdict (salió del diccionario), ai (solo la explicó la IA),
--           kana_fix (la IA la escribió con kanji y se pasó a kana)
create table if not exists public.words_to_review (
  id bigint generated always as identity primary key,
  lemma text not null,
  reading text not null default '',
  meanings jsonb not null default '[]'::jsonb,
  meanings_es jsonb not null default '[]'::jsonb,
  source text not null check (source in ('jmdict', 'ai', 'kana_fix')),
  sentence text,
  text_id text,
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (lemma, reading, source)
);

create index if not exists words_to_review_status_idx on public.words_to_review (status, created_at);

alter table public.words_to_review enable row level security;
revoke all on public.words_to_review from anon;
grant select, insert, update, delete on public.words_to_review to authenticated;

-- Cualquier usuario con sesión puede anotar una palabra; solo los administradores las ven y deciden
drop policy if exists "words_to_review_insert" on public.words_to_review;
create policy "words_to_review_insert" on public.words_to_review
  for insert to authenticated with check ((select auth.uid()) = user_id and status = 'pending');

drop policy if exists "words_to_review_admin_select" on public.words_to_review;
create policy "words_to_review_admin_select" on public.words_to_review
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "words_to_review_admin_update" on public.words_to_review;
create policy "words_to_review_admin_update" on public.words_to_review
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "words_to_review_admin_delete" on public.words_to_review;
create policy "words_to_review_admin_delete" on public.words_to_review
  for delete to authenticated using ((select public.is_admin()));

-- =========================================
-- FRASES DE EJEMPLO DEL USUARIO
-- =========================================

-- Frases sacadas de los textos del usuario (para repasar una palabra dentro de
-- una frase) y cuántas veces se le ha enseñado cada una. Las frases comunes de
-- la app (bank/sentences) no se guardan aquí: de esas solo va el contador, con
-- data vacío. Los textos pegados que se quedan en el dispositivo no se suben,
-- y sus frases tampoco.
create table if not exists public.user_sentences (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,                           -- "idDelTexto:n", o el id de una frase común
  text_id text,                               -- texto del que salió (null en las comunes)
  data jsonb,                                 -- la frase completa (null en las comunes)
  shown integer not null default 0,           -- veces que se ha enseñado en un repaso
  last_shown timestamptz,
  client_updated_at bigint not null default 0,
  deleted_at timestamptz,                     -- su texto se borró
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists user_sentences_user_updated_idx on public.user_sentences (user_id, updated_at);

drop trigger if exists user_sentences_set_updated_at on public.user_sentences;
create trigger user_sentences_set_updated_at
  before insert or update on public.user_sentences
  for each row execute function public.set_updated_at();

alter table public.user_sentences enable row level security;
revoke all on public.user_sentences from anon;
grant select, insert, update, delete on public.user_sentences to authenticated;

drop policy if exists "user_sentences_select_own" on public.user_sentences;
create policy "user_sentences_select_own" on public.user_sentences
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user_sentences_insert_own" on public.user_sentences;
create policy "user_sentences_insert_own" on public.user_sentences
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user_sentences_update_own" on public.user_sentences;
create policy "user_sentences_update_own" on public.user_sentences
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "user_sentences_delete_own" on public.user_sentences;
create policy "user_sentences_delete_own" on public.user_sentences
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================
-- TRADUCIR: CORRECCIONES DE LA IA
-- =========================================

-- Registro de cada llamada a la IA de la función grade-translation: sirve para
-- el límite diario por usuario (aparte del de generate-text), para medir tokens
-- y tiempos, y para revisar las correcciones dudosas. Solo la función escribe;
-- los administradores pueden leer.
--   result: ok | invalid_json | missing_fields | missing_words | truncated |
--           empty | provider | quota | timeout
create table if not exists public.translation_grades (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  request_id text,                 -- una corrección; sus reintentos lo comparten
  attempt integer not null default 1,
  prompt_version text,
  result text,
  ok boolean not null default false,
  error text,
  model text,
  key_label text,
  attempts text,                   -- claves que fallaron antes: "personal/gemini-3.8-flash:429"
  prompt_tokens integer,
  output_tokens integer,
  thought_tokens integer,
  latency_ms integer,
  sentence_id text,
  lang text,
  ja text,                         -- la frase
  answer text,                     -- lo que escribió el estudiante
  verdict text,
  score integer,
  raw text                         -- lo que respondió la IA, haya ido bien o mal
);

create index if not exists translation_grades_user_created_idx on public.translation_grades (user_id, created_at);
create index if not exists translation_grades_request_idx on public.translation_grades (request_id);

alter table public.translation_grades enable row level security;
revoke all on public.translation_grades from anon, authenticated;

grant select on public.translation_grades to authenticated;
drop policy if exists "translation_grades_admin_select" on public.translation_grades;
create policy "translation_grades_admin_select" on public.translation_grades
  for select to authenticated using ((select public.is_admin()));

-- =========================================
-- TRADUCIR: PROGRESO DEL SIGNIFICADO
-- =========================================

-- Lo que se sabe del SIGNIFICADO de cada palabra y kanji por la sección
-- Traducir. Va aparte del repaso espaciado de la lectura, que no se toca.
--   meaning_correct  puntos seguidos de "la entendió" (un fallo lo pone a 0);
--                    en un kanji, cuántas palabras distintas lo respaldan
--   meaning_wrong    veces que no la entendió
alter table public.user_words add column if not exists meaning_correct double precision not null default 0;
alter table public.user_words add column if not exists meaning_wrong integer not null default 0;
alter table public.user_words add column if not exists last_meaning_at timestamptz;
alter table public.user_kanji add column if not exists meaning_correct double precision not null default 0;
alter table public.user_kanji add column if not exists meaning_wrong integer not null default 0;
alter table public.user_kanji add column if not exists last_meaning_at timestamptz;

-- Una palabra que se ve por primera vez en Traducir tiene el origen "traducir"
alter table public.user_words drop constraint if exists user_words_origin_check;
alter table public.user_words add constraint user_words_origin_check
  check (origin in ('manual', 'lectura', 'frecuencia', 'diccionario', 'traducir'));

-- (admin.html, pestaña Traducciones, lee translation_grades y estos reportes.)
-- Correcciones con las que el estudiante no estuvo de acuerdo: van a text_reports
-- con kind 'grade' (category 'contested'), enlazadas por request_id con translation_grades.
alter table public.text_reports drop constraint if exists text_reports_kind_check;
alter table public.text_reports add constraint text_reports_kind_check check (kind in ('auto', 'user', 'grade'));

-- Historial diario: frases traducidas y cuántas bien. No cambian reviews/correct/new_items.
alter table public.days add column if not exists translations integer not null default 0;
alter table public.days add column if not exists translations_correct integer not null default 0;

-- =========================================
-- LÍMITES CONTRA EL ABUSO
-- =========================================

-- Tamaño máximo de lo que escribe un usuario. "not valid": las filas que ya
-- existen no se comprueban (no puede fallar al ejecutar el archivo); las nuevas sí.
do $$
declare item record;
begin
  for item in select * from (values
    ('texts', 'texts_size_check', 'octet_length(data::text) <= 300000 and char_length(title) <= 200'),
    ('text_reports', 'text_reports_size_check', 'char_length(coalesce(comment, '''')) <= 2000 and octet_length(details::text) <= 20000'),
    ('words_to_review', 'words_to_review_size_check', 'char_length(lemma) <= 50 and char_length(reading) <= 100 and char_length(coalesce(sentence, '''')) <= 600 and octet_length(meanings::text) + octet_length(meanings_es::text) <= 4000'),
    ('user_words', 'user_words_size_check', 'char_length(lemma) <= 50 and char_length(reading) <= 100 and char_length(coalesce(meaning, '''')) <= 200'),
    ('user_sentences', 'user_sentences_size_check', 'octet_length(coalesce(data::text, '''')) <= 20000'),
    ('reading_sessions', 'reading_sessions_size_check', 'octet_length(clicks::text) <= 50000')
  ) as t(tbl, name, expr) loop
    execute format('alter table public.%I drop constraint if exists %I', item.tbl, item.name);
    execute format('alter table public.%I add constraint %I check (%s) not valid', item.tbl, item.name, item.expr);
  end loop;
end $$;

-- Cuántas filas nuevas puede crear un usuario al día en las tablas que llegan
-- al administrador (textos por aprobar, reportes, palabras por revisar). Los
-- administradores y las Edge Functions (service_role) no tienen límite.
create or replace function public.limit_daily_inserts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
  maximum integer := tg_argv[0]::integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  execute format('select count(*) from public.%I where user_id = $1 and created_at > now() - interval ''1 day''', tg_table_name)
    into used using auth.uid();
  if used >= maximum then
    raise exception 'daily_limit: % filas nuevas al día como máximo en %', maximum, tg_table_name using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_daily_inserts() from public, anon, authenticated;

drop trigger if exists texts_daily_limit on public.texts;
create trigger texts_daily_limit before insert on public.texts
  for each row execute function public.limit_daily_inserts('50');
drop trigger if exists text_reports_daily_limit on public.text_reports;
create trigger text_reports_daily_limit before insert on public.text_reports
  for each row execute function public.limit_daily_inserts('300');
drop trigger if exists words_to_review_daily_limit on public.words_to_review;
create trigger words_to_review_daily_limit before insert on public.words_to_review
  for each row execute function public.limit_daily_inserts('1000');

-- =========================================
-- RELOJES DE LOS DISPOSITIVOS
-- =========================================

-- Al sincronizar gana la versión con la fecha (client_updated_at) más reciente,
-- y esa fecha la pone el reloj del dispositivo. Un reloj adelantado haría que su
-- versión ganara siempre. Aquí se limita: como mucho 5 minutos por delante del servidor.
create or replace function public.clamp_client_clock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.client_updated_at := least(new.client_updated_at, (extract(epoch from now()) * 1000)::bigint + 300000);
  return new;
end;
$$;

do $$
declare tbl text;
begin
  foreach tbl in array array['user_words', 'user_kanji', 'profiles', 'user_sentences'] loop
    execute format('drop trigger if exists %I on public.%I', tbl || '_clamp_clock', tbl);
    execute format('create trigger %I before insert or update on public.%I
      for each row execute function public.clamp_client_clock()', tbl || '_clamp_clock', tbl);
  end loop;
end $$;

-- =========================================
-- TRADUCIR: FRASES RESPONDIDAS
-- =========================================

-- Cada frase respondida en Traducir, para que la regla de "frases distintas",
-- la reutilización de correcciones y el resumen sean los mismos en todos los
-- dispositivos del usuario. result: la corrección (veredicto, palabras, comentario).
create table if not exists public.user_translations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  sentence_id text,
  text_id text,
  at timestamptz,
  source text,                      -- ai | local | self | unknown | contested | skip
  verdict text,
  score integer,
  answer text,
  answer_key text,
  lookups jsonb not null default '[]'::jsonb,
  result jsonb,
  contested boolean not null default false,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint user_translations_size_check check (char_length(coalesce(answer, '')) <= 200 and octet_length(coalesce(result::text, '')) <= 20000)
);

create index if not exists user_translations_user_updated_idx on public.user_translations (user_id, updated_at);

drop trigger if exists user_translations_set_updated_at on public.user_translations;
create trigger user_translations_set_updated_at
  before insert or update on public.user_translations
  for each row execute function public.set_updated_at();

alter table public.user_translations enable row level security;
revoke all on public.user_translations from anon;
grant select, insert, update, delete on public.user_translations to authenticated;

drop policy if exists "user_translations_select_own" on public.user_translations;
create policy "user_translations_select_own" on public.user_translations
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_translations_insert_own" on public.user_translations;
create policy "user_translations_insert_own" on public.user_translations
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_translations_update_own" on public.user_translations;
create policy "user_translations_update_own" on public.user_translations
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "user_translations_delete_own" on public.user_translations;
create policy "user_translations_delete_own" on public.user_translations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- =========================================
-- DICCIONARIO: BÚSQUEDA POR SIGNIFICADO MÁS RÁPIDA
-- =========================================

-- search_dictionary busca el significado con "contiene" (like '%…%'). Con unas
-- 22.500 palabras basta recorrer la tabla; con el JMdict completo hace falta un
-- índice de trigramas (pg_trgm). Si la extensión no está disponible no pasa nada:
-- la búsqueda funciona igual, solo que más lenta.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
exception when others then
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm no está disponible: la búsqueda por significado no tendrá índice';
  end;
end $$;

do $$
declare ops text;
begin
  select format('%I.gin_trgm_ops', n.nspname) into ops
  from pg_opclass c join pg_namespace n on n.oid = c.opcnamespace where c.opcname = 'gin_trgm_ops' limit 1;
  if ops is not null then
    execute format('create index if not exists dictionary_meanings_trgm_idx on public.dictionary using gin (lower(meanings::text) %s)', ops);
    execute format('create index if not exists dictionary_meanings_es_trgm_idx on public.dictionary using gin (lower(meanings_es::text) %s)', ops);
  end if;
end $$;

-- =========================================
-- PLANES: GRATUITO Y PREMIUM
-- =========================================

-- El plan decide cuántos textos con IA puede generar un usuario al día (la
-- función generate-text lo lee: DAILY_TEXTS o PREMIUM_DAILY_TEXTS).
--   plan_until  premium hasta esa fecha (null = sin fecha de fin)
-- Solo lo cambia un administrador (admin.html, pestaña Usuarios). Más adelante,
-- un pago lo cambiaría desde una Edge Function con la clave de servicio.
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists plan_until timestamptz;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'premium'));

-- Un usuario puede escribir su fila de profiles (su nivel de lectura), pero no
-- su plan: se ignora cualquier cambio que no venga de un administrador o del servidor.
create or replace function public.protect_profile_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.plan := 'free';
      new.plan_until := null;
    else
      new.plan := old.plan;
      new.plan_until := old.plan_until;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_plan on public.profiles;
create trigger profiles_protect_plan
  before insert or update on public.profiles
  for each row execute function public.protect_profile_plan();

-- Usuarios para administración: correo, plan y textos con IA de hoy. Solo
-- para administradores (la tabla de usuarios de Supabase no se puede leer desde la app).
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, created_at timestamptz, plan text, plan_until timestamptz, texts_today bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo para administradores' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, u.created_at, coalesce(p.plan, 'free'), p.plan_until,
      (select count(distinct coalesce(g.request_id, g.id::text)) from public.generations g
        where g.user_id = u.id and g.ok and g.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')
    from auth.users u left join public.profiles p on p.user_id = u.id
    order by u.created_at;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Cambia el plan de un usuario (solo administradores)
create or replace function public.admin_set_plan(target uuid, new_plan text, until timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'solo para administradores' using errcode = '42501';
  end if;
  if new_plan not in ('free', 'premium') then
    raise exception 'plan desconocido: %', new_plan using errcode = '22023';
  end if;
  insert into public.profiles (user_id, plan, plan_until) values (target, new_plan, until)
  on conflict (user_id) do update set plan = excluded.plan, plan_until = excluded.plan_until;
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, timestamptz) to authenticated;

-- =========================================
-- ESCRIBIR: NIVEL A NIVEL
-- =========================================

-- Niveles aprobados con la prueba de Escribir (se saltan) y cuándo se escribió
-- por última vez cada kanji (para repasar primero el que hace más que no se escribe)
alter table public.profiles add column if not exists writing_skipped text[] not null default '{}';
alter table public.user_kanji add column if not exists last_written_at timestamptz;
-- Repaso espaciado de la escritura: la tarjeta de FSRS de Escribir, aparte de la del significado (fsrs)
alter table public.user_kanji add column if not exists write_fsrs jsonb;

-- =========================================
-- LECTURAS DE CADA KANJI
-- =========================================

-- Lo acertado y fallado de cada lectura de un kanji al escribirla (una casilla
-- por kanji en Repasar, y las frases): { "めい": { "ok": 3, "ko": 1, "last": "2026-10-26" } }
alter table public.user_kanji add column if not exists kanji_readings jsonb;
alter table public.user_kanji drop constraint if exists user_kanji_readings_size_check;
alter table public.user_kanji add constraint user_kanji_readings_size_check
  check (octet_length(coalesce(kanji_readings::text, '')) <= 4000) not valid;

-- =========================================
-- FRASES COMPARTIDAS
-- =========================================

-- Frases de ejemplo para todos los usuarios, además de las de bank/sentences/.
-- Las añade la app al repasar «En una frase», ya comprobadas con la misma regla
-- que las comunes (validateSentence, sentences-core.js):
--   source 'text'  una frase de una historia (un texto propio o de la comunidad)
--                  que se usó porque no había ninguna común; nunca de un texto pegado.
--   source 'ai'    escrita por la IA (función generate-sentences) para una palabra
--                  que no tenía ninguna.
--   source 'curated'  escrita por un administrador (Ajustes → Frases propias); sale
--                  antes que las demás. Solo un administrador puede añadirlas.
-- data es la frase completa, con la forma de sentences-core.js; words, las palabras
-- que sirve para preguntar. La lee cualquiera, también sin sesión. Cada usuario solo
-- añade (con un límite diario); un administrador la borra desde admin.html (deleted_at).
create table if not exists public.shared_sentences (
  id text primary key,                        -- "idDelTexto:n" (historias) o "ai:huella" (IA)
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  source text not null,
  level text,
  words text[] not null default '{}',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint shared_sentences_size_check check (
    char_length(id) <= 120 and cardinality(words) <= 20 and octet_length(data::text) <= 20000)
);

-- Orígenes admitidos (se rehace aparte para que una base ya creada también admita 'curated')
alter table public.shared_sentences drop constraint if exists shared_sentences_source_check;
alter table public.shared_sentences add constraint shared_sentences_source_check
  check (source in ('text', 'ai', 'curated'));

create index if not exists shared_sentences_updated_idx on public.shared_sentences (updated_at, id);
create index if not exists shared_sentences_user_created_idx on public.shared_sentences (user_id, created_at);

drop trigger if exists shared_sentences_set_updated_at on public.shared_sentences;
create trigger shared_sentences_set_updated_at
  before insert or update on public.shared_sentences
  for each row execute function public.set_updated_at();

drop trigger if exists shared_sentences_daily_limit on public.shared_sentences;
create trigger shared_sentences_daily_limit before insert on public.shared_sentences
  for each row execute function public.limit_daily_inserts('200');

alter table public.shared_sentences enable row level security;
revoke all on public.shared_sentences from anon, authenticated;
grant select on public.shared_sentences to anon, authenticated;
grant insert, update on public.shared_sentences to authenticated;

drop policy if exists "shared_sentences_select_all" on public.shared_sentences;
create policy "shared_sentences_select_all" on public.shared_sentences
  for select to anon, authenticated using (true);

drop policy if exists "shared_sentences_insert_own" on public.shared_sentences;
create policy "shared_sentences_insert_own" on public.shared_sentences
  for insert to authenticated with check (
    (select auth.uid()) = user_id and deleted_at is null and (source <> 'curated' or (select public.is_admin())));

-- Solo un administrador cambia una frase ya compartida (para borrarla, deleted_at)
drop policy if exists "shared_sentences_update_admin" on public.shared_sentences;
create policy "shared_sentences_update_admin" on public.shared_sentences
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Registro de cada llamada de la función generate-sentences: el límite diario de
-- palabras por usuario y lo que respondió la IA. Aparte de generations, para no
-- gastar la cuota de textos. Solo la función escribe; los administradores leen.
create table if not exists public.sentence_generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  words integer not null default 0,           -- palabras pedidas en la llamada
  ok boolean not null default false,
  result text,                                -- ok | invalid_json | missing_fields | truncated | empty | provider | quota
  level text,
  model text,
  key_label text,
  attempts text,
  prompt_version text,
  prompt_tokens integer,
  output_tokens integer,
  error text,
  raw text
);

create index if not exists sentence_generations_user_created_idx on public.sentence_generations (user_id, created_at);

alter table public.sentence_generations enable row level security;
revoke all on public.sentence_generations from anon, authenticated;
grant select on public.sentence_generations to authenticated;
drop policy if exists "sentence_generations_admin_select" on public.sentence_generations;
create policy "sentence_generations_admin_select" on public.sentence_generations
  for select to authenticated using ((select public.is_admin()));

-- =========================================
-- ANÁLISIS DEL PROGRESO
-- =========================================

-- Una foto del progreso por usuario y semana ISO ("2026-W43"): cuántas palabras y
-- kanjis de cada nivel JLPT ha demostrado, su nivel estimado, lectura y constancia
-- (progress-core.js, snapshotOf). La app la rehace en cada sincronización de esa
-- semana; gana la de client_updated_at más reciente. Cada usuario ve las suyas y
-- los administradores, todas (para la vista del profesor, más adelante).
create table if not exists public.progress_snapshots (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  data jsonb not null,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, week),
  constraint progress_snapshots_size_check check (octet_length(data::text) <= 20000)
);

create index if not exists progress_snapshots_user_updated_idx on public.progress_snapshots (user_id, updated_at);

drop trigger if exists progress_snapshots_set_updated_at on public.progress_snapshots;
create trigger progress_snapshots_set_updated_at
  before insert or update on public.progress_snapshots
  for each row execute function public.set_updated_at();

drop trigger if exists progress_snapshots_clamp_clock on public.progress_snapshots;
create trigger progress_snapshots_clamp_clock
  before insert or update on public.progress_snapshots
  for each row execute function public.clamp_client_clock();

alter table public.progress_snapshots enable row level security;
revoke all on public.progress_snapshots from anon;
grant select, insert, update on public.progress_snapshots to authenticated;

drop policy if exists "progress_snapshots_select_own" on public.progress_snapshots;
create policy "progress_snapshots_select_own" on public.progress_snapshots
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "progress_snapshots_insert_own" on public.progress_snapshots;
create policy "progress_snapshots_insert_own" on public.progress_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "progress_snapshots_update_own" on public.progress_snapshots;
create policy "progress_snapshots_update_own" on public.progress_snapshots
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Resumen de la semana con IA (función summarize-progress, solo premium): uno por
-- usuario, semana e idioma. La función lo escribe y, si ya está, lo devuelve sin
-- llamar a la IA. Cada usuario lee los suyos y los administradores, todos.
create table if not exists public.progress_summaries (
  user_id uuid not null references auth.users (id) on delete cascade,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  lang text not null check (lang in ('es', 'en')),
  summary text not null check (char_length(summary) <= 1000),
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  primary key (user_id, week, lang)
);

alter table public.progress_summaries enable row level security;
revoke all on public.progress_summaries from anon, authenticated;
grant select on public.progress_summaries to authenticated;
drop policy if exists "progress_summaries_select_own" on public.progress_summaries;
create policy "progress_summaries_select_own" on public.progress_summaries
  for select to authenticated using ((select auth.uid()) = user_id or (select public.is_admin()));

-- Registro de cada llamada de summarize-progress (límite diario y errores). Solo la
-- función escribe; los administradores leen.
create table if not exists public.summary_generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  ok boolean not null default false,
  result text,                                -- ok | empty | provider | quota
  model text,
  key_label text,
  attempts text,
  prompt_version text,
  prompt_tokens integer,
  output_tokens integer,
  error text
);

create index if not exists summary_generations_user_created_idx on public.summary_generations (user_id, created_at);

alter table public.summary_generations enable row level security;
revoke all on public.summary_generations from anon, authenticated;
grant select on public.summary_generations to authenticated;
drop policy if exists "summary_generations_admin_select" on public.summary_generations;
create policy "summary_generations_admin_select" on public.summary_generations
  for select to authenticated using ((select public.is_admin()));

-- =========================================
-- LEER CUENTA COMO REPASO
-- =========================================

-- Una palabra que toca repasar y sale en un texto terminado cuenta como repaso
-- (learning-core.js, sección 3). read_streak: lecturas seguidas que han valido
-- desde la última tarjeta en Repasar; last_read_review: el último día que valió.
-- reviews: lo que valió en cada sesión, { "名前|なまえ": "good" | "again" }.
alter table public.user_words add column if not exists read_streak integer not null default 0;
alter table public.user_words add column if not exists last_read_review date;
alter table public.reading_sessions add column if not exists reviews jsonb;

-- =========================================
-- DEMOSTRAR LOS KANJIS DE UN NIVEL
-- =========================================

-- Cuándo demostró el kanji en la prueba de su nivel (proof.js): significado y
-- cómo suena en una palabra que conoce, las dos bien
alter table public.user_kanji add column if not exists proof_at timestamptz;

-- =========================================
-- AVISOS DE REPASO (Web Push)
-- =========================================

-- Un dispositivo suscrito a los avisos (notify.js). La Edge Function notify-due,
-- llamada cada hora por pg_cron (SETUP.md), cuenta las palabras que tocan con
-- lo último sincronizado y avisa cuando se junta un grupo (min_due) de día en su
-- zona horaria. last_sent_at / last_count: el último aviso, para no repetirlo.
create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) <= 1000),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  tz text not null default 'UTC' check (char_length(tz) <= 64),
  min_due integer not null default 10 check (min_due between 1 and 200),
  lang text not null default 'es' check (lang in ('es', 'en')),
  last_sent_at timestamptz,
  last_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Una zona horaria que Postgres no conoce rompería el recuento de todos: se cambia por UTC
create or replace function public.push_subscription_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.tz) then new.tz := 'UTC'; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists push_subscription_check on public.push_subscriptions;
create trigger push_subscription_check before insert or update on public.push_subscriptions
  for each row execute function public.push_subscription_check();

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Las claves VAPID y el secreto de la tarea programada: solo el servidor (sin políticas)
create table if not exists public.push_config (
  id integer primary key check (id = 1),
  vapid_public text not null,
  vapid_private text not null,
  cron_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

create or replace function public.check_cron_secret(secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_config where id = 1 and cron_secret = secret and secret <> '')
$$;
revoke execute on function public.check_cron_secret(text) from public, anon, authenticated;

-- Cuántas palabras tocan a cada dispositivo, con su hora y su día. Igual que
-- recordDue (learning-core.js): un paso corto (scheduled_days 0) toca a su hora
-- exacta; las demás, el día de next_review en su zona horaria.
create or replace function public.push_due_counts()
returns table (endpoint text, p256dh text, auth text, lang text, min_due integer, due integer,
               local_hour integer, local_day text, last_sent_at timestamptz, last_day text, last_count integer)
language sql stable security definer set search_path = '' as $$
  select s.endpoint, s.p256dh, s.auth, s.lang, s.min_due,
    (select count(*)::integer from public.user_words w
      where w.user_id = s.user_id and w.studied and (
        case when (w.fsrs ->> 'scheduled_days') = '0' and w.fsrs ? 'due'
          then (w.fsrs ->> 'due')::timestamptz <= now()
          else w.next_review <= (now() at time zone s.tz)::date end)),
    extract(hour from now() at time zone s.tz)::integer,
    to_char(now() at time zone s.tz, 'YYYY-MM-DD'),
    s.last_sent_at,
    to_char(s.last_sent_at at time zone s.tz, 'YYYY-MM-DD'),
    s.last_count
  from public.push_subscriptions s
$$;
revoke execute on function public.push_due_counts() from public, anon, authenticated;

-- La Edge Function usa service_role (en Supabase existe; en las pruebas no)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.check_cron_secret(text) to service_role;
    grant execute on function public.push_due_counts() to service_role;
    grant all on public.push_config, public.push_subscriptions to service_role;
  end if;
end $$;
