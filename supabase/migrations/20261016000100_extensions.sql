-- 01: extensions and schemas.
-- Works on Supabase (extensions live in schema "extensions") and on a plain postgis/postgis docker image.
create schema if not exists extensions;
create schema if not exists private;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists postgis with schema extensions;

comment on schema private is 'Tables never exposed through the Data API (OAuth credentials). Service role only.';

-- Make extension functions resolvable without qualification for the current database (Supabase already does this).
do $$
begin
  execute format('alter database %I set search_path to "$user", public, extensions', current_database());
exception when others then
  raise notice 'could not alter database search_path: %', sqlerrm;
end $$;
