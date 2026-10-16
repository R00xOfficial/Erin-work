-- 06: employers, aliases, offices, travel times, contacts.

create table public.employers (
  id uuid primary key default gen_random_uuid(),
  -- identity
  legal_name text not null,
  display_name text,
  normalised_name text not null,
  previous_names text[] not null default '{}',
  parent_company text,
  subsidiaries text[] not null default '{}',
  companies_house_number text,
  company_status text,
  legal_form text,
  date_established date,
  -- classification
  practice_type public.practice_type not null default 'architecture_practice',
  is_architecture_practice boolean,
  riba_chartered public.yes_no_unknown not null default 'unknown',
  riba_chartered_evidence public.evidence_status not null default 'unverified',
  ciat_relationship text,
  specialisms text[] not null default '{}',
  service_lines text[] not null default '{}',
  client_types text[] not null default '{}',
  sectors text[] not null default '{}',
  -- digital presence
  website text,
  website_domain text,
  careers_url text,
  contact_url text,
  linkedin_url text,
  instagram_url text,
  directory_profile_urls text[] not null default '{}',
  portfolio_urls text[] not null default '{}',
  -- scale
  size_band public.size_band not null default 'unknown',
  staff_estimate int,
  staff_estimate_source text,
  office_count int,
  international_presence boolean,
  team_structure_notes text,
  -- intelligence (fact text + evidence status for each block)
  business_signals text,
  business_signals_evidence public.evidence_status not null default 'unverified',
  vision_culture text,
  vision_culture_evidence public.evidence_status not null default 'unverified',
  project_intelligence text,
  project_intelligence_evidence public.evidence_status not null default 'unverified',
  recruitment_intelligence text,
  recruitment_intelligence_evidence public.evidence_status not null default 'unverified',
  hires_part1 public.yes_no_unknown not null default 'unknown',
  hires_part1_evidence public.evidence_status not null default 'unverified',
  has_graduate_programme public.yes_no_unknown not null default 'unknown',
  accepts_speculative public.yes_no_unknown not null default 'unknown',
  typical_entry_roles text[] not null default '{}',
  software text[] not null default '{}',
  is_design_studio boolean,
  training_support text,
  recruitment_channel text,
  applications_email text,
  generic_email text,
  phone text,
  -- provenance / quality
  record_status text not null default 'active',
  confidence_score numeric(5,2) not null default 0,
  data_quality public.data_quality not null default 'poor',
  discovered_via_source_id uuid references public.sources (id) on delete set null,
  first_discovered_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  next_review_at timestamptz,
  research_notes text,
  -- pipeline
  outreach_stage public.employer_outreach_stage not null default 'discovered',
  outreach_stage_changed_at timestamptz not null default now(),
  is_suppressed boolean not null default false,
  -- scoring cache
  latest_score numeric(5,2),
  latest_band public.score_band,
  latest_scored_at timestamptz,
  -- search
  search_vector tsvector generated always as (
    to_tsvector('english', public.fn_immutable_unaccent(
      coalesce(legal_name, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(public.fn_immutable_array_to_string(sectors, ' '), '') || ' ' ||
      coalesce(public.fn_immutable_array_to_string(specialisms, ' '), '') || ' ' || coalesce(research_notes, '')))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index employers_ch_number_uq on public.employers (companies_house_number) where companies_house_number is not null and deleted_at is null;
create unique index employers_normalised_name_uq on public.employers (normalised_name) where companies_house_number is null and deleted_at is null;
create unique index employers_domain_uq on public.employers (website_domain) where website_domain is not null and deleted_at is null;
create index employers_name_trgm on public.employers using gin (normalised_name extensions.gin_trgm_ops);
create index employers_search_idx on public.employers using gin (search_vector);
create index employers_stage_idx on public.employers (outreach_stage) where deleted_at is null;
create index employers_band_idx on public.employers (latest_band, latest_score desc) where deleted_at is null;
create index employers_review_idx on public.employers (next_review_at) where deleted_at is null;

create table public.employer_aliases (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  alias text not null,
  normalised_alias text not null unique,
  source_id uuid references public.sources (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  label text,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  country text not null default 'United Kingdom',
  postcode text,
  lat numeric(9,6),
  lng numeric(9,6),
  geog geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null
         then ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)::geography
         else null end) stored,
  office_type public.office_type not null default 'studio',
  zone_code text references public.geo_zones (code) on delete set null,
  distance_km numeric(7,2),
  working_arrangement public.working_arrangement not null default 'unknown',
  transport_notes text,
  phone text,
  email text,
  website text,
  careers_url text,
  local_hiring_contact_id uuid,
  team_size_estimate int,
  status public.office_status not null default 'unverified',
  is_primary boolean not null default false,
  evidence_status public.evidence_status not null default 'unverified',
  source_id uuid references public.sources (id) on delete set null,
  last_verified_at timestamptz,
  geocoded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index offices_employer_address_uq on public.offices (employer_id, coalesce(postcode, ''), coalesce(lower(address_line1), ''), coalesce(lower(town), '')) where deleted_at is null;
create index offices_geog_idx on public.offices using gist (geog);
create index offices_employer_idx on public.offices (employer_id);

create table public.travel_times (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete cascade,
  origin_key text not null,
  origin_postcode text,
  mode public.travel_mode not null,
  minutes int not null,
  distance_km numeric(7,2),
  provider public.travel_provider not null,
  arrive_by time,
  computed_at timestamptz not null default now(),
  valid_until timestamptz,
  raw jsonb,
  unique (office_id, origin_key, mode, provider)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  office_id uuid references public.offices (id) on delete set null,
  full_name text not null,
  role_title text,
  role_category public.role_category not null default 'other',
  department text,
  relevance_rank int not null default 5 check (relevance_rank between 1 and 10),
  hiring_authority public.hiring_authority not null default 'unknown',
  relevance_notes text,
  official_profile_url text,
  linkedin_url text,
  publications text,
  email text,
  email_source text,
  email_verification public.email_verification not null default 'unverified',
  email_verified_at timestamptz,
  general_recruitment_email text,
  phone text,
  contact_form_url text,
  preferred_channel public.contact_channel,
  relationship_status public.relationship_status not null default 'none',
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  last_reply_at timestamptz,
  do_not_contact boolean not null default false,
  opt_out_at timestamptz,
  suppression_reason text,
  lawful_basis_note text not null default 'Legitimate interest: professional contact approached about employment opportunities only.',
  retention_rule text not null default 'Purge personal data 12 months after employer record is closed; keep suppression entries.',
  source_id uuid references public.sources (id) on delete set null,
  evidence_status public.evidence_status not null default 'unverified',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index contacts_employer_email_uq on public.contacts (employer_id, lower(email)) where email is not null and deleted_at is null;
create index contacts_employer_idx on public.contacts (employer_id);

alter table public.offices add constraint offices_local_contact_fk foreign key (local_hiring_contact_id) references public.contacts (id) on delete set null;
