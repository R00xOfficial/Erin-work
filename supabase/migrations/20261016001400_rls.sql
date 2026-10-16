-- 14: row level security and storage.
-- Single-user system: every authenticated user may read/write everything; anon gets nothing; worker uses service role.
-- Explicit statements per table (no DO/EXECUTE loop): dynamic DDL inside DO blocks stalls through the hosted SQL API.

grant usage on schema public to anon, authenticated, service_role;

alter table public.candidate_profile enable row level security;
drop policy if exists authenticated_all on public.candidate_profile;
create policy authenticated_all on public.candidate_profile for all to authenticated using (true) with check (true);
grant all on table public.candidate_profile to authenticated, service_role;
revoke all on table public.candidate_profile from anon;

alter table public.settings enable row level security;
drop policy if exists authenticated_all on public.settings;
create policy authenticated_all on public.settings for all to authenticated using (true) with check (true);
grant all on table public.settings to authenticated, service_role;
revoke all on table public.settings from anon;

alter table public.geo_zones enable row level security;
drop policy if exists authenticated_all on public.geo_zones;
create policy authenticated_all on public.geo_zones for all to authenticated using (true) with check (true);
grant all on table public.geo_zones to authenticated, service_role;
revoke all on table public.geo_zones from anon;

alter table public.pipeline_stage_meta enable row level security;
drop policy if exists authenticated_all on public.pipeline_stage_meta;
create policy authenticated_all on public.pipeline_stage_meta for all to authenticated using (true) with check (true);
grant all on table public.pipeline_stage_meta to authenticated, service_role;
revoke all on table public.pipeline_stage_meta from anon;

alter table public.scoring_weights enable row level security;
drop policy if exists authenticated_all on public.scoring_weights;
create policy authenticated_all on public.scoring_weights for all to authenticated using (true) with check (true);
grant all on table public.scoring_weights to authenticated, service_role;
revoke all on table public.scoring_weights from anon;

alter table public.email_templates enable row level security;
drop policy if exists authenticated_all on public.email_templates;
create policy authenticated_all on public.email_templates for all to authenticated using (true) with check (true);
grant all on table public.email_templates to authenticated, service_role;
revoke all on table public.email_templates from anon;

alter table public.documents enable row level security;
drop policy if exists authenticated_all on public.documents;
create policy authenticated_all on public.documents for all to authenticated using (true) with check (true);
grant all on table public.documents to authenticated, service_role;
revoke all on table public.documents from anon;

alter table public.source_definitions enable row level security;
drop policy if exists authenticated_all on public.source_definitions;
create policy authenticated_all on public.source_definitions for all to authenticated using (true) with check (true);
grant all on table public.source_definitions to authenticated, service_role;
revoke all on table public.source_definitions from anon;

alter table public.host_policies enable row level security;
drop policy if exists authenticated_all on public.host_policies;
create policy authenticated_all on public.host_policies for all to authenticated using (true) with check (true);
grant all on table public.host_policies to authenticated, service_role;
revoke all on table public.host_policies from anon;

alter table public.sources enable row level security;
drop policy if exists authenticated_all on public.sources;
create policy authenticated_all on public.sources for all to authenticated using (true) with check (true);
grant all on table public.sources to authenticated, service_role;
revoke all on table public.sources from anon;

alter table public.source_runs enable row level security;
drop policy if exists authenticated_all on public.source_runs;
create policy authenticated_all on public.source_runs for all to authenticated using (true) with check (true);
grant all on table public.source_runs to authenticated, service_role;
revoke all on table public.source_runs from anon;

alter table public.claims enable row level security;
drop policy if exists authenticated_all on public.claims;
create policy authenticated_all on public.claims for all to authenticated using (true) with check (true);
grant all on table public.claims to authenticated, service_role;
revoke all on table public.claims from anon;

alter table public.imports enable row level security;
drop policy if exists authenticated_all on public.imports;
create policy authenticated_all on public.imports for all to authenticated using (true) with check (true);
grant all on table public.imports to authenticated, service_role;
revoke all on table public.imports from anon;

alter table public.import_rows enable row level security;
drop policy if exists authenticated_all on public.import_rows;
create policy authenticated_all on public.import_rows for all to authenticated using (true) with check (true);
grant all on table public.import_rows to authenticated, service_role;
revoke all on table public.import_rows from anon;

alter table public.employers enable row level security;
drop policy if exists authenticated_all on public.employers;
create policy authenticated_all on public.employers for all to authenticated using (true) with check (true);
grant all on table public.employers to authenticated, service_role;
revoke all on table public.employers from anon;

alter table public.employer_aliases enable row level security;
drop policy if exists authenticated_all on public.employer_aliases;
create policy authenticated_all on public.employer_aliases for all to authenticated using (true) with check (true);
grant all on table public.employer_aliases to authenticated, service_role;
revoke all on table public.employer_aliases from anon;

alter table public.offices enable row level security;
drop policy if exists authenticated_all on public.offices;
create policy authenticated_all on public.offices for all to authenticated using (true) with check (true);
grant all on table public.offices to authenticated, service_role;
revoke all on table public.offices from anon;

alter table public.travel_times enable row level security;
drop policy if exists authenticated_all on public.travel_times;
create policy authenticated_all on public.travel_times for all to authenticated using (true) with check (true);
grant all on table public.travel_times to authenticated, service_role;
revoke all on table public.travel_times from anon;

alter table public.contacts enable row level security;
drop policy if exists authenticated_all on public.contacts;
create policy authenticated_all on public.contacts for all to authenticated using (true) with check (true);
grant all on table public.contacts to authenticated, service_role;
revoke all on table public.contacts from anon;

alter table public.vacancies enable row level security;
drop policy if exists authenticated_all on public.vacancies;
create policy authenticated_all on public.vacancies for all to authenticated using (true) with check (true);
grant all on table public.vacancies to authenticated, service_role;
revoke all on table public.vacancies from anon;

alter table public.vacancy_snapshots enable row level security;
drop policy if exists authenticated_all on public.vacancy_snapshots;
create policy authenticated_all on public.vacancy_snapshots for all to authenticated using (true) with check (true);
grant all on table public.vacancy_snapshots to authenticated, service_role;
revoke all on table public.vacancy_snapshots from anon;

alter table public.hiring_signals enable row level security;
drop policy if exists authenticated_all on public.hiring_signals;
create policy authenticated_all on public.hiring_signals for all to authenticated using (true) with check (true);
grant all on table public.hiring_signals to authenticated, service_role;
revoke all on table public.hiring_signals from anon;

alter table public.planning_applications enable row level security;
drop policy if exists authenticated_all on public.planning_applications;
create policy authenticated_all on public.planning_applications for all to authenticated using (true) with check (true);
grant all on table public.planning_applications to authenticated, service_role;
revoke all on table public.planning_applications from anon;

alter table public.applications enable row level security;
drop policy if exists authenticated_all on public.applications;
create policy authenticated_all on public.applications for all to authenticated using (true) with check (true);
grant all on table public.applications to authenticated, service_role;
revoke all on table public.applications from anon;

alter table public.interviews enable row level security;
drop policy if exists authenticated_all on public.interviews;
create policy authenticated_all on public.interviews for all to authenticated using (true) with check (true);
grant all on table public.interviews to authenticated, service_role;
revoke all on table public.interviews from anon;

alter table public.stage_transitions enable row level security;
drop policy if exists authenticated_all on public.stage_transitions;
create policy authenticated_all on public.stage_transitions for all to authenticated using (true) with check (true);
grant all on table public.stage_transitions to authenticated, service_role;
revoke all on table public.stage_transitions from anon;

alter table public.activities enable row level security;
drop policy if exists authenticated_all on public.activities;
create policy authenticated_all on public.activities for all to authenticated using (true) with check (true);
grant all on table public.activities to authenticated, service_role;
revoke all on table public.activities from anon;

alter table public.email_threads enable row level security;
drop policy if exists authenticated_all on public.email_threads;
create policy authenticated_all on public.email_threads for all to authenticated using (true) with check (true);
grant all on table public.email_threads to authenticated, service_role;
revoke all on table public.email_threads from anon;

alter table public.suppressions enable row level security;
drop policy if exists authenticated_all on public.suppressions;
create policy authenticated_all on public.suppressions for all to authenticated using (true) with check (true);
grant all on table public.suppressions to authenticated, service_role;
revoke all on table public.suppressions from anon;

alter table public.email_alert_messages enable row level security;
drop policy if exists authenticated_all on public.email_alert_messages;
create policy authenticated_all on public.email_alert_messages for all to authenticated using (true) with check (true);
grant all on table public.email_alert_messages to authenticated, service_role;
revoke all on table public.email_alert_messages from anon;

alter table public.ai_runs enable row level security;
drop policy if exists authenticated_all on public.ai_runs;
create policy authenticated_all on public.ai_runs for all to authenticated using (true) with check (true);
grant all on table public.ai_runs to authenticated, service_role;
revoke all on table public.ai_runs from anon;

alter table public.research_notes enable row level security;
drop policy if exists authenticated_all on public.research_notes;
create policy authenticated_all on public.research_notes for all to authenticated using (true) with check (true);
grant all on table public.research_notes to authenticated, service_role;
revoke all on table public.research_notes from anon;

alter table public.employer_scores enable row level security;
drop policy if exists authenticated_all on public.employer_scores;
create policy authenticated_all on public.employer_scores for all to authenticated using (true) with check (true);
grant all on table public.employer_scores to authenticated, service_role;
revoke all on table public.employer_scores from anon;

alter table public.tasks enable row level security;
drop policy if exists authenticated_all on public.tasks;
create policy authenticated_all on public.tasks for all to authenticated using (true) with check (true);
grant all on table public.tasks to authenticated, service_role;
revoke all on table public.tasks from anon;

alter table public.job_requests enable row level security;
drop policy if exists authenticated_all on public.job_requests;
create policy authenticated_all on public.job_requests for all to authenticated using (true) with check (true);
grant all on table public.job_requests to authenticated, service_role;
revoke all on table public.job_requests from anon;

alter table public.audit_log enable row level security;
drop policy if exists authenticated_all on public.audit_log;
create policy authenticated_all on public.audit_log for all to authenticated using (true) with check (true);
grant all on table public.audit_log to authenticated, service_role;
revoke all on table public.audit_log from anon;

grant usage, select on sequence public.audit_log_id_seq to authenticated, service_role;

grant select on public.v_dashboard_counts to authenticated, service_role;
revoke all on public.v_dashboard_counts from anon;
grant select on public.v_today_actions to authenticated, service_role;
revoke all on public.v_today_actions from anon;
grant select on public.v_queue_research to authenticated, service_role;
revoke all on public.v_queue_research from anon;
grant select on public.v_queue_new_vacancies to authenticated, service_role;
revoke all on public.v_queue_new_vacancies from anon;
grant select on public.v_queue_outreach_approval to authenticated, service_role;
revoke all on public.v_queue_outreach_approval from anon;
grant select on public.v_queue_follow_up to authenticated, service_role;
revoke all on public.v_queue_follow_up from anon;
grant select on public.v_data_quality_issues to authenticated, service_role;
revoke all on public.v_data_quality_issues from anon;

alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;

-- Private documents bucket (CVs, portfolios). Only runs where the storage schema exists (Supabase).
-- Static statements inside the branch: plpgsql only plans them when the branch executes, so the local docker smoke test is unaffected.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 26214400)
    on conflict (id) do nothing;
    drop policy if exists documents_authenticated_select on storage.objects;
    drop policy if exists documents_authenticated_insert on storage.objects;
    drop policy if exists documents_authenticated_update on storage.objects;
    drop policy if exists documents_authenticated_delete on storage.objects;
    create policy documents_authenticated_select on storage.objects for select to authenticated using (bucket_id = 'documents');
    create policy documents_authenticated_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents');
    create policy documents_authenticated_update on storage.objects for update to authenticated using (bucket_id = 'documents');
    create policy documents_authenticated_delete on storage.objects for delete to authenticated using (bucket_id = 'documents');
  end if;
end $$;
