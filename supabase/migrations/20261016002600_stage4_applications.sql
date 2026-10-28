-- 26: Stage 4 (Apply and Follow Up).
-- Drafting and submitting are separate states. A submission only counts once Erin has confirmed it, and a confirmed submission freezes the
-- documents and wording that were sent. Nothing in this stage sends anything by itself.

alter table public.applications
  add column priority_item_id uuid references public.priority_items (id) on delete set null,
  add column selected_at timestamptz,
  add column selection_reason text,
  add column priority_snapshot jsonb,
  add column research_snapshot jsonb,
  add column contact_id uuid references public.contacts (id) on delete set null,
  add column office_id uuid references public.offices (id) on delete set null,
  add column contact_source text,
  add column recipient text,
  add column submission_instructions text,
  add column response_timeframe_text text,
  add column response_expected_by date,
  add column submission_confirmed_at timestamptz,
  add column submission_confirmed_by text check (submission_confirmed_by in ('user','integration')),
  add column submission_evidence text,
  add column submitted_snapshot jsonb,
  add column repeat_reason text,
  add column outcome_at timestamptz,
  add column portfolio_projects text[] not null default '{}';

update public.pipeline_stage_meta set label = 'Ready for review' where pipeline = 'application' and stage = 'ready_to_submit';
insert into public.pipeline_stage_meta (pipeline, stage, sort_order, label, is_terminal, sla_days, colour) values
('application','selected',25,'Selected for application',false,2,'slate'),
('application','awaiting_response',55,'Awaiting response',false,14,'violet'),
('application','assessment',95,'Assessment',false,7,'emerald'),
('application','offer_declined',115,'Offer declined',true,null,'zinc'),
('application','vacancy_closed',135,'Vacancy closed, outcome unknown',true,null,'zinc')
on conflict do nothing;

-- Stage rules: no submission-type stage without a confirmed submission; closing stamps the outcome date; a confirmed submission is frozen.
create or replace function public.fn_applications_before_write()
returns trigger language plpgsql set search_path = public, extensions as $$
declare
  post_submission constant text[] := array['submitted','awaiting_response','acknowledged','shortlisted','interview_1','further_interview','assessment','offer_received','offer_accepted','offer_declined'];
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'acknowledged' and new.acknowledged_at is null then new.acknowledged_at := now(); end if;
    if new.stage in ('offer_accepted','offer_declined','rejected','withdrawn','vacancy_closed','closed_without_response') then
      if new.closed_at is null then new.closed_at := now(); end if;
      if new.outcome_at is null then new.outcome_at := now(); end if;
    end if;
  end if;
  if new.stage::text = any (post_submission) and new.submission_confirmed_at is null then
    raise exception 'An application cannot be % until the submission has been confirmed (date, method, recipient and your confirmation).', new.stage;
  end if;
  if tg_op = 'UPDATE' and old.submission_confirmed_at is not null and coalesce(current_setting('ajis.correcting', true), '') <> 'on' then
    if new.cv_document_id is distinct from old.cv_document_id or new.portfolio_document_id is distinct from old.portfolio_document_id
       or new.cover_letter_document_id is distinct from old.cover_letter_document_id or new.documents_snapshot is distinct from old.documents_snapshot
       or new.submitted_snapshot is distinct from old.submitted_snapshot or new.submission_confirmed_at is distinct from old.submission_confirmed_at
       or new.submission_confirmed_by is distinct from old.submission_confirmed_by or new.submitted_at is distinct from old.submitted_at
       or new.submitted_via is distinct from old.submitted_via or new.submitted_to is distinct from old.submitted_to then
      raise exception 'A confirmed submission is a historical record and cannot be edited. Use "Correct the submission record" to retract it with a reason.';
    end if;
  end if;
  return new;
end $$;

-- The deliberate, logged way to undo a mistaken confirmation. It does not delete anything: the previous snapshot is written to the timeline.
create function public.fn_retract_submission(p_application_id uuid, p_reason text) returns void language plpgsql set search_path = public, extensions as $$
declare a public.applications%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to correct a submission record.'; end if;
  select * into a from public.applications where id = p_application_id and deleted_at is null;
  if not found then raise exception 'Application not found'; end if;
  if a.submission_confirmed_at is null then raise exception 'This application has no confirmed submission.'; end if;
  perform set_config('ajis.correcting', 'on', true);
  insert into public.activities (employer_id, application_id, vacancy_id, activity_type, direction, channel, subject, body_text, notes, origin, confirmation)
    values (a.employer_id, a.id, a.vacancy_id, 'note', 'internal', 'system', 'Submission record retracted', p_reason, a.submitted_snapshot::text, 'manual', 'user');
  update public.applications set submission_confirmed_at = null, submission_confirmed_by = null, submission_evidence = null, submitted_snapshot = null, submitted_at = null,
         submitted_via = null, submitted_to = null, confirmation_ref = null, stage = 'ready_to_submit' where id = p_application_id;
end $$;
grant execute on function public.fn_retract_submission(uuid, text) to authenticated, service_role;
revoke execute on function public.fn_retract_submission(uuid, text) from anon, public;

-- Interviews and assessments share one table; `round` numbers the steps of the process in order.
alter table public.interviews
  add column kind text not null default 'interview' check (kind in ('interview','assessment')),
  add column title text,
  add column contact_details text,
  add column instructions text,
  add column deadline_at timestamptz,
  add column questions_to_ask text,
  add column notes text,
  add column thank_you_sent_at timestamptz;

-- Timeline provenance: an event is "synced" only when a connected service produced it; everything else is what Erin logged.
alter table public.activities
  add column origin text not null default 'manual' check (origin in ('manual','synced','system')),
  add column confirmation text not null default 'user' check (confirmation in ('user','integration'));
create function public.fn_activities_origin() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if new.provider_message_id is not null then new.origin := 'synced'; new.confirmation := 'integration'; end if;
  return new;
end $$;
create trigger trg_activities_origin before insert or update on public.activities for each row execute function public.fn_activities_origin();

create table public.application_checklist_items (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  interview_id uuid references public.interviews (id) on delete cascade,
  kind text not null default 'custom',
  label text not null,
  done boolean not null default false,
  done_at timestamptz,
  required boolean not null default true,
  sort int not null default 100,
  notes text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index application_checklist_app_idx on public.application_checklist_items (application_id, sort);
create trigger trg_set_updated_at before update on public.application_checklist_items for each row execute function public.fn_set_updated_at();

create table public.application_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications (id) on delete cascade,
  employer_id uuid references public.employers (id) on delete cascade,
  kind text not null check (kind in ('cover_letter','speculative_email','recruiter_intro','answer','interview_prep','follow_up','thank_you')),
  title text,
  subject text,
  body text not null default '',
  question text,
  status text not null default 'draft' check (status in ('draft','final','discarded')),
  source text not null default 'ai' check (source in ('ai','manual')),
  facts jsonb not null default '[]',
  paragraphs jsonb not null default '[]',
  flags jsonb not null default '[]',
  flags_acknowledged_at timestamptz,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  activity_id uuid references public.activities (id) on delete set null,
  generation_state text not null default 'ready' check (generation_state in ('queued','ready','failed')),
  generation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalised_at timestamptz,
  check (application_id is not null or employer_id is not null)
);
create index application_drafts_app_idx on public.application_drafts (application_id, created_at desc);
create trigger trg_set_updated_at before update on public.application_drafts for each row execute function public.fn_set_updated_at();

create table public.application_followups (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  interview_id uuid references public.interviews (id) on delete cascade,
  kind text not null check (kind in ('awaiting_response','thank_you','info_requested','offer_decision','custom')),
  title text not null,
  due_at timestamptz not null,
  basis text not null check (basis in ('employer_stated','user_set','rule_suggestion')),
  basis_note text,
  status text not null default 'open' check (status in ('open','snoozed','done','dismissed')),
  snoozed_until timestamptz,
  attempt int not null default 1,
  completed_at timestamptz,
  dismissed_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index application_followups_dedupe_uq on public.application_followups (dedupe_key) where dedupe_key is not null and status in ('open','snoozed');
create index application_followups_due_idx on public.application_followups (due_at) where status in ('open','snoozed');
create trigger trg_set_updated_at before update on public.application_followups for each row execute function public.fn_set_updated_at();

-- Erin's approved, reusable wording (availability, right to work, standard answers). Drafts may only draw on approved snippets.
create table public.reusable_snippets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null default 'other' check (kind in ('answer','bio','availability','right_to_work','salary','other')),
  body text not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_set_updated_at before update on public.reusable_snippets for each row execute function public.fn_set_updated_at();

alter table public.planner_preferences
  add column application_follow_up_days int not null default 14 check (application_follow_up_days between 1 and 90),
  add column max_follow_ups int not null default 2 check (max_follow_ups between 0 and 10),
  add column thank_you_hours int not null default 24 check (thank_you_hours between 1 and 168),
  add column prepared_not_submitted_days int not null default 3 check (prepared_not_submitted_days between 1 and 30),
  add column interview_remind_hours int not null default 24 check (interview_remind_hours between 1 and 168);

alter table public.notifications
  add column application_id uuid references public.applications (id) on delete cascade,
  add column followup_id uuid references public.application_followups (id) on delete cascade,
  add column snoozed_until timestamptz;

alter table public.application_checklist_items enable row level security;
alter table public.application_drafts enable row level security;
alter table public.application_followups enable row level security;
alter table public.reusable_snippets enable row level security;
create policy authenticated_all on public.application_checklist_items for all to authenticated using (true) with check (true);
create policy authenticated_all on public.application_drafts for all to authenticated using (true) with check (true);
create policy authenticated_all on public.application_followups for all to authenticated using (true) with check (true);
create policy authenticated_all on public.reusable_snippets for all to authenticated using (true) with check (true);
grant all on table public.application_checklist_items, public.application_drafts, public.application_followups, public.reusable_snippets to authenticated, service_role;
revoke all on table public.application_checklist_items, public.application_drafts, public.application_followups, public.reusable_snippets from anon;

-- Pipeline: one row per application with what a person needs to see at a glance.
create view public.v_application_pipeline with (security_invoker = true) as
select
  a.id, a.stage, a.application_type, a.employer_id, coalesce(e.display_name, e.legal_name) as employer_name, a.vacancy_id, v.title as vacancy_title, v.location_text, v.status as vacancy_status,
  a.deadline_at, a.submitted_at, a.submission_confirmed_at, a.response_expected_by, a.selected_at, a.stage_changed_at, a.created_at, a.updated_at, a.next_action, a.next_action_due,
  a.priority_snapshot ->> 'status' as priority_status, (a.priority_snapshot ->> 'score')::numeric as priority_score,
  case when a.stage in ('vacancy_discovered','eligibility_checked','selected','preparing') then 'preparing'
       when a.stage = 'ready_to_submit' then 'ready'
       when a.stage = 'submitted' then 'submitted'
       when a.stage in ('awaiting_response','acknowledged','shortlisted') then 'awaiting'
       when a.stage in ('interview_1','further_interview','assessment') then 'interviews'
       when a.stage = 'offer_received' then 'offers'
       else 'closed' end as pipeline_column,
  (select count(*) from public.application_checklist_items c where c.application_id = a.id and c.required and c.interview_id is null) as checklist_total,
  (select count(*) from public.application_checklist_items c where c.application_id = a.id and c.required and c.done and c.interview_id is null) as checklist_done,
  (select min(i.scheduled_at) from public.interviews i where i.application_id = a.id and i.scheduled_at > now() and i.outcome = 'pending') as next_interview_at,
  (select min(f.due_at) from public.application_followups f where f.application_id = a.id and f.status in ('open','snoozed')) as next_followup_at,
  (select max(x.occurred_at) from public.activities x where x.application_id = a.id) as last_activity_at,
  (v.status in ('closed','filled','withdrawn')) as listing_closed
from public.applications a
join public.employers e on e.id = a.employer_id
left join public.vacancies v on v.id = a.vacancy_id
where a.deleted_at is null;
grant select on public.v_application_pipeline to authenticated;
