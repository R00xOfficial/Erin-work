-- 11: OAuth credentials live in the private schema (not exposed by PostgREST). Service role only.

create table private.oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gmail',
  account_email text not null,
  encrypted_refresh_token bytea,
  encrypted_access_token bytea,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  enc_key_version int not null default 1,
  last_history_id text,
  last_sync_at timestamptz,
  last_error text,
  status public.oauth_status not null default 'active',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_email)
);

-- Ensure the standard Supabase roles exist (they do on Supabase; the local smoke test needs them).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
alter default privileges in schema private grant all on tables to service_role;

-- Non-secret status view for the dashboard (authenticated users).
create view public.oauth_credential_status with (security_invoker = false) as
  select id, provider, account_email, scopes, status, last_history_id is not null as has_synced, last_sync_at, last_error, connected_at, updated_at,
         access_token_expires_at
  from private.oauth_credentials;
grant select on public.oauth_credential_status to authenticated, service_role;
