-- 13: dashboard and queue views (security_invoker so RLS applies to the caller).

create view public.v_dashboard_counts with (security_invoker = true) as
select
  (select count(*) from public.employers where deleted_at is null) as employers_total,
  (select count(*) from public.employers where deleted_at is null and data_quality in ('good','verified')) as employers_verified,
  (select count(*) from public.employers where deleted_at is null and outreach_stage in ('discovered','awaiting_research','research_in_progress')) as employers_unresearched,
  (select count(*) from public.employers where deleted_at is null and outreach_stage in ('ready_to_contact','contact_approved')) as employers_ready_to_contact,
  (select count(*) from public.vacancies where deleted_at is null and status in ('open','closing_soon') and eligibility_status = 'eligible') as open_eligible_vacancies,
  (select count(*) from public.vacancies where deleted_at is null and status in ('open','closing_soon','unverified')) as open_vacancies_all,
  (select count(*) from public.vacancies where deleted_at is null and reviewed_at is null and status not in ('closed','filled','withdrawn')) as vacancies_unreviewed,
  (select count(*) from public.applications where deleted_at is null and stage in ('submitted','acknowledged','shortlisted','interview_1','further_interview','offer_received')) as applications_in_progress,
  (select count(*) from public.applications where deleted_at is null and stage in ('vacancy_discovered','eligibility_checked','preparing','ready_to_submit')) as applications_preparing,
  (select count(*) from public.tasks where status in ('open','in_progress') and (due_at is null or due_at <= (date_trunc('day', now()) + interval '1 day'))) as tasks_due,
  (select count(*) from public.activities where follow_up_due_at <= now() and follow_up_done = false and reply_received = false) as follow_ups_due,
  (select count(*) from public.activities where approval_status = 'pending_approval') as approvals_pending,
  (select count(*) from public.interviews where scheduled_at between now() and now() + interval '7 days' and outcome = 'pending') as interviews_this_week,
  (select coalesce((value)::boolean, true) from public.settings where key = 'stop_switch') as stop_switch,
  (select coalesce((value)::boolean, true) from public.settings where key = 'dry_run') as dry_run;

create view public.v_today_actions with (security_invoker = true) as
select 'task'::text as kind, t.id as entity_id, t.employer_id, t.title, t.task_type::text as subtype, t.due_at, t.priority::text as priority
from public.tasks t where t.status in ('open','in_progress') and (t.due_at is null or t.due_at <= date_trunc('day', now()) + interval '1 day')
union all
select 'application', a.id, a.employer_id, coalesce(a.next_action, 'Application next action'), a.stage::text, a.next_action_due, 'normal'
from public.applications a where a.deleted_at is null and a.next_action_due <= date_trunc('day', now()) + interval '1 day' and a.stage not in ('offer_accepted','rejected','withdrawn','closed_without_response')
union all
select 'deadline', a.id, a.employer_id, 'Application deadline', a.stage::text, a.deadline_at, 'high'
from public.applications a where a.deleted_at is null and a.deadline_at between now() and now() + interval '3 days' and a.stage in ('vacancy_discovered','eligibility_checked','preparing','ready_to_submit')
union all
select 'interview', i.id, ap.employer_id, 'Interview round ' || i.round, i.format::text, i.scheduled_at, 'high'
from public.interviews i join public.applications ap on ap.id = i.application_id
where i.outcome = 'pending' and i.scheduled_at between now() - interval '1 hour' and now() + interval '7 days'
union all
select 'follow_up', ac.id, ac.employer_id, coalesce('Follow up: ' || ac.subject, 'Follow up'), ac.activity_type::text, ac.follow_up_due_at, 'normal'
from public.activities ac where ac.follow_up_due_at <= now() and ac.follow_up_done = false and ac.reply_received = false
union all
select 'approval', ac.id, ac.employer_id, coalesce('Approve: ' || ac.subject, 'Approve outreach'), ac.activity_type::text, ac.created_at, 'high'
from public.activities ac where ac.approval_status = 'pending_approval';

create view public.v_queue_research with (security_invoker = true) as
select e.id, e.legal_name, e.display_name, e.practice_type, e.outreach_stage, e.data_quality, e.confidence_score, e.latest_score, e.latest_band,
       e.first_discovered_at, e.last_checked_at, e.next_review_at,
       (select o.town from public.offices o where o.employer_id = e.id and o.deleted_at is null order by o.is_primary desc, o.created_at limit 1) as town,
       (select o.zone_code from public.offices o where o.employer_id = e.id and o.deleted_at is null order by o.is_primary desc, o.created_at limit 1) as zone_code
from public.employers e
where e.deleted_at is null and e.outreach_stage in ('discovered','awaiting_research','research_in_progress')
order by e.latest_score desc nulls last, e.first_discovered_at;

create view public.v_queue_new_vacancies with (security_invoker = true) as
select v.id, v.title, v.employer_id, coalesce(e.display_name, e.legal_name, v.employer_name_raw) as employer_name, v.status, v.eligibility_status, v.hard_flags,
       v.role_family, v.location_text, v.zone_code, v.first_seen_at, v.closing_at, v.discovery_source, v.canonical_url, v.original_url
from public.vacancies v left join public.employers e on e.id = v.employer_id
where v.deleted_at is null and v.reviewed_at is null and v.status not in ('closed','filled','withdrawn') and v.duplicate_of_vacancy_id is null
order by v.first_seen_at desc;

create view public.v_queue_outreach_approval with (security_invoker = true) as
select a.id, a.employer_id, coalesce(e.display_name, e.legal_name) as employer_name, a.contact_id, c.full_name as contact_name, a.recipient_email,
       a.subject, a.template_code, a.template_version, a.created_at, a.attachments, a.vacancy_id, a.application_id
from public.activities a
join public.employers e on e.id = a.employer_id
left join public.contacts c on c.id = a.contact_id
where a.approval_status = 'pending_approval' and a.delivery_result in ('drafted','pending')
order by a.created_at;

create view public.v_queue_follow_up with (security_invoker = true) as
select a.id, a.employer_id, coalesce(e.display_name, e.legal_name) as employer_name, a.contact_id, c.full_name as contact_name, a.subject, a.sent_at,
       a.follow_up_due_at, a.provider_thread_id, e.outreach_stage
from public.activities a
join public.employers e on e.id = a.employer_id
left join public.contacts c on c.id = a.contact_id
where a.follow_up_due_at <= now() and a.follow_up_done = false and a.reply_received = false and a.direction = 'outbound'
order by a.follow_up_due_at;

create view public.v_data_quality_issues with (security_invoker = true) as
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
from public.sources s where s.fetch_status in ('error','forbidden','gone');
