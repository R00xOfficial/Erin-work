-- 08: applications, interviews, stage transitions.

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.employers (id) on delete cascade,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  application_type public.application_type not null,
  stage public.application_stage not null default 'vacancy_discovered',
  stage_changed_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  acknowledged_at timestamptz,
  closed_at timestamptz,
  cv_document_id uuid references public.documents (id) on delete set null,
  portfolio_document_id uuid references public.documents (id) on delete set null,
  cover_letter_document_id uuid references public.documents (id) on delete set null,
  cover_letter_text text,
  tailoring_notes text,
  submitted_via text,
  submitted_to text,
  application_answers jsonb,
  salary_expectation text,
  availability_stated text,
  right_to_work_answer text,
  confirmation_ref text,
  confirmation_email_activity_id uuid,
  documents_snapshot jsonb not null default '[]'::jsonb,
  next_action text,
  next_action_due timestamptz,
  feedback text,
  outcome_reason text,
  lessons_learned text,
  offer jsonb,
  offer_decision_deadline timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index applications_vacancy_uq on public.applications (vacancy_id) where vacancy_id is not null and deleted_at is null;
create index applications_stage_idx on public.applications (stage) where deleted_at is null;
create index applications_employer_idx on public.applications (employer_id);
create index applications_next_action_idx on public.applications (next_action_due) where deleted_at is null;

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  round int not null default 1,
  scheduled_at timestamptz,
  duration_minutes int,
  format public.interview_format not null default 'in_person',
  location text,
  interviewers text,
  prep_notes text,
  questions_asked text,
  outcome public.interview_outcome not null default 'pending',
  feedback text,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, round)
);

create table public.stage_transitions (
  id uuid primary key default gen_random_uuid(),
  pipeline public.pipeline_kind not null,
  entity_id uuid not null,
  from_stage text,
  to_stage text not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  note text,
  activity_id uuid
);
create index stage_transitions_entity_idx on public.stage_transitions (pipeline, entity_id, changed_at desc);
