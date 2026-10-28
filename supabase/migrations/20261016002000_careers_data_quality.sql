-- 20: data-quality checks for careers pages, and a larger daily page budget now that careers pages are read concurrently.
update public.source_definitions set config = config || '{"max_pages_per_run":60,"concurrency":4}'::jsonb where code = 'careers_pages';

create or replace view public.v_data_quality_issues with (security_invoker = true) as
select 'possible_duplicate_employer'::text as issue, a.id as entity_id, 'employer'::text as entity_type,
       format('%s ~ %s (similarity %s)', a.legal_name, b.legal_name, round(extensions.similarity(a.normalised_name, b.normalised_name)::numeric, 2)) as detail,
       b.id as related_id
from public.employers a join public.employers b on a.id < b.id
where a.deleted_at is null and b.deleted_at is null and extensions.similarity(a.normalised_name, b.normalised_name) >= 0.85
union all
select 'office_not_geocoded', o.id, 'office', format('%s — %s %s', coalesce(e.display_name, e.legal_name), coalesce(o.town,'?'), coalesce(o.postcode,'(no postcode)')), o.employer_id
from public.offices o join public.employers e on e.id = o.employer_id where o.deleted_at is null and (o.lat is null or o.postcode is null)
union all
select 'office_missing_travel_time', o.id, 'office', format('%s — %s', coalesce(e.display_name, e.legal_name), coalesce(o.town,'?')), o.employer_id
from public.offices o join public.employers e on e.id = o.employer_id
where o.deleted_at is null and o.lat is not null and not exists (select 1 from public.travel_times t where t.office_id = o.id and t.mode = 'public_transport')
union all
select 'employer_missing_website', e.id, 'employer', e.legal_name, null from public.employers e where e.deleted_at is null and e.website is null
union all
select 'employer_stale', e.id, 'employer', format('%s — review due %s', e.legal_name, to_char(e.next_review_at, 'YYYY-MM-DD')), null
from public.employers e where e.deleted_at is null and e.next_review_at < now() and e.outreach_stage not in ('closed_no_opportunity','suppressed')
union all
select 'vacancy_past_closing', v.id, 'vacancy', v.title, v.employer_id from public.vacancies v where v.deleted_at is null and v.status in ('open','closing_soon','unverified') and v.closing_at < now()
union all
select 'vacancy_unmatched_employer', v.id, 'vacancy', format('%s (%s)', v.title, coalesce(v.employer_name_raw, 'no employer name')), null
from public.vacancies v where v.deleted_at is null and v.employer_match_status in ('pending','unmatched') and v.status not in ('closed','filled','withdrawn')
union all
select 'contact_bounced', c.id, 'contact', format('%s <%s>', c.full_name, c.email), c.employer_id from public.contacts c where c.deleted_at is null and c.email_verification = 'bounced'
union all
select 'claims_conflicting', cl.entity_id, cl.entity_type::text, format('%s: conflicting sources', cl.field_name), null
from public.claims cl where cl.evidence_status = 'conflicting_sources' and cl.is_current
union all
select 'source_fetch_error', s.id, 'source', format('%s (%s)', s.url, coalesce(s.fetch_error, s.fetch_status::text)), null
from public.sources s where s.fetch_status in ('error','forbidden','gone') and coalesce(s.source_kind, '') <> 'careers_page'
union all
select 'careers_page_unreachable', e.id, 'employer', format('%s — %s (%s)', coalesce(e.display_name, e.legal_name), s.url, coalesce(s.fetch_error, s.fetch_status::text)), null
from public.sources s join public.employers e on e.id = s.entity_id and e.deleted_at is null
where s.source_kind = 'careers_page' and s.fetch_status in ('error','forbidden','gone')
union all
select 'careers_page_unreadable', e.id, 'employer', format('%s — %s (%s)', coalesce(e.display_name, e.legal_name), s.url, s.fetch_error), null
from public.sources s join public.employers e on e.id = s.entity_id and e.deleted_at is null
where s.source_kind = 'careers_page' and s.fetch_error like 'no readable text%'
union all
select 'careers_url_not_a_careers_page', e.id, 'employer', format('%s — %s', coalesce(e.display_name, e.legal_name), e.careers_url), null
from public.employers e
where e.deleted_at is null and e.careers_url is not null
  and e.careers_url !~* '(career|job|vacanc|join|recruit|work-?(with|for)|opportunit|working|employment|graduate|early|apprentic|personio|workable|pinpoint|teamtailor|bamboohr|recruitee)'
union all
select 'careers_page_not_found', e.id, 'employer', coalesce(e.display_name, e.legal_name), null
from public.employers e
where e.deleted_at is null and e.careers_url is null and e.website is not null and e.careers_search_at is not null;
