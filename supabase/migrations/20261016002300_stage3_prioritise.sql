-- 23: Stage 3 (Prioritise).
-- Erin's decision about an opportunity (priority status) is kept apart from vacancy availability, research completeness and
-- application progress. The system recommends; manual decisions are stored separately and are never overwritten by a recalculation.

create type public.priority_status as enum ('high','recommended','backlog','on_hold','dismissed');
create type public.plan_action_status as enum ('suggested','accepted','done','dismissed');
create type public.plan_action_kind as enum ('research','verify','resolve_blocker','review_job','prepare_application','prepare_outreach','follow_up','reconsider','decide','custom');
create type public.notification_kind as enum ('deadline_approaching','task_due','action_planned','overdue_preparation','decision_needed','status_changed','reconsider','digest');

-- Editable, versioned prioritisation models (vacancies and employers are scored differently).
create table public.prioritisation_models (
  version serial primary key,
  kind public.assessment_kind not null,
  weights jsonb not null,
  config jsonb not null default '{}',
  is_active boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create unique index prioritisation_models_active_uq on public.prioritisation_models (kind) where is_active;
insert into public.prioritisation_models (kind, weights, config, is_active, notes) values
('vacancy', '{"suitability":40,"deadline":20,"career_value":15,"feasibility":15,"evidence":10}',
 '{"high_score":70,"recommended_score":50,"high_deadline_days":7,"min_assessed_weight":40,"min_completeness_for_high":60,"gate_low":40,"gate_high":70}', true,
 'Starting weights from the Stage 3 brief. Priority complements, and never replaces, the Stage 2 suitability score.'),
('employer', '{"suitability":40,"receptiveness":20,"career_value":15,"feasibility":15,"evidence":10}',
 '{"high_score":70,"recommended_score":50,"min_assessed_weight":40,"min_completeness_for_high":60}', true,
 'Speculative-employer model. Receptiveness separates confirmed recruitment activity from a reasonable hypothesis.');

-- Erin's capacity and reminder preferences (singleton).
create table public.planner_preferences (
  id boolean primary key default true check (id),
  hours_per_day numeric(3,1) not null default 2.0 check (hours_per_day between 0 and 16),
  working_days smallint[] not null default '{1,2,3,4,5}',
  max_applications_per_week int not null default 3 check (max_applications_per_week >= 0),
  max_outreach_per_week int not null default 5 check (max_outreach_per_week >= 0),
  max_research_per_week int not null default 6 check (max_research_per_week >= 0),
  recontact_cooldown_days int not null default 60 check (recontact_cooldown_days >= 0),
  reminder_deadline_days int[] not null default '{7,3,1}',
  remind_tasks_due boolean not null default true,
  remind_overdue boolean not null default true,
  remind_decisions boolean not null default true,
  remind_status_changes boolean not null default true,
  remind_reconsider boolean not null default true,
  remind_outreach boolean not null default true,
  digest_frequency text not null default 'daily' check (digest_frequency in ('daily','weekly','off')),
  digest_hour smallint not null default 8 check (digest_hour between 0 and 23),
  updated_at timestamptz not null default now()
);
insert into public.planner_preferences (id) values (true) on conflict do nothing;
create trigger trg_set_updated_at before update on public.planner_preferences for each row execute function public.fn_set_updated_at();

-- One row per prioritised opportunity. recommended_* is the system's view; manual_* is Erin's decision and always wins.
create table public.priority_items (
  id uuid primary key default gen_random_uuid(),
  kind public.assessment_kind not null,
  employer_id uuid references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  recommended_status public.priority_status not null,
  score numeric(5,2),
  components jsonb not null default '{}',
  warnings jsonb not null default '[]',
  rationale text[] not null default '{}',
  live boolean not null default true,
  model_version int not null references public.prioritisation_models (version),
  suitability_assessment_id uuid references public.assessments (id) on delete set null,
  suitability_total numeric(5,2),
  deadline_at timestamptz,
  deadline_source text,
  effort jsonb,
  inputs_hash text not null,
  computed_at timestamptz not null default now(),
  needs_review_reason text,
  needs_review_since timestamptz,
  manual_status public.priority_status,
  manual_reason text,
  manual_at timestamptz,
  hold_until date,
  hold_condition text,
  dismissed_reason text,
  override_score numeric(5,2) check (override_score between 0 and 100),
  override_reason text,
  pinned boolean not null default false,
  pinned_at timestamptz,
  favourite boolean not null default false,
  recommendation_response text check (recommendation_response in ('accepted','rejected')),
  recommendation_response_reason text,
  recommendation_response_at timestamptz,
  responded_to_status public.priority_status,
  status public.priority_status generated always as (coalesce(manual_status, recommended_status)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'vacancy' or vacancy_id is not null),
  check (employer_id is not null or vacancy_id is not null)
);
create unique index priority_items_uq on public.priority_items (kind, coalesce(vacancy_id, employer_id));
create index priority_items_status_idx on public.priority_items (status, pinned desc, score desc nulls last);
create index priority_items_deadline_idx on public.priority_items (deadline_at) where deadline_at is not null;
create trigger trg_set_updated_at before update on public.priority_items for each row execute function public.fn_set_updated_at();

-- Every decision and every material change, with the reason. Append-only.
create table public.priority_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.priority_items (id) on delete cascade,
  event text not null,
  actor text not null default 'system' check (actor in ('system','user')),
  from_status public.priority_status,
  to_status public.priority_status,
  score_before numeric(5,2),
  score_after numeric(5,2),
  reason text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index priority_events_item_idx on public.priority_events (item_id, created_at desc);
create index priority_events_recent_idx on public.priority_events (created_at desc);

-- Suggested and planned actions. Dates here are either Erin's chosen day (planned_for) or a real stored deadline (due_at).
create table public.plan_actions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.priority_items (id) on delete cascade,
  employer_id uuid references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete cascade,
  kind public.plan_action_kind not null,
  title text not null,
  reason text,
  estimated_minutes int check (estimated_minutes is null or estimated_minutes >= 0),
  effort_basis text,
  planned_for date,
  due_at timestamptz,
  status public.plan_action_status not null default 'suggested',
  source text not null default 'suggested' check (source in ('suggested','manual')),
  user_edited boolean not null default false,
  dedupe_key text,
  warning text,
  accepted_at timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  dismissed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plan_actions_dedupe_uq on public.plan_actions (dedupe_key) where dedupe_key is not null and status in ('suggested','accepted');
create index plan_actions_day_idx on public.plan_actions (planned_for) where status in ('suggested','accepted');
create trigger trg_set_updated_at before update on public.plan_actions for each row execute function public.fn_set_updated_at();

-- In-app reminders. due_at is the stored date the reminder is about; nothing is created for a date that is not stored.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind public.notification_kind not null,
  urgency text not null default 'routine' check (urgency in ('urgent','routine')),
  title text not null,
  body text,
  item_id uuid references public.priority_items (id) on delete cascade,
  action_id uuid references public.plan_actions (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  due_at timestamptz,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz
);
create index notifications_open_idx on public.notifications (created_at desc) where dismissed_at is null;

alter table public.prioritisation_models enable row level security;
alter table public.planner_preferences enable row level security;
alter table public.priority_items enable row level security;
alter table public.priority_events enable row level security;
alter table public.plan_actions enable row level security;
alter table public.notifications enable row level security;
create policy authenticated_all on public.prioritisation_models for all to authenticated using (true) with check (true);
create policy authenticated_all on public.planner_preferences for all to authenticated using (true) with check (true);
create policy authenticated_all on public.priority_items for all to authenticated using (true) with check (true);
create policy authenticated_all on public.priority_events for all to authenticated using (true) with check (true);
create policy authenticated_all on public.plan_actions for all to authenticated using (true) with check (true);
create policy authenticated_all on public.notifications for all to authenticated using (true) with check (true);
grant all on table public.prioritisation_models, public.planner_preferences, public.priority_items, public.priority_events, public.plan_actions, public.notifications to authenticated, service_role;
grant usage, select on sequence public.prioritisation_models_version_seq to authenticated, service_role;
revoke all on table public.prioritisation_models, public.planner_preferences, public.priority_items, public.priority_events, public.plan_actions, public.notifications from anon;

-- Contact history per employer, from real sent messages only (simulated dry-run sends do not count as contact).
create view public.v_employer_contact_history with (security_invoker = true) as
select e.id as employer_id,
       count(a.id) filter (where a.direction = 'outbound' and a.delivery_result in ('sent','delivered')) as outbound_count,
       max(a.sent_at) filter (where a.direction = 'outbound' and a.delivery_result in ('sent','delivered')) as last_outbound_at,
       coalesce(bool_or(a.reply_received), false) as replied,
       e.outreach_stage
from public.employers e left join public.activities a on a.employer_id = e.id
where e.deleted_at is null
group by e.id, e.outreach_stage;

-- The queue Erin works from: one row per opportunity with its names, both measures kept separate, and the contact history.
create view public.v_priority_queue with (security_invoker = true) as
select
  p.id, p.kind, p.employer_id, p.vacancy_id, p.status, p.recommended_status, p.manual_status,
  coalesce(v.title, coalesce(e.display_name, e.legal_name)) as name,
  case when p.kind = 'vacancy' then coalesce(ev.display_name, ev.legal_name, v.employer_name_raw) else null end as employer_name,
  p.score, p.override_score, coalesce(p.override_score, p.score) as score_used, p.suitability_total,
  p.deadline_at, case when p.deadline_at is null then null else floor(extract(epoch from (p.deadline_at - now())) / 86400)::int end as days_left,
  p.live, p.pinned, p.favourite, p.needs_review_reason, p.hold_until, p.hold_condition, p.dismissed_reason, p.manual_reason,
  jsonb_array_length(p.warnings) as warning_count, p.warnings, p.rationale, p.components, p.effort, p.model_version, p.computed_at, p.updated_at,
  h.outbound_count, h.last_outbound_at, h.replied
from public.priority_items p
left join public.vacancies v on v.id = p.vacancy_id
left join public.employers ev on ev.id = v.employer_id
left join public.employers e on e.id = p.employer_id and p.kind = 'employer'
left join public.v_employer_contact_history h on h.employer_id = coalesce(p.employer_id, v.employer_id);

create view public.v_stage3_counts with (security_invoker = true) as
select
  (select count(*) from public.priority_items where status = 'high' and live) as high,
  (select count(*) from public.priority_items where status = 'recommended' and live) as recommended,
  (select count(*) from public.priority_items where status = 'backlog') as backlog,
  (select count(*) from public.priority_items where status = 'on_hold') as on_hold,
  (select count(*) from public.priority_items where status = 'dismissed') as dismissed,
  (select count(*) from public.priority_items where needs_review_reason is not null and status <> 'dismissed') as needs_review,
  (select count(*) from public.priority_items where status <> 'dismissed' and live and deadline_at between now() and now() + interval '7 days') as deadlines_7d,
  (select count(*) from public.plan_actions where status = 'suggested') as suggested_actions,
  (select count(*) from public.plan_actions where status = 'accepted' and planned_for = current_date) as planned_today,
  (select count(*) from public.notifications where dismissed_at is null and read_at is null) as unread_notifications;

grant select on public.v_employer_contact_history, public.v_priority_queue, public.v_stage3_counts to authenticated;
