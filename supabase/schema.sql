-- =========================================
-- KANJI LEARNING APP - supabase/schema.sql
-- Tablas de datos por usuario. Ejecuta este archivo entero en
-- Supabase: SQL Editor -> New query -> pegar -> Run.
-- Se puede ejecutar más de una vez sin perder datos.
-- =========================================

-- Elementos (kanjis y palabras) con su progreso de repaso.
-- La app trabaja con su copia local y sube aquí los cambios.
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
