do $do$
declare
  r jsonb;
  src_hash text;
  ev_hash text;
  ts timestamptz := '__RESEARCH_DATE__T12:00:00Z';
begin
  for r in select * from jsonb_array_elements($j$__JSON__$j$::jsonb) loop
    src_hash := public.fn_sha256(r->>'sc');
    insert into public.sources (url, url_hash, canonical_url, publisher, title, evidence_type, confidence, verification_status, entity_type, entity_id, claims_summary, last_fetched_at, fetch_status, recheck_interval, next_check_at)
    values (r->>'su', src_hash, r->>'sc', coalesce(r->>'dn', r->>'n'), 'Seed research source', 'primary_official', (r->>'cf')::numeric, 'verified', 'employer', (r->>'id')::uuid,
            'Studio location and current trading verified on the official website during seed research.', ts, 'ok', interval '30 days', ts + interval '30 days')
    on conflict (url_hash) do nothing;

    insert into public.employers (id, legal_name, display_name, practice_type, is_architecture_practice, website, careers_url, size_band, sectors, specialisms, hires_part1, hires_part1_evidence,
      recruitment_intelligence, recruitment_intelligence_evidence, generic_email, applications_email, companies_house_number, research_notes, confidence_score, data_quality, last_checked_at, outreach_stage, discovered_via_source_id)
    values ((r->>'id')::uuid, r->>'n', r->>'dn', (r->>'pt')::public.practice_type, case when r->>'pt' = 'architecture_practice' then true else null end, r->>'w', r->>'cu', (r->>'sb')::public.size_band,
      array(select jsonb_array_elements_text(coalesce(r->'sec', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(r->'sp', '[]'::jsonb))),
      (r->>'h')::public.yes_no_unknown, (case when r->>'h' = 'yes' then 'verified_fact' else 'unverified' end)::public.evidence_status,
      r->>'ev', (case when r->>'ev' is not null then 'verified_fact' else 'unverified' end)::public.evidence_status,
      r->>'ge', r->>'ae', r->>'ch', r->>'no', least((r->>'cf')::numeric, 70), 'fair', ts, 'awaiting_research', (select id from public.sources where url_hash = src_hash))
    on conflict do nothing;

    continue when not exists (select 1 from public.employers where id = (r->>'id')::uuid);

    insert into public.offices (id, employer_id, label, town, county, postcode, office_type, status, is_primary, evidence_status, source_id, last_verified_at)
    values ((r->>'oid')::uuid, (r->>'id')::uuid, (r->>'t') || ' studio', r->>'t', r->>'c', r->>'pc', 'studio',
      (case when r->>'pc' is not null then 'active' else 'unverified' end)::public.office_status, true,
      (case when r->>'pc' is not null then 'verified_fact' else 'unverified' end)::public.evidence_status,
      (select id from public.sources where url_hash = src_hash), case when r->>'pc' is not null then ts else null end)
    on conflict do nothing;

    if r->>'ev' is not null and r->>'evc' is not null then
      ev_hash := public.fn_sha256(r->>'evc');
      if ev_hash <> src_hash then
        insert into public.sources (url, url_hash, canonical_url, publisher, title, evidence_type, confidence, verification_status, entity_type, entity_id, claims_summary, last_fetched_at, fetch_status)
        values (r->>'evu', ev_hash, r->>'evc', coalesce(r->>'dn', r->>'n'), 'Entry-level evidence', 'primary_official', (r->>'cf')::numeric, 'verified', 'employer', (r->>'id')::uuid, r->>'ev', ts, 'ok')
        on conflict (url_hash) do nothing;
      end if;
      insert into public.claims (entity_type, entity_id, field_name, value, evidence_status, source_id, quote, extracted_by, confidence)
      values ('employer', (r->>'id')::uuid, 'entry_level_evidence', to_jsonb(r->>'ev'), 'verified_fact', (select id from public.sources where url_hash = ev_hash), r->>'ev', 'human', (r->>'cf')::numeric)
      on conflict do nothing;
    end if;

    insert into public.tasks (title, task_type, entity_type, entity_id, employer_id, priority, auto_generated, dedupe_key, due_at)
    values ('Research ' || (r->>'n') || ': confirm team size, juniors employed, best contact route', 'research', 'employer', (r->>'id')::uuid, (r->>'id')::uuid,
      (case when r->>'h' = 'yes' then 'high' else 'normal' end)::public.task_priority, true, 'research:employer:' || (r->>'id'), now() + interval '7 days')
    on conflict (dedupe_key) where dedupe_key is not null and status in ('open','in_progress','snoozed') do nothing;
  end loop;
end
$do$;
