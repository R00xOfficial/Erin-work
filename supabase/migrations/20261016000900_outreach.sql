-- 09: activities (every interaction is an event), threads, suppressions, alert emails.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid references public.employers (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  vacancy_id uuid references public.vacancies (id) on delete set null,
  activity_type public.activity_type not null,
  direction public.direction not null default 'internal',
  channel public.channel not null default 'system',
  template_id uuid references public.email_templates (id) on delete set null,
  template_code text,
  template_version int,
  subject text,
  body_text text,
  body_html text,
  recipient_email text,
  sender_email text,
  cc_emails text[] not null default '{}',
  delivery_result public.delivery_result not null default 'pending',
  blocked_reasons text[] not null default '{}',
  approval_status public.approval_status not null default 'not_required',
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_note text,
  provider text,
  provider_draft_id text,
  provider_message_id text,
  provider_thread_id text,
  rfc_message_id text,
  in_reply_to text,
  occurred_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text,
  reply_received boolean not null default false,
  opt_out_detected boolean not null default false,
  follow_up_due_at timestamptz,
  follow_up_done boolean not null default false,
  outcome text,
  next_action text,
  attachments jsonb not null default '[]'::jsonb,
  idempotency_key text,
  evidence_source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index activities_provider_message_uq on public.activities (provider_message_id) where provider_message_id is not null;
create unique index activities_idempotency_uq on public.activities (idempotency_key) where idempotency_key is not null;
create index activities_thread_idx on public.activities (provider_thread_id);
create index activities_employer_idx on public.activities (employer_id, occurred_at desc);
create index activities_contact_idx on public.activities (contact_id, occurred_at desc);
create index activities_follow_up_idx on public.activities (follow_up_due_at) where follow_up_due_at is not null and follow_up_done = false;
create index activities_approval_idx on public.activities (approval_status) where approval_status = 'pending_approval';

alter table public.applications add constraint applications_confirmation_activity_fk
  foreign key (confirmation_email_activity_id) references public.activities (id) on delete set null;
alter table public.stage_transitions add constraint stage_transitions_activity_fk
  foreign key (activity_id) references public.activities (id) on delete set null;

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gmail',
  provider_thread_id text not null unique,
  employer_id uuid references public.employers (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  subject text,
  first_sent_at timestamptz,
  last_message_at timestamptz,
  last_direction public.direction,
  message_count int not null default 0,
  status public.thread_status not null default 'awaiting_reply',
  label_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  scope public.suppression_scope not null,
  value text not null,
  employer_id uuid references public.employers (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  reason public.suppression_reason not null,
  source_activity_id uuid references public.activities (id) on delete set null,
  source_description text,
  lawful_basis_note text,
  retention_rule text not null default 'Retain indefinitely to honour the objection.',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (scope, value)
);

create table public.email_alert_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  provider_thread_id text,
  from_email text,
  subject text,
  received_at timestamptz,
  source_definition_id uuid references public.source_definitions (id) on delete set null,
  extracted_links jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
