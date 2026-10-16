-- 16: security-linter fixes.
-- a) oauth_credential_status: security invoker + column-level grants on the private table (no SECURITY DEFINER view).
grant usage on schema private to authenticated;
grant select (id, provider, account_email, scopes, status, last_history_id, last_sync_at, last_error, connected_at, updated_at, access_token_expires_at)
  on private.oauth_credentials to authenticated;
alter view public.oauth_credential_status set (security_invoker = true);

-- b) pin search_path on every function (linter 0011).
alter function public.fn_set_updated_at() set search_path = public, extensions;
alter function public.fn_normalise_postcode(text) set search_path = public, extensions;
alter function public.fn_postcode_district(text) set search_path = public, extensions;
alter function public.fn_extract_domain(text) set search_path = public, extensions;
alter function public.fn_immutable_array_to_string(text[], text) set search_path = public, extensions;
alter function public.fn_zone_for_location(text, text) set search_path = public, extensions;
alter function public.fn_employers_before_write() set search_path = public, extensions;
alter function public.fn_record_stage_transition() set search_path = public, extensions;
alter function public.fn_applications_before_write() set search_path = public, extensions;
alter function public.fn_offices_before_write() set search_path = public, extensions;
alter function public.fn_contacts_before_write() set search_path = public, extensions;
alter function public.fn_vacancies_before_write() set search_path = public, extensions;
alter function public.fn_sync_suppression_flags() set search_path = public, extensions;
alter function public.fn_suppressions_before_write() set search_path = public, extensions;
alter function public.fn_audit() set search_path = public, extensions;
alter function public.fn_audit_settings() set search_path = public, extensions;

-- c) fn_can_send is SECURITY DEFINER (reads private.oauth_credentials): worker only.
revoke execute on function public.fn_can_send(uuid) from public, anon, authenticated;
grant execute on function public.fn_can_send(uuid) to service_role;
