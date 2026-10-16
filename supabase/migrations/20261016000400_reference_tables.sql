-- 04: reference / configuration tables.

create table public.candidate_profile (
  id boolean primary key default true check (id),
  full_name text,
  email text,
  phone text,
  qualification public.candidate_qualification not null default 'part1_equivalent',
  qualification_verified boolean not null default false,
  university text,
  graduation_year int,
  experience_years numeric(4,1) not null default 0,
  experience_summary text,
  software text[] not null default '{}',
  skills text[] not null default '{}',
  sector_interests text[] not null default '{}',
  target_role_families public.role_family[] not null default '{}',
  accept_adjacent_entry_roles boolean not null default true,
  accepted_employment_types public.employment_type[] not null default '{permanent,fixed_term,temporary,contract,internship,placement,apprenticeship,part_time}',
  working_arrangement_preference public.working_arrangement not null default 'unknown',
  objective text not null default 'get_into_work_fast',
  home_postcode text,
  home_lat numeric(9,6),
  home_lng numeric(9,6),
  max_public_transport_minutes int not null default 90,
  max_car_minutes int,
  min_salary_gbp int,
  has_uk_right_to_work boolean not null default true,
  availability_from date,
  portfolio_url text,
  linkedin_url text,
  default_cv_document_id uuid,
  default_portfolio_document_id uuid,
  default_cover_letter_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.candidate_profile is 'Singleton: the job seeker''s eligibility profile that drives scoring and hard flags.';

create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create table public.geo_zones (
  code text primary key,
  label text not null,
  description text,
  postcode_areas text[] not null default '{}',
  postcode_districts text[] not null default '{}',
  towns text[] not null default '{}',
  max_pt_minutes int not null default 90,
  sort_order int not null default 100
);

create table public.pipeline_stage_meta (
  pipeline public.pipeline_kind not null,
  stage text not null,
  sort_order int not null,
  label text not null,
  is_terminal boolean not null default false,
  sla_days int,
  colour text,
  primary key (pipeline, stage)
);

create table public.scoring_weights (
  version int primary key,
  weights jsonb not null,
  band_thresholds jsonb not null,
  hard_flag_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create unique index scoring_weights_one_active on public.scoring_weights (is_active) where is_active;

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version int not null default 1,
  purpose public.template_purpose not null,
  subject_tmpl text not null,
  body_tmpl text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, version)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  kind public.document_kind not null,
  version_label text not null,
  storage_bucket text not null default 'documents',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text not null,
  is_current boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index documents_kind_version_uq on public.documents (kind, version_label) where deleted_at is null;
create unique index documents_one_current_per_kind on public.documents (kind) where is_current and deleted_at is null;

alter table public.candidate_profile
  add constraint candidate_profile_cv_fk foreign key (default_cv_document_id) references public.documents (id) on delete set null,
  add constraint candidate_profile_portfolio_fk foreign key (default_portfolio_document_id) references public.documents (id) on delete set null,
  add constraint candidate_profile_cover_fk foreign key (default_cover_letter_document_id) references public.documents (id) on delete set null;
