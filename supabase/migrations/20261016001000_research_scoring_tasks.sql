-- 10: research notes, scores, AI runs, tasks, job requests, audit log.

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  purpose public.ai_purpose not null,
  entity_type text not null,
  entity_id uuid not null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  input_tokens int,
  output_tokens int,
  status public.ai_run_status not null default 'running',
  output jsonb,
  validation_errors jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (purpose, entity_id, input_hash)
);

create table public.research_notes (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  why_fit text,
  relevant_project text,
  design_interest text,
  matching_skills text[] not null default '{}',
  gaps text[] not null default '{}',
  hiring_signal_summary text,
  best_contact_id uuid references public.contacts (id) on delete set null,
  best_contact_reason text,
  personalised_opener text,
  proposed_ask text,
  evidence_status public.evidence_status not null default 'unverified',
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  is_current boolean not null default true,
  reviewed_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english', public.fn_immutable_unaccent(coalesce(why_fit,'') || ' ' || coalesce(relevant_project,'') || ' ' || coalesce(personalised_opener,'')))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index research_notes_current_uq on public.research_notes (employer_id, coalesce(vacancy_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_current;

create table public.employer_scores (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  weights_version int not null references public.scoring_weights (version),
  total numeric(5,2) not null,
  factor_scores jsonb not null,
  factor_reasons jsonb not null,
  unknown_factors text[] not null default '{}',
  hard_flags text[] not null default '{}',
  band public.score_band not null,
  computed_at timestamptz not null default now()
);
create index employer_scores_employer_idx on public.employer_scores (employer_id, computed_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  task_type public.task_type not null default 'other',
  entity_type text,
  entity_id uuid,
  employer_id uuid references public.employers (id) on delete cascade,
  due_at timestamptz,
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'open',
  auto_generated boolean not null default false,
  dedupe_key text,
  notes text,
  snoozed_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tasks_dedupe_open_uq on public.tasks (dedupe_key) where dedupe_key is not null and status in ('open','in_progress','snoozed');
create index tasks_due_idx on public.tasks (due_at) where status in ('open','in_progress','snoozed');
create index tasks_employer_idx on public.tasks (employer_id);

-- Bridge: the web app inserts a request; the worker drains it into pg-boss so the web app needs no queue connection.
create table public.job_requests (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  payload jsonb not null default '{}'::jsonb,
  singleton_key text,
  status public.job_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  picked_up_at timestamptz,
  finished_at timestamptz,
  error text
);
create index job_requests_pending_idx on public.job_requests (requested_at) where status = 'pending';

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  action text not null,
  actor text,
  diff jsonb,
  at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, at desc);
