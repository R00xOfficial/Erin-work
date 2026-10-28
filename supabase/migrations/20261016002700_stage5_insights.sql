-- Stage 5: learn and improve.
-- Analytics read the existing records (employers, vacancies, assessments, priority items, applications, interviews, activities) as the source of
-- truth. This migration only adds: a test-data flag so demonstration records can be excluded, metric definitions, saved report snapshots,
-- recommendations with their decision history, employer feedback vs. Erin's own reflections, profile suggestions, strategy changes, export history.

alter table public.employers add column if not exists is_test boolean not null default false;
alter table public.vacancies add column if not exists is_test boolean not null default false;
alter table public.applications add column if not exists is_test boolean not null default false;

-- Insight preferences (single row).
create table if not exists public.insight_preferences (
  id boolean primary key default true check (id),
  default_period_days integer not null default 30 check (default_period_days between 7 and 730),
  maturity_days integer not null default 21 check (maturity_days between 1 and 180),
  backlog_days integer not null default 14 check (backlog_days between 1 and 180),
  updated_at timestamptz not null default now()
);
insert into public.insight_preferences (id) values (true) on conflict do nothing;

-- Every metric, its numerator and its denominator, versioned. Reports record the version they were computed with.
create table if not exists public.metric_definitions (
  key text not null,
  version integer not null default 1,
  label text not null,
  numerator text not null,
  denominator text,
  exclusions text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

insert into public.metric_definitions (key, label, numerator, denominator, exclusions, notes) values
 ('discovery_to_research', 'Discovery-to-research rate', 'Eligible vacancies first seen in the period that have been researched (assessed or research requested and completed)', 'Eligible vacancies first seen in the period', 'Test records; duplicates of another vacancy; vacancies marked ineligible', 'Eligible means not ineligible and not a duplicate. Unreviewed vacancies stay in the denominator and are shown as pending.'),
 ('research_to_priority', 'Research-to-priority rate', 'Researched vacancies that are prioritised for action (priority status high or recommended, or promoted by you)', 'Researched vacancies first seen in the period', 'Test records; duplicates', 'Items on hold or in the backlog are not counted as prioritised, but are not failures either.'),
 ('application_submission', 'Application submission rate', 'Applications selected in the period that have a confirmed submission', 'Applications selected in the period', 'Test records; applications withdrawn before submission', 'Applications still being prepared are shown as in progress and are not failures.'),
 ('interview_rate', 'Interview rate', 'Eligible submitted applications with at least one interview or assessment', 'Confirmed submissions in the period that are resolved or at least the maturity window old', 'Test records; unconfirmed submissions; submissions newer than the maturity window with no response yet', 'Submissions too recent to judge are counted separately as too early to tell.'),
 ('offer_rate', 'Offer rate', 'Eligible submitted applications that resulted in an offer', 'Same denominator as the interview rate', 'Same as the interview rate', 'Offers declined or accepted both count as offers.'),
 ('response_rate', 'Response rate', 'Eligible submitted applications with any recorded reply from the employer (acknowledgements do not count)', 'Same denominator as the interview rate', 'Same as the interview rate', 'A reply is an interview, assessment, rejection, offer or other employer feedback.'),
 ('source_relevance', 'Source relevance', 'Vacancies from the source that are eligible and were not dismissed as not relevant', 'All distinct, non-duplicate vacancies from the source in the period', 'Test records; duplicates', 'Vacancies not yet reviewed count as pending, not irrelevant.')
on conflict do nothing;

-- Saved report snapshots (immutable). The same numbers can be recomputed from the records; the snapshot shows what Erin saw at the time.
create table if not exists public.insight_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily','weekly','monthly','custom')),
  period_start date not null,
  period_end date not null,
  is_partial boolean not null default false,
  definitions_version integer not null default 1,
  params jsonb not null default '{}',
  results jsonb not null,
  note text,
  created_at timestamptz not null default now()
);
create or replace function public.fn_insight_reports_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.results is distinct from old.results or new.period_start <> old.period_start or new.period_end <> old.period_end) then
    raise exception 'Saved reports cannot be changed; save a new one.';
  end if;
  if tg_op = 'DELETE' then raise exception 'Saved reports are kept for the audit trail.'; end if;
  return coalesce(new, old);
end $$;
create trigger trg_insight_reports_immutable before update or delete on public.insight_reports for each row execute function public.fn_insight_reports_immutable();

-- Recommendations. Each carries the observation, data, sample size, why it matters, proposed action and confidence. Nothing is applied automatically.
create table if not exists public.insight_recommendations (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  fingerprint text not null,
  area text not null check (area in ('discovery','sources','research','prioritisation','applications','interviews','follow_up','outreach','profile','scoring')),
  title text not null,
  observation text not null,
  evidence jsonb not null default '{}',
  sample_size integer not null default 0,
  why_it_matters text not null,
  proposed_action text not null,
  confidence text not null check (confidence in ('low','moderate','reasonable')),
  status text not null default 'proposed' check (status in ('proposed','accepted','dismissed','deferred','superseded')),
  status_note text,
  deferred_until date,
  decided_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  report_id uuid references public.insight_reports(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists insight_recommendations_open_uq on public.insight_recommendations (fingerprint) where status in ('proposed','deferred','accepted');
create trigger trg_set_updated_at before update on public.insight_recommendations for each row execute function public.fn_set_updated_at();

create table if not exists public.insight_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.insight_recommendations(id) on delete cascade,
  event text not null,
  note text,
  evidence jsonb,
  created_at timestamptz not null default now()
);

-- Feedback. Employer-provided feedback and Erin's own reflections are different sources and stay different. AI output never lands here.
create table if not exists public.application_feedback (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  interview_id uuid references public.interviews(id) on delete set null,
  source text not null check (source in ('employer','own')),
  kind text not null check (kind in ('rejection_reason','interview_feedback','missing_skill','portfolio_feedback','application_feedback','difficult_question','improvement_area','lesson','other')),
  body text not null,
  tags text[] not null default '{}',
  occurred_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists application_feedback_app_idx on public.application_feedback (application_id);
create trigger trg_set_updated_at before update on public.application_feedback for each row execute function public.fn_set_updated_at();

-- Suggested profile or strategy changes. Accepting records Erin's decision; she makes any change to her profile herself.
create table if not exists public.profile_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skill_or_experience','portfolio_project','job_categories','location_constraints','qualification_requirement','employer_range','scoring_model','other')),
  title text not null,
  detail text not null,
  evidence jsonb not null default '{}',
  fingerprint text not null,
  status text not null default 'proposed' check (status in ('proposed','accepted','dismissed','deferred','applied')),
  status_note text,
  decided_at timestamptz,
  applied_profile_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profile_suggestions_open_uq on public.profile_suggestions (fingerprint) where status in ('proposed','deferred','accepted');
create trigger trg_set_updated_at before update on public.profile_suggestions for each row execute function public.fn_set_updated_at();

-- A log of strategy changes Erin has made, so a later period can be read against what changed.
create table if not exists public.strategy_changes (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('discovery','sources','research','prioritisation','applications','interviews','follow_up','outreach','profile','scoring','other')),
  title text not null,
  description text,
  recommendation_id uuid references public.insight_recommendations(id) on delete set null,
  profile_suggestion_id uuid references public.profile_suggestions(id) on delete set null,
  changed_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.export_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  period_start date,
  period_end date,
  sections text[] not null default '{}',
  row_counts jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.insight_preferences enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.insight_reports enable row level security;
alter table public.insight_recommendations enable row level security;
alter table public.insight_recommendation_events enable row level security;
alter table public.application_feedback enable row level security;
alter table public.profile_suggestions enable row level security;
alter table public.strategy_changes enable row level security;
alter table public.export_history enable row level security;
create policy authenticated_all on public.insight_preferences for all to authenticated using (true) with check (true);
create policy authenticated_all on public.metric_definitions for all to authenticated using (true) with check (true);
create policy authenticated_all on public.insight_reports for all to authenticated using (true) with check (true);
create policy authenticated_all on public.insight_recommendations for all to authenticated using (true) with check (true);
create policy authenticated_all on public.insight_recommendation_events for all to authenticated using (true) with check (true);
create policy authenticated_all on public.application_feedback for all to authenticated using (true) with check (true);
create policy authenticated_all on public.profile_suggestions for all to authenticated using (true) with check (true);
create policy authenticated_all on public.strategy_changes for all to authenticated using (true) with check (true);
create policy authenticated_all on public.export_history for all to authenticated using (true) with check (true);
grant all on table public.insight_preferences, public.metric_definitions, public.insight_reports, public.insight_recommendations, public.insight_recommendation_events,
  public.application_feedback, public.profile_suggestions, public.strategy_changes, public.export_history to authenticated, service_role;
