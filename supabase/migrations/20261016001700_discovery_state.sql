-- 17: Stage 1 discovery state. Erin's triage decision (new / saved / dismissed) is kept apart from
-- the real-world status of a vacancy (open / closed / ...), so dismissing never rewrites history.

create type public.discovery_state as enum ('new','saved','dismissed');

alter table public.vacancies
  add column discovery_state public.discovery_state not null default 'new',
  add column saved_at timestamptz,
  add column dismissed_at timestamptz,
  add column dismissed_reason text,
  add column is_adjacent boolean not null default false;

alter table public.employers
  add column discovery_state public.discovery_state not null default 'new',
  add column reviewed_at timestamptz,
  add column saved_at timestamptz,
  add column dismissed_at timestamptz,
  add column dismissed_reason text;

create index vacancies_discovery_idx on public.vacancies (discovery_state, first_seen_at desc) where deleted_at is null and duplicate_of_vacancy_id is null;
create index employers_discovery_idx on public.employers (discovery_state, first_discovered_at desc) where deleted_at is null;

-- Dismissed vacancies leave the dashboard's new-vacancies queue (the row and its history stay).
create or replace view public.v_queue_new_vacancies with (security_invoker = true) as
select v.id, v.title, v.employer_id, coalesce(e.display_name, e.legal_name, v.employer_name_raw) as employer_name, v.status, v.eligibility_status, v.hard_flags,
       v.role_family, v.location_text, v.zone_code, v.first_seen_at, v.closing_at, v.discovery_source, v.canonical_url, v.original_url
from public.vacancies v left join public.employers e on e.id = v.employer_id
where v.deleted_at is null and v.reviewed_at is null and v.discovery_state <> 'dismissed'
  and v.status not in ('closed','filled','withdrawn') and v.duplicate_of_vacancy_id is null
order by v.first_seen_at desc;

-- One row per logical vacancy (duplicates folded into their canonical record) with the fields the
-- Discovery page filters on. source_count = the canonical listing plus every duplicate linked to it.
create view public.v_discovery_vacancies with (security_invoker = true) as
select
  v.id, v.title, v.employer_id, v.employer_name_raw, v.employer_match_status,
  coalesce(e.display_name, e.legal_name, v.employer_name_raw) as employer_name,
  e.specialisms as employer_specialisms, e.practice_type as employer_practice_type,
  v.role_family, v.seniority, v.employment_type, v.status, v.eligibility_status, v.hard_flags,
  v.discovery_state, v.is_adjacent, v.reviewed_at, v.saved_at, v.dismissed_at, v.dismissed_reason,
  v.location_text, v.zone_code, v.discovery_source, v.original_url, v.canonical_url, v.application_url,
  v.first_seen_at, v.last_verified_at, v.last_checked_at, v.disappeared_at, v.closing_at,
  v.salary_min, v.salary_max, v.salary_period, v.salary_text,
  case v.salary_period when 'month' then v.salary_min * 12 when 'week' then v.salary_min * 52 when 'day' then v.salary_min * 220
                       when 'hour' then v.salary_min * 1600 else v.salary_min end as salary_year_min,
  (v.status in ('open','closing_soon','unverified') and coalesce(v.last_verified_at, v.first_seen_at) < now() - interval '30 days') as is_stale,
  1 + (select count(*) from public.vacancies d where d.duplicate_of_vacancy_id = v.id and d.deleted_at is null) as source_count,
  coalesce(
    (select min(t.minutes) from public.travel_times t where t.office_id = v.office_id and t.mode = 'public_transport'),
    (select min(t.minutes) from public.travel_times t join public.offices o on o.id = t.office_id
       where o.employer_id = v.employer_id and o.deleted_at is null and t.mode = 'public_transport')
  ) as pt_minutes,
  v.search_vector
from public.vacancies v
left join public.employers e on e.id = v.employer_id
where v.deleted_at is null and v.duplicate_of_vacancy_id is null;

-- One row per employer with its primary office and open-vacancy count. A row with open_vacancy_count = 0
-- is a speculative target.
create view public.v_discovery_employers with (security_invoker = true) as
select
  e.id, coalesce(e.display_name, e.legal_name) as name, e.practice_type, e.specialisms, e.size_band,
  e.website, e.website_domain, e.careers_url, e.hires_part1, e.accepts_speculative,
  e.outreach_stage, e.latest_score, e.latest_band, e.data_quality, e.confidence_score,
  e.discovery_state, e.reviewed_at, e.saved_at, e.dismissed_at, e.dismissed_reason,
  e.first_discovered_at, e.last_checked_at,
  po.town, po.zone_code,
  (select min(t.minutes) from public.travel_times t join public.offices o on o.id = t.office_id
     where o.employer_id = e.id and o.deleted_at is null and t.mode = 'public_transport') as pt_minutes,
  (select count(*) from public.vacancies v where v.employer_id = e.id and v.deleted_at is null and v.duplicate_of_vacancy_id is null
     and v.status in ('open','closing_soon','unverified')) as open_vacancy_count,
  e.search_vector
from public.employers e
left join lateral (
  select o.town, o.zone_code from public.offices o
  where o.employer_id = e.id and o.deleted_at is null order by o.is_primary desc, o.created_at limit 1
) po on true
where e.deleted_at is null;

-- Summary tiles for the Discovery page: real counts, nothing derived client-side.
create view public.v_discovery_counts with (security_invoker = true) as
select
  (select count(*) from public.vacancies where deleted_at is null and duplicate_of_vacancy_id is null and discovery_state = 'new'
     and status in ('open','closing_soon','unverified') and first_seen_at >= now() - interval '7 days') as new_vacancies_7d,
  (select count(*) from public.vacancies where deleted_at is null and duplicate_of_vacancy_id is null and discovery_state <> 'dismissed'
     and reviewed_at is null and status in ('open','closing_soon','unverified')) as vacancies_to_review,
  (select count(*) from public.vacancies where deleted_at is null and duplicate_of_vacancy_id is null and discovery_state = 'saved') as vacancies_saved,
  (select count(*) from public.vacancies where deleted_at is null and duplicate_of_vacancy_id is null and status in ('open','closing_soon','unverified')
     and coalesce(last_verified_at, first_seen_at) < now() - interval '30 days') as vacancies_stale,
  (select count(*) from public.employers where deleted_at is null and discovery_state = 'new' and first_discovered_at >= now() - interval '7 days') as new_employers_7d,
  (select count(*) from public.employers where deleted_at is null and discovery_state <> 'dismissed' and reviewed_at is null) as employers_to_review,
  (select count(*) from public.employers where deleted_at is null and discovery_state = 'saved') as employers_saved,
  (select count(*) from public.employers where deleted_at is null and discovery_state <> 'dismissed') as employers_active,
  (select count(*) from public.vacancies where deleted_at is null and duplicate_of_vacancy_id is null and discovery_state = 'dismissed')
    + (select count(*) from public.employers where deleted_at is null and discovery_state = 'dismissed') as dismissed_total;

grant select on public.v_discovery_vacancies, public.v_discovery_employers, public.v_discovery_counts to authenticated;
