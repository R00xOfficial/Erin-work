-- 18: remember when the worker last looked for an employer's careers page, so it does not re-fetch the same homepages every run.
alter table public.employers add column careers_search_at timestamptz;
create index employers_careers_search_idx on public.employers (careers_search_at nulls first) where deleted_at is null and careers_url is null and website is not null;
