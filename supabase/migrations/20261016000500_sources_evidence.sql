-- 05: sources, evidence, provenance, imports.

create table public.source_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  adapter_type public.source_adapter_type not null,
  enabled boolean not null default false,
  requires_env text[] not null default '{}',
  schedule_cron text,
  config jsonb not null default '{}'::jsonb,
  min_interval_ms int not null default 2000,
  daily_request_cap int,
  requests_today int not null default 0,
  requests_today_date date,
  consecutive_failures int not null default 0,
  disabled_reason text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.host_policies (
  host text primary key,
  robots_txt text,
  robots_fetched_at timestamptz,
  crawl_delay_s numeric(6,2),
  allowed boolean not null default true,
  user_agent text,
  paused_until timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  url_hash text not null unique,
  canonical_url text,
  host text references public.host_policies (host) on delete set null,
  publisher text,
  title text,
  source_kind text,
  evidence_type public.evidence_type not null default 'secondary_reputable',
  confidence numeric(5,2) not null default 50,
  verification_status text not null default 'unverified',
  source_definition_id uuid references public.source_definitions (id) on delete set null,
  entity_type public.claim_entity_type,
  entity_id uuid,
  claims_summary text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  last_changed_at timestamptz,
  http_status int,
  etag text,
  last_modified text,
  content_hash text,
  fetch_status public.fetch_status not null default 'never',
  fetch_error text,
  recheck_interval interval not null default interval '7 days',
  next_check_at timestamptz,
  expires_at timestamptz,
  snapshot_storage_path text,
  conflict_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sources_next_check_idx on public.sources (next_check_at) where fetch_status <> 'disabled';
create index sources_entity_idx on public.sources (entity_type, entity_id);
create index sources_host_idx on public.sources (host);

create table public.source_runs (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid references public.source_definitions (id) on delete cascade,
  job_name text,
  pgboss_job_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.source_run_status not null default 'running',
  items_seen int not null default 0,
  items_new int not null default 0,
  items_changed int not null default 0,
  items_deduped int not null default 0,
  requests_made int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  notes text
);
create index source_runs_def_idx on public.source_runs (source_definition_id, started_at desc);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  entity_type public.claim_entity_type not null,
  entity_id uuid not null,
  field_name text not null,
  value jsonb,
  evidence_status public.evidence_status not null default 'unverified',
  source_id uuid references public.sources (id) on delete set null,
  quote text,
  extracted_by public.claim_extractor not null default 'human',
  model text,
  prompt_version text,
  confidence numeric(5,2),
  conflicts_with_claim_id uuid references public.claims (id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index claims_entity_field_source_uq on public.claims (entity_type, entity_id, field_name, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index claims_entity_idx on public.claims (entity_type, entity_id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  kind public.import_kind not null,
  file_name text,
  storage_path text,
  row_count int not null default 0,
  created_count int not null default 0,
  merged_count int not null default 0,
  duplicate_count int not null default 0,
  rejected_count int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports (id) on delete cascade,
  row_no int not null,
  raw jsonb not null,
  result public.import_row_result,
  entity_type text,
  entity_id uuid,
  message text,
  unique (import_id, row_no)
);
