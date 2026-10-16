-- 07: vacancies, snapshots, hiring signals, planning applications.

create table public.vacancies (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid references public.employers (id) on delete set null,
  employer_match_status public.employer_match_status not null default 'pending',
  employer_name_raw text,
  posted_by_agency_id uuid references public.employers (id) on delete set null,
  office_id uuid references public.offices (id) on delete set null,
  title text not null,
  normalised_title text,
  role_family public.role_family not null default 'unknown',
  canonical_url text,
  canonical_url_hash text,
  original_url text not null,
  source_definition_id uuid references public.source_definitions (id) on delete set null,
  source_id uuid references public.sources (id) on delete set null,
  discovery_source text,
  external_ref text,
  first_seen_at timestamptz not null default now(),
  posted_at timestamptz,
  closing_at timestamptz,
  last_verified_at timestamptz,
  last_checked_at timestamptz,
  disappeared_at timestamptz,
  status public.vacancy_status not null default 'unverified',
  employment_type public.employment_type not null default 'unknown',
  seniority public.seniority not null default 'unknown',
  qualification_required public.qualification_required not null default 'unknown',
  experience_years_min int,
  experience_years_max int,
  salary_min numeric(10,2),
  salary_max numeric(10,2),
  salary_currency text not null default 'GBP',
  salary_period public.salary_period not null default 'unknown',
  salary_is_estimate boolean not null default false,
  salary_text text,
  hours_text text,
  benefits text[] not null default '{}',
  holiday_text text,
  pension_text text,
  hybrid_policy public.working_arrangement not null default 'unknown',
  office_attendance_text text,
  location_text text,
  postcode text,
  lat numeric(9,6),
  lng numeric(9,6),
  zone_code text references public.geo_zones (code) on delete set null,
  software_requested text[] not null default '{}',
  skills_requested text[] not null default '{}',
  sectors_requested text[] not null default '{}',
  responsibilities text[] not null default '{}',
  reporting_line text,
  team_info text,
  right_to_work_required boolean,
  portfolio_required boolean,
  portfolio_requirements text,
  application_route public.application_route not null default 'unknown',
  application_email text,
  application_url text,
  recruitment_contact_id uuid references public.contacts (id) on delete set null,
  application_deadline timestamptz,
  description_snapshot text,
  description_hash text,
  description_snapshot_at timestamptz,
  description_is_truncated boolean not null default false,
  eligibility_status public.eligibility_status not null default 'needs_review',
  hard_flags text[] not null default '{}',
  eligibility_reasons text[] not null default '{}',
  eligibility_checked_at timestamptz,
  dedup_fingerprint text,
  duplicate_of_vacancy_id uuid references public.vacancies (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  search_vector tsvector generated always as (
    to_tsvector('english', public.fn_immutable_unaccent(
      coalesce(title, '') || ' ' || coalesce(employer_name_raw, '') || ' ' || coalesce(location_text, '') || ' ' || coalesce(left(description_snapshot, 20000), '')))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index vacancies_canonical_url_hash_uq on public.vacancies (canonical_url_hash) where canonical_url_hash is not null and deleted_at is null;
create index vacancies_fingerprint_idx on public.vacancies (dedup_fingerprint, first_seen_at desc);
create index vacancies_employer_idx on public.vacancies (employer_id);
create index vacancies_status_idx on public.vacancies (status, eligibility_status) where deleted_at is null;
create index vacancies_search_idx on public.vacancies using gin (search_vector);
create index vacancies_unreviewed_idx on public.vacancies (first_seen_at desc) where reviewed_at is null and deleted_at is null;

create table public.vacancy_snapshots (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  content_hash text not null,
  description text,
  raw jsonb,
  source_url text,
  source_run_id uuid references public.source_runs (id) on delete set null,
  captured_at timestamptz not null default now(),
  unique (vacancy_id, content_hash)
);

create table public.hiring_signals (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  signal_type public.signal_type not null,
  strength public.signal_strength not null default 'weak',
  observed_on date not null default current_date,
  expires_on date,
  summary text not null,
  what_it_might_indicate text,
  source_id uuid references public.sources (id) on delete set null,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  evidence_status public.evidence_status not null default 'unverified',
  task_created boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index hiring_signals_uq on public.hiring_signals (employer_id, signal_type, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid), observed_on);
create index hiring_signals_employer_idx on public.hiring_signals (employer_id, observed_on desc);

create table public.planning_applications (
  id uuid primary key default gen_random_uuid(),
  planit_uid text not null unique,
  authority text,
  reference text,
  description text,
  address text,
  postcode text,
  lat numeric(9,6),
  lng numeric(9,6),
  app_state text,
  app_type text,
  start_date date,
  decided_date date,
  agent_name text,
  normalised_agent text,
  applicant_name text,
  employer_id uuid references public.employers (id) on delete set null,
  url text,
  raw jsonb,
  fetched_at timestamptz not null default now()
);
create index planning_apps_agent_idx on public.planning_applications (normalised_agent);
create index planning_apps_employer_idx on public.planning_applications (employer_id, start_date desc);
