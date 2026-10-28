-- 19: careers-page vacancy extraction. A source definition so runs show on the Sources page, and per-page extraction state.
alter table public.sources
  add column last_extracted_hash text,
  add column last_extracted_at timestamptz;

insert into public.source_definitions (code, label, adapter_type, enabled, requires_env, schedule_cron, config, min_interval_ms, daily_request_cap, notes) values
('careers_pages', 'Employer careers pages (AI-read)', 'periodic_fetch_with_robots_check', true, '{ANTHROPIC_API_KEY}', '15 5 * * *',
 '{"max_pages_per_run":20,"max_detail_fetches_per_page":8}', 3000, 400,
 'Fetches each tracked employer careers page (robots.txt respected), has Claude list the vacancies the page itself advertises, and keeps only listings whose title is quoted verbatim from the page. A vacancy missing from the page is marked unverified on the first miss and closed after a second miss at least two days later; a page that fails to load never closes anything. Pages that need JavaScript to render show no text and are reported, not guessed at.')
on conflict (code) do nothing;
