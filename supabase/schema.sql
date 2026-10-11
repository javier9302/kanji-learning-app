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
  check (origin in ('manual', 'lectura', 'frecuencia', 'diccionario'));

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
--           empty | provider | quota
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

-- Correcciones con las que el estudiante no estuvo de acuerdo: van a text_reports
-- con kind 'grade' (category 'contested'), enlazadas por request_id con translation_grades.
alter table public.text_reports drop constraint if exists text_reports_kind_check;
alter table public.text_reports add constraint text_reports_kind_check check (kind in ('auto', 'user', 'grade'));

-- Historial diario: frases traducidas y cuántas bien. No cambian reviews/correct/new_items.
alter table public.days add column if not exists translations integer not null default 0;
alter table public.days add column if not exists translations_correct integer not null default 0;
