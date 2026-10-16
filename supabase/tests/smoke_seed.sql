do $$
begin
  if (select count(*) from public.employers where deleted_at is null) <> 5 then raise exception 'seed should produce exactly 5 employers (idempotent), got %', (select count(*) from public.employers); end if;
  if (select count(*) from public.employers where outreach_stage = 'awaiting_research') <> 5 then raise exception 'seed employers must be awaiting_research'; end if;
  if (select count(*) from public.vacancies) <> 0 then raise exception 'seed must not create vacancies'; end if;
  if (select count(*) from public.contacts) <> 0 then raise exception 'seed must not create contacts'; end if;
  if (select count(*) from public.offices) <> 5 then raise exception 'seed offices'; end if;
  if (select count(*) from public.tasks where task_type = 'research') <> 5 then raise exception 'seed research tasks (idempotent)'; end if;
  if (select zone_code from public.offices where town = 'Petersfield') <> 'C' then raise exception 'seed office zone'; end if;
  if (select zone_code from public.offices where town = 'London' limit 1) <> 'A' then raise exception 'seed London zone'; end if;
  if (select website_domain from public.employers where legal_name = 'Make Architects') <> 'makearchitects.com' then raise exception 'seed domain'; end if;
  if (select employers_total from public.v_dashboard_counts) <> 5 then raise exception 'dashboard counts'; end if;
  if (select count(*) from public.v_queue_research) <> 5 then raise exception 'research queue'; end if;
  raise notice 'seed assertions passed';
end $$;
