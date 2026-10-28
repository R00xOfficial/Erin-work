-- 21: Stage 2 (Research and Score).
-- Evidence-backed requirements, versioned assessments (vacancy suitability and employer speculative priority),
-- research run logs, profile versioning/approval and Stage 3 readiness. Nothing here contacts employers.

create type public.requirement_kind as enum ('qualification','registration','experience','skill','software','other');
create type public.requirement_necessity as enum ('essential','desirable','unclear');
create type public.requirement_review as enum ('unreviewed','confirmed','corrected','disputed','rejected');
create type public.assessment_kind as enum ('vacancy','employer');
create type public.research_run_status as enum ('queued','running','succeeded','partial','failed');
create type public.research_state as enum ('none','queued','running','needs_review','reviewed','failed');

-- Candidate profile: every fit-relevant edit bumps the version; approval pins the version Erin signed off.
alter table public.candidate_profile
  add column profile_version int not null default 1,
  add column approved_version int,
  add column approved_at timestamptz;

create function public.fn_candidate_profile_version() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'profile_version' - 'approved_version' - 'approved_at')
     is distinct from (to_jsonb(old) - 'updated_at' - 'profile_version' - 'approved_version' - 'approved_at') then
    new.profile_version := old.profile_version + 1;
  end if;
  return new;
end $$;
create trigger trg_candidate_profile_version before update on public.candidate_profile for each row execute function public.fn_candidate_profile_version();

-- Research / Stage 3 state on the records themselves (history lives in assessments and research_runs).
alter table public.vacancies
  add column research_state public.research_state not null default 'none',
  add column research_requested_at timestamptz,
  add column stage3_saved_at timestamptz,
  add column returned_to_discovery_at timestamptz;
alter table public.employers
  add column research_state public.research_state not null default 'none',
  add column research_requested_at timestamptz,
  add column stage3_saved_at timestamptz,
  add column returned_to_discovery_at timestamptz;

-- One row per requirement the vacancy itself states. Quote is verbatim from the vacancy text; user review is kept per row.
create table public.vacancy_requirements (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  kind public.requirement_kind not null,
  necessity public.requirement_necessity not null default 'unclear',
  text text not null,
  normalised_text text not null,
  quote text,
  source_id uuid references public.sources (id) on delete set null,
  evidence_status public.evidence_status not null default 'unverified',
  confidence numeric(5,2),
  extracted_by public.claim_extractor not null default 'ai',
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  review public.requirement_review not null default 'unreviewed',
  review_note text,
  original jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vacancy_requirements_uq on public.vacancy_requirements (vacancy_id, kind, normalised_text) where is_current;
create index vacancy_requirements_vacancy_idx on public.vacancy_requirements (vacancy_id) where is_current;
create trigger trg_set_updated_at before update on public.vacancy_requirements for each row execute function public.fn_set_updated_at();

-- Editable weights for both assessment types. Exactly one active version per kind.
create table public.assessment_weights (
  version serial primary key,
  kind public.assessment_kind not null,
  weights jsonb not null,
  is_active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create unique index assessment_weights_active_uq on public.assessment_weights (kind) where is_active;

insert into public.assessment_weights (kind, weights, is_active, notes) values
('vacancy', '{"qualifications":25,"experience":20,"skills":20,"location_practical":15,"career_relevance":10,"training_development":10}', true,
 'Suggested starting weights. The score is decision support, not a prediction of an offer.'),
('employer', '{"geography":30,"relevant_work":20,"recruitment_evidence":20,"training_development":10,"speculative_rationale":20}', true,
 'Employer speculative-priority weights. Not comparable with vacancy suitability scores.');

-- Versioned assessments. A new row is written only when an input changes; the previous row is superseded, never edited.
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  kind public.assessment_kind not null,
  employer_id uuid not null references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  profile_version int not null,
  profile_approved boolean not null default false,
  weights_version int not null references public.assessment_weights (version),
  total numeric(5,2) not null,
  criteria jsonb not null,
  blockers jsonb not null default '[]',
  strengths text[] not null default '{}',
  missing text[] not null default '{}',
  develop text[] not null default '{}',
  questions text[] not null default '{}',
  conflicts jsonb not null default '[]',
  next_steps text[] not null default '{}',
  completeness numeric(5,2) not null default 0,
  confidence numeric(5,2) not null default 0,
  inputs_hash text not null,
  research_run_id uuid,
  is_current boolean not null default true,
  superseded_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  computed_at timestamptz not null default now(),
  check (kind <> 'vacancy' or vacancy_id is not null)
);
create unique index assessments_current_uq on public.assessments (kind, coalesce(vacancy_id, employer_id)) where is_current;
create index assessments_history_idx on public.assessments (kind, coalesce(vacancy_id, employer_id), computed_at desc);

-- A log of each research attempt, step by step, including which sources could not be read.
create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  kind public.assessment_kind not null,
  employer_id uuid not null references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  status public.research_run_status not null default 'queued',
  trigger text not null default 'manual',
  steps jsonb not null default '[]',
  completeness numeric(5,2),
  error text,
  retry_of uuid references public.research_runs (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index research_runs_entity_idx on public.research_runs (kind, coalesce(vacancy_id, employer_id), created_at desc);

alter table public.vacancy_requirements enable row level security;
alter table public.assessment_weights enable row level security;
alter table public.assessments enable row level security;
alter table public.research_runs enable row level security;
create policy authenticated_all on public.vacancy_requirements for all to authenticated using (true) with check (true);
create policy authenticated_all on public.assessment_weights for all to authenticated using (true) with check (true);
create policy authenticated_all on public.assessments for all to authenticated using (true) with check (true);
create policy authenticated_all on public.research_runs for all to authenticated using (true) with check (true);
grant all on table public.vacancy_requirements, public.assessment_weights, public.assessments, public.research_runs to authenticated, service_role;
grant usage, select on sequence public.assessment_weights_version_seq to authenticated, service_role;
revoke all on table public.vacancy_requirements, public.assessment_weights, public.assessments, public.research_runs from anon;

-- Research queue for vacancies: one row per logical vacancy with its current assessment and latest run.
create view public.v_research_vacancies with (security_invoker = true) as
select
  v.id, v.title, v.employer_id, coalesce(e.display_name, e.legal_name, v.employer_name_raw) as employer_name,
  v.status, v.discovery_state, v.research_state, v.stage3_saved_at, v.returned_to_discovery_at, v.last_verified_at, v.closing_at, v.location_text,
  a.id as assessment_id, a.total, a.completeness, a.confidence, a.computed_at, a.reviewed_at, a.profile_approved,
  coalesce(jsonb_array_length(a.blockers), 0) as blocker_count,
  coalesce(jsonb_array_length(a.conflicts), 0) as conflict_count,
  (select count(*) from public.vacancy_requirements r where r.vacancy_id = v.id and r.is_current and r.review = 'disputed') as disputed_count,
  r.status as run_status, r.error as run_error, r.finished_at as run_finished_at,
  (a.id is null or a.computed_at < now() - interval '30 days' or coalesce(v.last_verified_at, v.first_seen_at) < now() - interval '30 days') as stale,
  (a.id is not null and a.reviewed_at is not null and a.profile_approved and coalesce(a.completeness, 0) >= 60
     and coalesce(jsonb_array_length(a.conflicts), 0) = 0
     and not exists (select 1 from public.vacancy_requirements q where q.vacancy_id = v.id and q.is_current and q.review = 'disputed')
     and coalesce(r.status::text, 'succeeded') <> 'failed'
     and v.discovery_state <> 'dismissed' and v.status in ('open','closing_soon','unverified')) as ready_for_stage3
from public.vacancies v
left join public.employers e on e.id = v.employer_id
left join public.assessments a on a.kind = 'vacancy' and a.vacancy_id = v.id and a.is_current
left join lateral (select rr.status, rr.error, rr.finished_at from public.research_runs rr where rr.kind = 'vacancy' and rr.vacancy_id = v.id order by rr.created_at desc limit 1) r on true
where v.deleted_at is null and v.duplicate_of_vacancy_id is null and (v.discovery_state = 'saved' or v.research_state <> 'none' or a.id is not null);

create view public.v_research_employers with (security_invoker = true) as
select
  e.id, coalesce(e.display_name, e.legal_name) as name, e.practice_type, e.discovery_state, e.research_state, e.stage3_saved_at, e.returned_to_discovery_at, e.last_checked_at,
  a.id as assessment_id, a.total, a.completeness, a.confidence, a.computed_at, a.reviewed_at, a.profile_approved,
  coalesce(jsonb_array_length(a.blockers), 0) as blocker_count,
  coalesce(jsonb_array_length(a.conflicts), 0) as conflict_count,
  (select count(*) from public.vacancies v where v.employer_id = e.id and v.deleted_at is null and v.duplicate_of_vacancy_id is null and v.status in ('open','closing_soon','unverified')) as open_vacancy_count,
  r.status as run_status, r.error as run_error, r.finished_at as run_finished_at,
  (a.id is null or a.computed_at < now() - interval '30 days' or coalesce(e.last_checked_at, e.first_discovered_at) < now() - interval '30 days') as stale,
  (a.id is not null and a.reviewed_at is not null and a.profile_approved and coalesce(a.completeness, 0) >= 60
     and coalesce(jsonb_array_length(a.conflicts), 0) = 0 and coalesce(r.status::text, 'succeeded') <> 'failed'
     and e.discovery_state <> 'dismissed') as ready_for_stage3
from public.employers e
left join public.assessments a on a.kind = 'employer' and a.employer_id = e.id and a.vacancy_id is null and a.is_current
left join lateral (select rr.status, rr.error, rr.finished_at from public.research_runs rr where rr.kind = 'employer' and rr.employer_id = e.id order by rr.created_at desc limit 1) r on true
where e.deleted_at is null and (e.discovery_state = 'saved' or e.research_state <> 'none' or a.id is not null);

create view public.v_research_counts with (security_invoker = true) as
select
  (select count(*) from public.v_research_vacancies) as vacancies_in_research,
  (select count(*) from public.v_research_vacancies where research_state in ('none','queued','running') ) as vacancies_awaiting,
  (select count(*) from public.v_research_vacancies where research_state = 'needs_review') as vacancies_needs_review,
  (select count(*) from public.v_research_vacancies where ready_for_stage3) as vacancies_ready,
  (select count(*) from public.v_research_vacancies where blocker_count > 0) as vacancies_with_blockers,
  (select count(*) from public.v_research_employers) as employers_in_research,
  (select count(*) from public.v_research_employers where ready_for_stage3) as employers_ready,
  (select count(*) from public.research_runs where status in ('failed','partial') and created_at > now() - interval '7 days') as recent_run_problems,
  (select profile_version from public.candidate_profile where id) as profile_version,
  (select approved_version is not distinct from profile_version from public.candidate_profile where id) as profile_approved;

grant select on public.v_research_vacancies, public.v_research_employers, public.v_research_counts to authenticated;
