-- Seed: five research leads from the brief. These are employers to RESEARCH, not vacancies.
-- Idempotent: fixed UUIDs + on conflict do nothing. Apply with `pnpm db:seed` (remote) or `supabase db reset` (local).

insert into public.sources (id, url, url_hash, canonical_url, publisher, evidence_type, confidence, verification_status, entity_type, claims_summary) values
('a0000000-0000-4000-8000-000000000001', 'https://www.mharchitects.co.uk/', public.fn_sha256('https://mharchitects.co.uk'), 'https://mharchitects.co.uk', 'MH Architects', 'primary_official', 60, 'unverified', 'employer', 'Official website (URL from brief; verify).'),
('a0000000-0000-4000-8000-000000000002', 'https://www.makearchitects.com/', public.fn_sha256('https://makearchitects.com'), 'https://makearchitects.com', 'Make Architects', 'primary_official', 80, 'unverified', 'employer', 'Official website.'),
('a0000000-0000-4000-8000-000000000003', 'https://www.hampshiredesignconsultancy.co.uk/', public.fn_sha256('https://hampshiredesignconsultancy.co.uk'), 'https://hampshiredesignconsultancy.co.uk', 'Hampshire Design Consultancy', 'primary_official', 50, 'unverified', 'employer', 'Official website (URL from brief; verify).'),
('a0000000-0000-4000-8000-000000000004', 'https://farrells.com/', public.fn_sha256('https://farrells.com'), 'https://farrells.com', 'Farrells', 'primary_official', 80, 'unverified', 'employer', 'Official website.'),
('a0000000-0000-4000-8000-000000000005', 'https://www.donaldinsall.com/', public.fn_sha256('https://donaldinsall.com'), 'https://donaldinsall.com', 'Donald Insall Associates', 'primary_official', 80, 'unverified', 'employer', 'Official website.')
on conflict (url_hash) do nothing;

insert into public.employers (id, legal_name, display_name, practice_type, sectors, website, size_band, outreach_stage, data_quality, confidence_score, research_notes, discovered_via_source_id, hires_part1, hires_part1_evidence) values
('e0000000-0000-4000-8000-000000000001', 'MH Architects', 'MH Architects', 'architecture_practice', '{residential,education,commercial}', 'https://www.mharchitects.co.uk/', 'unknown', 'awaiting_research', 'poor', 20,
 'Regional Chichester practice working across residential, education and commercial sectors with published information about sustainability and architectural assistants. Research team structure, technical work and potential junior roles.', 'a0000000-0000-4000-8000-000000000001', 'unknown', 'unverified'),
('e0000000-0000-4000-8000-000000000002', 'Make Architects', 'Make', 'architecture_practice', '{commercial,residential,"mixed use",workplace}', 'https://www.makearchitects.com/', '51_200', 'awaiting_research', 'poor', 20,
 'Larger, internationally active London practice. Research graduate recruitment, design sectors, portfolio expectations and entry-level opportunities.', 'a0000000-0000-4000-8000-000000000002', 'unknown', 'unverified'),
('e0000000-0000-4000-8000-000000000003', 'Hampshire Design Consultancy', 'Hampshire Design Consultancy', 'architecture_practice', '{residential}', 'https://www.hampshiredesignconsultancy.co.uk/', '1_5', 'awaiting_research', 'poor', 20,
 'Small residential-focused design consultancy in Petersfield. Research the actual work split, team capacity, qualifications sought and whether speculative enquiries are welcome. Do not assume a small practice has an opening.', 'a0000000-0000-4000-8000-000000000003', 'unknown', 'unverified'),
('e0000000-0000-4000-8000-000000000004', 'Farrells', 'Farrells', 'architecture_practice', '{residential,"mixed use",masterplanning,infrastructure}', 'https://farrells.com/', '51_200', 'awaiting_research', 'poor', 20,
 'London practice worth monitoring for assistant positions and housing-led project work. Its 2026 recruitment information has referenced architectural assistants and technical design skills; the current status of each role must be rechecked.', 'a0000000-0000-4000-8000-000000000004', 'unknown', 'unverified'),
('e0000000-0000-4000-8000-000000000005', 'Donald Insall Associates', 'Donald Insall Associates', 'heritage_conservation', '{heritage,conservation,residential,"public sector"}', 'https://www.donaldinsall.com/', '51_200', 'awaiting_research', 'poor', 20,
 'Conservation and heritage practice (London and South East). Relevant for sensitive adaptation of existing buildings; published graduate recruitment information gives useful signals about skills and professional development.', 'a0000000-0000-4000-8000-000000000005', 'unknown', 'unverified')
on conflict (id) do nothing;

update public.sources s set entity_id = e.id from public.employers e where s.id = e.discovered_via_source_id and s.entity_id is null;

insert into public.offices (id, employer_id, label, town, county, office_type, status, is_primary, evidence_status) values
('0f000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Chichester studio', 'Chichester', 'West Sussex', 'studio', 'unverified', true, 'unverified'),
('0f000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'London studio', 'London', 'Greater London', 'hq', 'unverified', true, 'unverified'),
('0f000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'Petersfield office', 'Petersfield', 'Hampshire', 'studio', 'unverified', true, 'unverified'),
('0f000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000004', 'London studio', 'London', 'Greater London', 'hq', 'unverified', true, 'unverified'),
('0f000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000005', 'London office', 'London', 'Greater London', 'hq', 'unverified', true, 'unverified')
on conflict (id) do nothing;

insert into public.tasks (title, task_type, entity_type, entity_id, employer_id, priority, auto_generated, dedupe_key, due_at)
select 'Research ' || e.legal_name || ': verify website, office postcode, team structure and whether juniors are employed',
       'research', 'employer', e.id, e.id, 'normal', true, 'research:employer:' || e.id, now() + interval '3 days'
from public.employers e where e.id in (
  'e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003',
  'e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000005')
on conflict (dedupe_key) where dedupe_key is not null and status in ('open','in_progress','snoozed') do nothing;
