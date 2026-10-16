-- 12b: pre-send gate (split from 12 so each migration applies quickly).
-- Pre-send gate. Mirrors evaluateChecklist() in packages/shared; this SQL version is authoritative
-- because the worker calls it inside the send transaction while holding a row lock on the activity.
create or replace function public.fn_can_send(p_activity_id uuid)
returns text[] language plpgsql security definer
set search_path = public, private, extensions
as $$
declare
  a public.activities;
  e public.employers;
  c public.contacts;
  v public.vacancies;
  reasons text[] := '{}';
  v_stop boolean; v_daily int; v_weekly int; v_ttl int;
  v_sent_today int; v_sent_week int;
  v_last_contact timestamptz; v_last_employer timestamptz; v_last_employer_thread text;
  v_domain text; v_cred_status public.oauth_status;
  att jsonb; v_doc_hash text;
  v_is_follow_up boolean;
begin
  select * into a from public.activities where id = p_activity_id;
  if not found then return array['activity_not_found']; end if;
  select * into e from public.employers where id = a.employer_id;
  if a.contact_id is not null then select * into c from public.contacts where id = a.contact_id; end if;
  if a.vacancy_id is not null then select * into v from public.vacancies where id = a.vacancy_id; end if;

  v_stop := coalesce((select (value)::boolean from public.settings where key = 'stop_switch'), true);
  v_daily := coalesce((select (value)::int from public.settings where key = 'daily_send_cap'), 5);
  v_weekly := coalesce((select (value)::int from public.settings where key = 'weekly_send_cap'), 20);
  v_ttl := coalesce((select (value)::int from public.settings where key = 'approval_ttl_hours'), 72);
  v_is_follow_up := a.template_code like 'follow_up%' or a.in_reply_to is not null;

  if v_stop then reasons := array_append(reasons, 'stop_switch'); end if;
  select status into v_cred_status from private.oauth_credentials where provider = 'gmail' order by connected_at desc limit 1;
  if v_cred_status is null or v_cred_status <> 'active' then reasons := array_append(reasons, 'credential_not_active'); end if;
  if a.recipient_email is null or position('@' in a.recipient_email) = 0 then reasons := array_append(reasons, 'recipient_empty'); end if;
  if a.recipient_email is not null then
    v_domain := lower(split_part(a.recipient_email, '@', 2));
    if exists (select 1 from public.suppressions where scope = 'email' and value = lower(a.recipient_email)) then reasons := array_append(reasons, 'recipient_suppressed'); end if;
    if exists (select 1 from public.suppressions where scope = 'domain' and value = v_domain) then reasons := array_append(reasons, 'domain_suppressed'); end if;
  end if;
  if e.id is null then reasons := array_append(reasons, 'employer_missing');
  else
    if e.is_suppressed or exists (select 1 from public.suppressions where scope = 'employer' and employer_id = e.id) then reasons := array_append(reasons, 'employer_suppressed'); end if;
    if e.outreach_stage in ('closed_no_opportunity','suppressed') then reasons := array_append(reasons, 'employer_stage_terminal');
    elsif v_is_follow_up and e.outreach_stage not in ('email_sent','follow_up_due','replied','conversation_in_progress','cv_requested') then reasons := array_append(reasons, 'employer_stage_not_approved');
    elsif not v_is_follow_up and e.outreach_stage <> 'contact_approved' then reasons := array_append(reasons, 'employer_stage_not_approved');
    end if;
  end if;
  if c.id is not null then
    if exists (select 1 from public.suppressions where scope = 'contact' and contact_id = c.id) then reasons := array_append(reasons, 'contact_suppressed'); end if;
    if c.email_verification = 'bounced' then reasons := array_append(reasons, 'contact_bounced'); end if;
    if c.do_not_contact then reasons := array_append(reasons, 'contact_do_not_contact'); end if;
    select max(sent_at) into v_last_contact from public.activities where contact_id = c.id and direction = 'outbound' and delivery_result in ('sent','delivered') and id <> a.id;
    if not v_is_follow_up and v_last_contact is not null and v_last_contact > now() - interval '30 days' then reasons := array_append(reasons, 'recent_contact_outbound'); end if;
  end if;
  if v.id is not null and coalesce(array_length(v.hard_flags, 1), 0) > 0 then reasons := array_append(reasons, 'vacancy_hard_flags'); end if;
  select sent_at, provider_thread_id into v_last_employer, v_last_employer_thread from public.activities
    where employer_id = a.employer_id and direction = 'outbound' and delivery_result in ('sent','delivered') and id <> a.id order by sent_at desc limit 1;
  if v_last_employer is not null and v_last_employer > now() - interval '7 days'
     and (a.provider_thread_id is null or a.provider_thread_id is distinct from v_last_employer_thread) then
    reasons := array_append(reasons, 'recent_employer_outbound');
  end if;
  if a.idempotency_key is not null and exists (select 1 from public.activities x where x.idempotency_key = a.idempotency_key and x.id <> a.id) then reasons := array_append(reasons, 'idempotency_key_used'); end if;
  select count(*) into v_sent_today from public.activities where direction = 'outbound' and delivery_result in ('sent','delivered') and (sent_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date;
  if v_sent_today >= v_daily then reasons := array_append(reasons, 'daily_cap_reached'); end if;
  select count(*) into v_sent_week from public.activities where direction = 'outbound' and delivery_result in ('sent','delivered') and sent_at > now() - interval '7 days';
  if v_sent_week >= v_weekly then reasons := array_append(reasons, 'weekly_cap_reached'); end if;
  -- attachments: each must reference a non-deleted document whose sha256 matches the snapshot
  for att in select * from jsonb_array_elements(coalesce(a.attachments, '[]'::jsonb)) loop
    select sha256 into v_doc_hash from public.documents where id = (att ->> 'document_id')::uuid and deleted_at is null;
    if v_doc_hash is null then reasons := array_append(reasons, 'attachment_missing');
    elsif v_doc_hash <> coalesce(att ->> 'sha256', '') then reasons := array_append(reasons, 'attachment_hash_mismatch'); end if;
  end loop;
  if not v_is_follow_up and jsonb_array_length(coalesce(a.attachments, '[]'::jsonb)) = 0 then reasons := array_append(reasons, 'attachment_missing'); end if;
  if a.subject is null or btrim(a.subject) = '' then reasons := array_append(reasons, 'subject_empty'); end if;
  if coalesce(a.subject, '') ~ '\{\{\s*[\w.]+\s*\}\}' or coalesce(a.body_text, '') ~ '\{\{\s*[\w.]+\s*\}\}' then reasons := array_append(reasons, 'template_unrendered'); end if;
  if v_domain is not null and (c.id is null or c.email_verification <> 'confirmed_by_reply') then
    if e.website_domain is null or v_domain in ('gmail.com','googlemail.com','hotmail.com','hotmail.co.uk','outlook.com','live.co.uk','yahoo.com','yahoo.co.uk','icloud.com','me.com','btinternet.com','aol.com','protonmail.com','proton.me')
       or (v_domain <> e.website_domain and v_domain not like '%.' || e.website_domain) then
      reasons := array_append(reasons, 'recipient_domain_mismatch');
    end if;
  end if;
  if a.approval_status <> 'approved' or a.approved_at is null then reasons := array_append(reasons, 'approval_missing');
  elsif a.approved_at < now() - make_interval(hours => v_ttl) then reasons := array_append(reasons, 'approval_expired'); end if;
  return (select coalesce(array_agg(distinct r), '{}') from unnest(reasons) r);
end $$;
grant execute on function public.fn_can_send(uuid) to authenticated, service_role;
