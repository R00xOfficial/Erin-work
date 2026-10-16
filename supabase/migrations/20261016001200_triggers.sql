-- 12: triggers and table-dependent functions.

-- updated_at on every table that has the column.
-- Explicit statements (no DO/EXECUTE loop): dynamic DDL inside DO blocks stalls through the hosted SQL API.
drop trigger if exists trg_set_updated_at on public.activities;
drop trigger if exists trg_set_updated_at on public.activities;
create trigger trg_set_updated_at before update on public.activities for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.applications;
drop trigger if exists trg_set_updated_at on public.applications;
create trigger trg_set_updated_at before update on public.applications for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.candidate_profile;
drop trigger if exists trg_set_updated_at on public.candidate_profile;
create trigger trg_set_updated_at before update on public.candidate_profile for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.claims;
drop trigger if exists trg_set_updated_at on public.claims;
create trigger trg_set_updated_at before update on public.claims for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.contacts;
drop trigger if exists trg_set_updated_at on public.contacts;
create trigger trg_set_updated_at before update on public.contacts for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.documents;
drop trigger if exists trg_set_updated_at on public.documents;
create trigger trg_set_updated_at before update on public.documents for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.email_templates;
drop trigger if exists trg_set_updated_at on public.email_templates;
create trigger trg_set_updated_at before update on public.email_templates for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.email_threads;
drop trigger if exists trg_set_updated_at on public.email_threads;
create trigger trg_set_updated_at before update on public.email_threads for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.employers;
drop trigger if exists trg_set_updated_at on public.employers;
create trigger trg_set_updated_at before update on public.employers for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.host_policies;
drop trigger if exists trg_set_updated_at on public.host_policies;
create trigger trg_set_updated_at before update on public.host_policies for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.interviews;
drop trigger if exists trg_set_updated_at on public.interviews;
create trigger trg_set_updated_at before update on public.interviews for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on private.oauth_credentials;
create trigger trg_set_updated_at before update on private.oauth_credentials for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.offices;
drop trigger if exists trg_set_updated_at on public.offices;
create trigger trg_set_updated_at before update on public.offices for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.research_notes;
drop trigger if exists trg_set_updated_at on public.research_notes;
create trigger trg_set_updated_at before update on public.research_notes for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.settings;
drop trigger if exists trg_set_updated_at on public.settings;
create trigger trg_set_updated_at before update on public.settings for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.source_definitions;
drop trigger if exists trg_set_updated_at on public.source_definitions;
create trigger trg_set_updated_at before update on public.source_definitions for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.sources;
drop trigger if exists trg_set_updated_at on public.sources;
create trigger trg_set_updated_at before update on public.sources for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.tasks;
drop trigger if exists trg_set_updated_at on public.tasks;
create trigger trg_set_updated_at before update on public.tasks for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_set_updated_at on public.vacancies;
drop trigger if exists trg_set_updated_at on public.vacancies;
create trigger trg_set_updated_at before update on public.vacancies for each row execute function public.fn_set_updated_at();

-- Zone classification from the geo_zones table (districts win over areas, then towns, else OUT).
create or replace function public.fn_zone_for_location(p_postcode text, p_town text)
returns text language plpgsql stable as $$
declare district text; area text; z text;
begin
  district := public.fn_postcode_district(p_postcode);
  if district is not null then
    select code into z from public.geo_zones where district = any(postcode_districts) order by sort_order limit 1;
    if z is not null then return z; end if;
    area := substring(district from '^[A-Z]{1,2}');
    select code into z from public.geo_zones where area = any(postcode_areas) order by sort_order limit 1;
    if z is not null then return z; end if;
  end if;
  if p_town is not null then
    select code into z from public.geo_zones where lower(btrim(p_town)) = any(select lower(t) from unnest(towns) t) order by sort_order limit 1;
    if z is not null then return z; end if;
  end if;
  return 'OUT';
end $$;

-- employers: derived columns, stage timestamps, review date
create or replace function public.fn_employers_before_write()
returns trigger language plpgsql as $$
begin
  new.normalised_name := coalesce(public.fn_normalise_company_name(new.legal_name), lower(new.legal_name));
  if new.website is not null then new.website_domain := public.fn_extract_domain(new.website); end if;
  if new.companies_house_number is not null then
    new.companies_house_number := upper(regexp_replace(new.companies_house_number, '\s', '', 'g'));
    if new.companies_house_number ~ '^\d+$' then new.companies_house_number := lpad(new.companies_house_number, 8, '0'); end if;
  end if;
  if new.applications_email is not null then new.applications_email := lower(btrim(new.applications_email)); end if;
  if new.generic_email is not null then new.generic_email := lower(btrim(new.generic_email)); end if;
  if tg_op = 'UPDATE' and new.outreach_stage is distinct from old.outreach_stage then
    new.outreach_stage_changed_at := now();
  end if;
  if new.outreach_stage = 'suppressed' then new.is_suppressed := true; end if;
  if new.next_review_at is null then
    new.next_review_at := coalesce(new.last_checked_at, now()) + interval '30 days';
  elsif tg_op = 'UPDATE' and new.last_checked_at is distinct from old.last_checked_at and new.last_checked_at is not null then
    new.next_review_at := new.last_checked_at + interval '30 days';
  end if;
  return new;
end $$;
drop trigger if exists trg_employers_before_write on public.employers;
create trigger trg_employers_before_write before insert or update on public.employers
  for each row execute function public.fn_employers_before_write();

-- stage transitions for both pipelines
create or replace function public.fn_record_stage_transition()
returns trigger language plpgsql as $$
declare v_pipeline public.pipeline_kind; v_from text; v_to text;
begin
  if tg_table_name = 'employers' then
    v_pipeline := 'employer_outreach'; v_to := new.outreach_stage::text;
    v_from := case when tg_op = 'UPDATE' then old.outreach_stage::text else null end;
  else
    v_pipeline := 'application'; v_to := new.stage::text;
    v_from := case when tg_op = 'UPDATE' then old.stage::text else null end;
  end if;
  if tg_op = 'INSERT' or v_from is distinct from v_to then
    insert into public.stage_transitions (pipeline, entity_id, from_stage, to_stage, changed_by)
    values (v_pipeline, new.id, v_from, v_to, current_setting('request.jwt.claim.email', true));
  end if;
  return new;
end $$;
drop trigger if exists trg_employers_stage_transition on public.employers;
create trigger trg_employers_stage_transition after insert or update of outreach_stage on public.employers
  for each row execute function public.fn_record_stage_transition();
drop trigger if exists trg_applications_stage_transition on public.applications;
create trigger trg_applications_stage_transition after insert or update of stage on public.applications
  for each row execute function public.fn_record_stage_transition();

create or replace function public.fn_applications_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
    if new.stage = 'acknowledged' and new.acknowledged_at is null then new.acknowledged_at := now(); end if;
    if new.stage in ('offer_accepted','rejected','withdrawn','closed_without_response') and new.closed_at is null then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_applications_before_write on public.applications;
create trigger trg_applications_before_write before insert or update on public.applications
  for each row execute function public.fn_applications_before_write();

-- offices: postcode + zone
create or replace function public.fn_offices_before_write()
returns trigger language plpgsql as $$
begin
  if new.postcode is not null then new.postcode := coalesce(public.fn_normalise_postcode(new.postcode), upper(btrim(new.postcode))); end if;
  new.zone_code := public.fn_zone_for_location(new.postcode, new.town);
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  return new;
end $$;
drop trigger if exists trg_offices_before_write on public.offices;
create trigger trg_offices_before_write before insert or update on public.offices
  for each row execute function public.fn_offices_before_write();

-- contacts: lowercase email
create or replace function public.fn_contacts_before_write()
returns trigger language plpgsql as $$
begin
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  if new.do_not_contact and new.opt_out_at is null then new.opt_out_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_contacts_before_write on public.contacts;
create trigger trg_contacts_before_write before insert or update on public.contacts
  for each row execute function public.fn_contacts_before_write();

-- vacancies: hashes, normalised title, zone
create or replace function public.fn_vacancies_before_write()
returns trigger language plpgsql as $$
begin
  if new.canonical_url is not null then new.canonical_url_hash := public.fn_sha256(new.canonical_url); end if;
  if new.postcode is not null then new.postcode := coalesce(public.fn_normalise_postcode(new.postcode), upper(btrim(new.postcode))); end if;
  new.zone_code := public.fn_zone_for_location(new.postcode, new.location_text);
  if new.description_snapshot is not null and new.description_hash is null then
    new.description_hash := public.fn_sha256(lower(regexp_replace(new.description_snapshot, '\s+', ' ', 'g')));
    new.description_snapshot_at := coalesce(new.description_snapshot_at, now());
  end if;
  if new.application_email is not null then new.application_email := lower(btrim(new.application_email)); end if;
  return new;
end $$;
drop trigger if exists trg_vacancies_before_write on public.vacancies;
create trigger trg_vacancies_before_write before insert or update on public.vacancies
  for each row execute function public.fn_vacancies_before_write();

-- suppressions: keep denormalised flags in sync and move suppressed employers to the terminal stage
create or replace function public.fn_sync_suppression_flags()
returns trigger language plpgsql as $$
declare rec public.suppressions; v_val text;
begin
  rec := case when tg_op = 'DELETE' then old else new end;
  v_val := lower(btrim(rec.value));
  if rec.scope = 'employer' then
    if tg_op = 'DELETE' then
      update public.employers set is_suppressed = false where id = rec.employer_id and outreach_stage <> 'suppressed'
        and not exists (select 1 from public.suppressions s where s.scope = 'employer' and s.employer_id = rec.employer_id and s.id <> rec.id);
    else
      update public.employers set is_suppressed = true, outreach_stage = 'suppressed' where id = rec.employer_id;
    end if;
  elsif rec.scope = 'contact' then
    update public.contacts set do_not_contact = (tg_op <> 'DELETE') where id = rec.contact_id;
  elsif rec.scope = 'email' then
    update public.contacts set do_not_contact = (tg_op <> 'DELETE') where lower(email) = v_val;
  elsif rec.scope = 'domain' then
    update public.contacts set do_not_contact = (tg_op <> 'DELETE') where lower(split_part(email, '@', 2)) = v_val;
  end if;
  return null;
end $$;
drop trigger if exists trg_suppressions_sync on public.suppressions;
create trigger trg_suppressions_sync after insert or delete on public.suppressions
  for each row execute function public.fn_sync_suppression_flags();

create or replace function public.fn_suppressions_before_write()
returns trigger language plpgsql as $$
begin
  new.value := lower(btrim(new.value));
  if new.scope = 'employer' and new.employer_id is not null then new.value := new.employer_id::text; end if;
  if new.scope = 'contact' and new.contact_id is not null then new.value := new.contact_id::text; end if;
  return new;
end $$;
drop trigger if exists trg_suppressions_before_write on public.suppressions;
create trigger trg_suppressions_before_write before insert or update on public.suppressions
  for each row execute function public.fn_suppressions_before_write();

-- audit log
create or replace function public.fn_audit()
returns trigger language plpgsql as $$
declare v_diff jsonb; v_id uuid; k text;
begin
  if tg_op = 'INSERT' then
    v_diff := to_jsonb(new); v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_diff := to_jsonb(old); v_id := old.id;
  else
    v_id := new.id; v_diff := '{}'::jsonb;
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if to_jsonb(new) -> k is distinct from to_jsonb(old) -> k and k not in ('updated_at','search_vector') then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', to_jsonb(old) -> k, 'new', to_jsonb(new) -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then return null; end if;
  end if;
  insert into public.audit_log (table_name, row_id, action, actor, diff)
  values (tg_table_name, v_id, tg_op, coalesce(current_setting('request.jwt.claim.email', true), current_user), v_diff);
  return null;
end $$;
drop trigger if exists trg_audit on public.employers;
drop trigger if exists trg_audit on public.employers;
create trigger trg_audit after insert or update or delete on public.employers for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.contacts;
drop trigger if exists trg_audit on public.contacts;
create trigger trg_audit after insert or update or delete on public.contacts for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.applications;
drop trigger if exists trg_audit on public.applications;
create trigger trg_audit after insert or update or delete on public.applications for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.activities;
drop trigger if exists trg_audit on public.activities;
create trigger trg_audit after insert or update or delete on public.activities for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.suppressions;
drop trigger if exists trg_audit on public.suppressions;
create trigger trg_audit after insert or update or delete on public.suppressions for each row execute function public.fn_audit();
drop trigger if exists trg_audit on public.documents;
drop trigger if exists trg_audit on public.documents;
create trigger trg_audit after insert or update or delete on public.documents for each row execute function public.fn_audit();
-- settings has a text pk; audit it separately
create or replace function public.fn_audit_settings()
returns trigger language plpgsql as $$
begin
  insert into public.audit_log (table_name, row_id, action, actor, diff)
  values ('settings', null, tg_op, coalesce(current_setting('request.jwt.claim.email', true), current_user),
          jsonb_build_object('key', coalesce(new.key, old.key), 'old', case when tg_op = 'INSERT' then null else old.value end, 'new', case when tg_op = 'DELETE' then null else new.value end));
  return null;
end $$;
drop trigger if exists trg_audit_settings on public.settings;
create trigger trg_audit_settings after insert or update or delete on public.settings for each row execute function public.fn_audit_settings();
