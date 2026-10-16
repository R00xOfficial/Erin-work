-- Assertions run after migrations, before seed.
do $$
declare n int; reasons text[]; v_emp uuid; v_contact uuid; v_act uuid; v_app uuid;
begin
  -- tables exist
  select count(*) into n from pg_tables where schemaname = 'public';
  if n < 30 then raise exception 'expected >= 30 public tables, got %', n; end if;
  if not exists (select 1 from pg_tables where schemaname = 'private' and tablename = 'oauth_credentials') then raise exception 'private.oauth_credentials missing'; end if;

  -- RLS on every public table
  select count(*) into n from pg_tables t join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
   where t.schemaname = 'public' and not c.relrowsecurity
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'); -- ignore extension-owned tables (spatial_ref_sys locally)
  if n > 0 then raise exception '% public tables without RLS', n; end if;

  -- reference data present
  if (select count(*) from public.geo_zones) <> 5 then raise exception 'geo_zones rows'; end if;
  if (select count(*) from public.pipeline_stage_meta where pipeline = 'employer_outreach') <> 15 then raise exception 'employer stage meta rows'; end if;
  if (select count(*) from public.pipeline_stage_meta where pipeline = 'application') <> 14 then raise exception 'application stage meta rows'; end if;
  if not exists (select 1 from public.scoring_weights where is_active) then raise exception 'no active scoring weights'; end if;
  if (select (value)::boolean from public.settings where key = 'stop_switch') is distinct from true then raise exception 'stop_switch must default to true'; end if;

  -- normalisation functions
  if public.fn_normalise_company_name('Make Architects Ltd.') <> 'make architects' then raise exception 'fn_normalise_company_name: %', public.fn_normalise_company_name('Make Architects Ltd.'); end if;
  if public.fn_normalise_company_name('Allies & Morrison LLP') <> 'allies and morrison' then raise exception 'fn_normalise_company_name ampersand'; end if;
  if public.fn_normalise_postcode('gu314aa') <> 'GU31 4AA' then raise exception 'fn_normalise_postcode'; end if;
  if public.fn_extract_domain('https://www.jobs.example.co.uk/x') <> 'example.co.uk' then raise exception 'fn_extract_domain: %', public.fn_extract_domain('https://www.jobs.example.co.uk/x'); end if;
  if public.fn_zone_for_location('GU31 4AA', null) <> 'C' then raise exception 'zone C'; end if;
  if public.fn_zone_for_location('EC1A 1BB', null) <> 'A' then raise exception 'zone A'; end if;
  if public.fn_zone_for_location('GU1 3AA', null) <> 'B' then raise exception 'zone B'; end if;
  if public.fn_zone_for_location(null, 'Petersfield') <> 'C' then raise exception 'zone by town'; end if;
  if public.fn_zone_for_location('M1 1AA', 'Manchester') <> 'OUT' then raise exception 'zone OUT'; end if;

  -- employer derived columns + duplicate protection
  insert into public.employers (legal_name, website) values ('Smoke Test Architects Ltd', 'https://www.smoketest-architects.co.uk/about') returning id into v_emp;
  if (select normalised_name from public.employers where id = v_emp) <> 'smoke test architects' then raise exception 'normalised_name trigger'; end if;
  if (select website_domain from public.employers where id = v_emp) <> 'smoketest-architects.co.uk' then raise exception 'website_domain trigger'; end if;
  if (select next_review_at from public.employers where id = v_emp) is null then raise exception 'next_review_at default'; end if;
  begin
    insert into public.employers (legal_name) values ('SMOKE TEST ARCHITECTS LIMITED');
    raise exception 'duplicate employer by normalised name was allowed';
  exception when unique_violation then null; end;
  begin
    insert into public.employers (legal_name, website) values ('Different Name', 'http://smoketest-architects.co.uk');
    raise exception 'duplicate employer by domain was allowed';
  exception when unique_violation then null; end;

  -- stage transition trigger
  if (select count(*) from public.stage_transitions where pipeline = 'employer_outreach' and entity_id = v_emp) <> 1 then raise exception 'initial stage transition missing'; end if;
  update public.employers set outreach_stage = 'awaiting_research' where id = v_emp;
  update public.employers set outreach_stage = 'awaiting_research' where id = v_emp; -- no-op must not add a row
  if (select count(*) from public.stage_transitions where pipeline = 'employer_outreach' and entity_id = v_emp) <> 2 then raise exception 'stage transition count'; end if;
  if not exists (select 1 from public.stage_transitions where entity_id = v_emp and from_stage = 'discovered' and to_stage = 'awaiting_research') then raise exception 'stage transition value'; end if;

  -- offices zone + geography
  insert into public.offices (employer_id, town, postcode, lat, lng) values (v_emp, 'Guildford', 'gu1 3aa', 51.2362, -0.5704);
  if (select zone_code from public.offices where employer_id = v_emp) <> 'B' then raise exception 'office zone'; end if;
  if (select geog from public.offices where employer_id = v_emp) is null then raise exception 'office geog'; end if;
  if (select postcode from public.offices where employer_id = v_emp) <> 'GU1 3AA' then raise exception 'office postcode normalisation'; end if;

  -- contacts + suppression sync
  insert into public.contacts (employer_id, full_name, email) values (v_emp, 'Sam Studio', 'SAM@smoketest-architects.co.uk') returning id into v_contact;
  if (select email from public.contacts where id = v_contact) <> 'sam@smoketest-architects.co.uk' then raise exception 'contact email lowercased'; end if;
  insert into public.suppressions (scope, value, reason) values ('email', 'Sam@SmokeTest-Architects.co.uk', 'opt_out');
  if not (select do_not_contact from public.contacts where id = v_contact) then raise exception 'suppression -> do_not_contact'; end if;
  delete from public.suppressions where scope = 'email' and value = 'sam@smoketest-architects.co.uk';
  if (select do_not_contact from public.contacts where id = v_contact) then raise exception 'suppression delete -> do_not_contact reset'; end if;

  -- vacancy hash uniqueness
  insert into public.vacancies (title, original_url, canonical_url, employer_id) values ('Part 1 Architectural Assistant', 'https://x.test/j/1?utm=1', 'https://x.test/j/1', v_emp);
  begin
    insert into public.vacancies (title, original_url, canonical_url) values ('Dup', 'https://x.test/j/1', 'https://x.test/j/1');
    raise exception 'duplicate vacancy canonical url allowed';
  exception when unique_violation then null; end;
  if (select canonical_url_hash from public.vacancies where canonical_url = 'https://x.test/j/1') <> public.fn_sha256('https://x.test/j/1') then raise exception 'canonical hash'; end if;

  -- application stage transition + submitted_at
  insert into public.applications (employer_id, application_type) values (v_emp, 'speculative') returning id into v_app;
  update public.applications set stage = 'submitted' where id = v_app;
  if (select submitted_at from public.applications where id = v_app) is null then raise exception 'submitted_at not set'; end if;
  if (select count(*) from public.stage_transitions where pipeline = 'application' and entity_id = v_app) <> 2 then raise exception 'application transitions'; end if;

  -- fn_can_send blocks an unapproved draft with the expected reasons
  insert into public.activities (employer_id, contact_id, activity_type, direction, channel, subject, body_text, recipient_email, template_code, template_version, delivery_result, approval_status)
  values (v_emp, v_contact, 'email_draft_created', 'outbound', 'email', 'Hello {{name}}', 'Body', 'sam@smoketest-architects.co.uk', 'speculative_intro', 1, 'drafted', 'pending_approval') returning id into v_act;
  reasons := public.fn_can_send(v_act);
  if not ('stop_switch' = any(reasons)) then raise exception 'fn_can_send should report stop_switch: %', reasons; end if;
  if not ('credential_not_active' = any(reasons)) then raise exception 'fn_can_send should report credential_not_active: %', reasons; end if;
  if not ('employer_stage_not_approved' = any(reasons)) then raise exception 'fn_can_send should report stage: %', reasons; end if;
  if not ('template_unrendered' = any(reasons)) then raise exception 'fn_can_send should report template_unrendered: %', reasons; end if;
  if not ('approval_missing' = any(reasons)) then raise exception 'fn_can_send should report approval_missing: %', reasons; end if;
  if not ('attachment_missing' = any(reasons)) then raise exception 'fn_can_send should report attachment_missing: %', reasons; end if;
  -- fix everything and check it passes except credential (no Gmail connected)
  update public.settings set value = 'false' where key = 'stop_switch';
  update public.employers set outreach_stage = 'contact_approved' where id = v_emp;
  insert into public.documents (kind, version_label, storage_path, file_name, sha256, is_current) values ('cv', 'v1', 'cv/v1.pdf', 'cv.pdf', 'abc', true);
  update public.activities set subject = 'Hello Sam', approval_status = 'approved', approved_at = now(),
    attachments = (select jsonb_build_array(jsonb_build_object('document_id', id, 'sha256', sha256, 'file_name', file_name)) from public.documents where version_label = 'v1')
    where id = v_act;
  reasons := public.fn_can_send(v_act);
  if reasons <> array['credential_not_active'] then raise exception 'fn_can_send expected only credential_not_active, got %', reasons; end if;
  insert into private.oauth_credentials (provider, account_email, status) values ('gmail', 'me@example.com', 'active');
  reasons := public.fn_can_send(v_act);
  if reasons <> '{}' then raise exception 'fn_can_send expected empty, got %', reasons; end if;
  -- employer suppression moves stage and blocks
  insert into public.suppressions (scope, value, reason, employer_id) values ('employer', v_emp::text, 'user_decision', v_emp);
  if (select outreach_stage from public.employers where id = v_emp) <> 'suppressed' then raise exception 'employer suppression stage'; end if;
  reasons := public.fn_can_send(v_act);
  if not ('employer_suppressed' = any(reasons)) or not ('employer_stage_terminal' = any(reasons)) then raise exception 'fn_can_send suppression: %', reasons; end if;

  -- audit log recorded
  if (select count(*) from public.audit_log where table_name = 'employers' and row_id = v_emp) < 2 then raise exception 'audit log'; end if;

  -- views are queryable
  perform * from public.v_dashboard_counts;
  perform * from public.v_today_actions;
  perform * from public.v_queue_research;
  perform * from public.v_queue_new_vacancies;
  perform * from public.v_queue_outreach_approval;
  perform * from public.v_queue_follow_up;
  perform * from public.v_data_quality_issues;

  -- cleanup smoke rows so the seed assertions are clean
  delete from public.suppressions;
  delete from public.vacancies;
  delete from public.employers where id = v_emp;
  delete from public.documents;
  delete from private.oauth_credentials;
  update public.settings set value = 'true' where key = 'stop_switch';
  raise notice 'smoke assertions passed';
end $$;
