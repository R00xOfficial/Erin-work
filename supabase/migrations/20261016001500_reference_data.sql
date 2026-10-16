-- 15: reference data (idempotent upserts). The app cannot run without these rows.

insert into public.geo_zones (code, label, description, postcode_areas, postcode_districts, towns, max_pt_minutes, sort_order) values
('A', 'Zone A — London', 'All London boroughs, the City of London and Greater London studios.',
 '{E,EC,N,NW,SE,SW,W,WC,BR,CR,DA,EN,HA,IG,KT,RM,SM,TW,UB,WD}', '{}',
 '{London,Croydon,"Kingston upon Thames",Richmond,Wimbledon,Bromley,Harrow,Ealing,Stratford,Greenwich}', 75, 1),
('B', 'Zone B — Surrey and the commuter belt', 'Guildford, Woking, Weybridge, Epsom, Leatherhead, Dorking, Reigate, Redhill, Farnham, Aldershot and surrounding towns.',
 '{}', '{GU1,GU2,GU3,GU4,GU5,GU6,GU7,GU8,GU9,GU10,GU11,GU12,GU14,GU15,GU16,GU21,GU22,GU23,GU24,GU47,GU51,GU52,KT10,KT11,KT12,KT13,KT14,KT15,KT16,KT17,KT18,KT19,KT20,KT21,KT22,KT23,KT24,RH1,RH2,RH3,RH4,RH5,RH6,RH7,RH8,RH9}',
 '{Guildford,Woking,Weybridge,Epsom,Leatherhead,Dorking,Reigate,Redhill,Farnham,Aldershot,Godalming,Camberley,Farnborough,Esher,Cobham}', 90, 2),
('C', 'Zone C — West Sussex and Hampshire', 'Petersfield, Liphook, Haslemere, Midhurst, Chichester, Havant, Waterlooville, Portsmouth and nearby areas.',
 '{PO}', '{GU26,GU27,GU28,GU29,GU30,GU31,GU32,GU33,GU34,GU35,BN17,BN18,SO32}',
 '{Petersfield,Liphook,Haslemere,Midhurst,Chichester,Havant,Waterlooville,Portsmouth,Southsea,Emsworth,"Bognor Regis",Alton,Liss,Fareham,Gosport}', 120, 3),
('EXT', 'Extended zone', 'Winchester, Southampton, Crawley, Brighton, Horsham and the wider South East; the commute filter decides.',
 '{SO,RH,BN,GU,SL,RG,ME,TN}', '{}',
 '{Winchester,Southampton,Crawley,Brighton,Horsham,Eastleigh,Basingstoke,Reading,Maidstone,"Tunbridge Wells",Worthing,Gatwick}', 120, 4),
('OUT', 'Outside corridor', 'Outside the search geography. Kept only when the employer has a relevant office inside the corridor or is remote-friendly.', '{}', '{}', '{}', 0, 99)
on conflict (code) do update set label = excluded.label, description = excluded.description, postcode_areas = excluded.postcode_areas,
  postcode_districts = excluded.postcode_districts, towns = excluded.towns, max_pt_minutes = excluded.max_pt_minutes, sort_order = excluded.sort_order;

insert into public.pipeline_stage_meta (pipeline, stage, sort_order, label, is_terminal, sla_days, colour) values
('employer_outreach','discovered',10,'Discovered',false,7,'slate'),
('employer_outreach','awaiting_research',20,'Awaiting research',false,7,'slate'),
('employer_outreach','research_in_progress',30,'Research in progress',false,3,'sky'),
('employer_outreach','verified_eligible',40,'Verified and eligible',false,7,'sky'),
('employer_outreach','ready_to_contact',50,'Ready to contact',false,3,'indigo'),
('employer_outreach','contact_approved',60,'Contact approved',false,1,'indigo'),
('employer_outreach','email_sent',70,'Email sent',false,7,'violet'),
('employer_outreach','follow_up_due',80,'Follow-up due',false,2,'amber'),
('employer_outreach','replied',90,'Replied',false,2,'emerald'),
('employer_outreach','conversation_in_progress',100,'Conversation in progress',false,5,'emerald'),
('employer_outreach','cv_requested',110,'CV requested',false,2,'emerald'),
('employer_outreach','informal_interview',120,'Informal interview or meeting',false,null,'emerald'),
('employer_outreach','opportunity_identified',130,'Opportunity identified',false,null,'green'),
('employer_outreach','closed_no_opportunity',140,'Closed — no opportunity',true,null,'zinc'),
('employer_outreach','suppressed',150,'Suppressed — do not contact',true,null,'red'),
('application','vacancy_discovered',10,'Vacancy discovered',false,2,'slate'),
('application','eligibility_checked',20,'Eligibility checked',false,2,'slate'),
('application','preparing',30,'Preparing application',false,5,'sky'),
('application','ready_to_submit',40,'Ready to submit',false,1,'indigo'),
('application','submitted',50,'Submitted',false,14,'violet'),
('application','acknowledged',60,'Acknowledged',false,14,'violet'),
('application','shortlisted',70,'Shortlisted',false,7,'emerald'),
('application','interview_1',80,'Interview stage 1',false,7,'emerald'),
('application','further_interview',90,'Further interview or assessment',false,7,'emerald'),
('application','offer_received',100,'Offer received',false,5,'green'),
('application','offer_accepted',110,'Offer accepted',true,null,'green'),
('application','rejected',120,'Rejected',true,null,'zinc'),
('application','withdrawn',130,'Withdrawn',true,null,'zinc'),
('application','closed_without_response',140,'Closed without response',true,null,'zinc')
on conflict (pipeline, stage) do update set sort_order = excluded.sort_order, label = excluded.label, is_terminal = excluded.is_terminal, sla_days = excluded.sla_days, colour = excluded.colour;

insert into public.scoring_weights (version, weights, band_thresholds, hard_flag_rules, is_active, notes) values
(1,
 '{"vacancy_evidence":25,"entry_level_suitability":20,"skills_fit":20,"growth_signals":10,"contact_access":10,"commute":10,"research_freshness":5}',
 '{"A":70,"B":50,"minConfidence":40,"maxUnknownFactors":3}',
 '{"requires_part2":"ineligible","requires_part3":"ineligible","requires_experience_years":"ineligible","commute_exceeds_limit":"ineligible","no_right_to_work":"ineligible","vacancy_closed":"ineligible","employer_suppressed":"ineligible"}',
 true, 'Proposed starting weights from the brief. Not validated hiring probabilities; revisit after 2–4 weeks of outcomes.')
on conflict (version) do nothing;

insert into public.settings (key, value, description) values
('stop_switch', 'true', 'When true, no outbound email is created or sent. Default on until the Gmail flow is proven.'),
('dry_run', 'true', 'When true, approved sends are simulated and recorded as delivery_result=simulated.'),
('daily_send_cap', '5', 'Maximum outbound emails per calendar day (Europe/London).'),
('weekly_send_cap', '20', 'Maximum outbound emails per rolling 7 days.'),
('follow_up_days', '7', 'Days after a sent email before a follow-up task is created (if no reply).'),
('approval_ttl_hours', '72', 'An approval older than this must be re-approved before sending.'),
('ai_daily_cap', '40', 'Maximum AI runs per day.'),
('daily_research_target', '10', 'How many employers you aim to research per day; drives the research queue size.'),
('gmail_labels', '{}', 'Gmail label ids created at connect time.'),
('scoring_weights_version', '1', 'Active scoring weights version.')
on conflict (key) do nothing;

insert into public.email_templates (code, version, purpose, subject_tmpl, body_tmpl, variables, notes) values
('speculative_intro', 1, 'speculative',
 'Speculative application — {{role_family_label}} | {{candidate_name}}',
 E'Dear {{greeting_name}},\n\n{{personalised_opener}}\n\nI am a University of Portsmouth architecture graduate based in London, looking for an entry-level position where I can contribute to drawing production, design development and model-making while continuing my professional development. {{skills_sentence}}\n\nI would be grateful for the opportunity to be considered for any current or upcoming {{role_family_label}} roles at {{employer_name}}. My CV is attached and a portfolio is available at {{portfolio_url}}.\n\nIf you would prefer not to receive further messages from me, please reply to say so and I will not contact you again.\n\nKind regards,\n{{candidate_name}}\n{{candidate_phone}}',
 '{greeting_name,personalised_opener,skills_sentence,role_family_label,employer_name,portfolio_url,candidate_name,candidate_phone}',
 'Default speculative introduction. The personalised opener must come from verified research notes.'),
('follow_up_1', 1, 'follow_up',
 'Re: {{original_subject}}',
 E'Dear {{greeting_name}},\n\nI wanted to follow up briefly on my message of {{sent_date}} regarding {{role_family_label}} opportunities at {{employer_name}}. I remain very interested in the practice{{relevance_clause}} and would welcome a short conversation if timing allows.\n\nThank you for your time.\n\nKind regards,\n{{candidate_name}}',
 '{greeting_name,original_subject,sent_date,role_family_label,employer_name,relevance_clause,candidate_name}',
 'Single polite follow-up after follow_up_days with no reply. No second follow-up without a human decision.'),
('advertised_vacancy', 1, 'advertised_vacancy',
 'Application: {{vacancy_title}} — {{candidate_name}}',
 E'Dear {{greeting_name}},\n\nPlease find attached my CV in application for the {{vacancy_title}} position advertised on {{vacancy_source}}.\n\n{{personalised_opener}}\n\n{{skills_sentence}}\n\nMy portfolio is available at {{portfolio_url}} and I am available to start from {{availability}}.\n\nKind regards,\n{{candidate_name}}\n{{candidate_phone}}',
 '{greeting_name,vacancy_title,vacancy_source,personalised_opener,skills_sentence,portfolio_url,availability,candidate_name,candidate_phone}',
 'Cover email for an advertised vacancy applied for by email.')
on conflict (code, version) do nothing;

insert into public.source_definitions (code, label, adapter_type, enabled, requires_env, schedule_cron, config, min_interval_ms, daily_request_cap, notes) values
('adzuna', 'Adzuna Jobs API', 'api', false, '{ADZUNA_APP_ID,ADZUNA_APP_KEY}', '15 6,18 * * *',
 '{"country":"gb","where":"London","distance_km":60,"max_days_old":14,"results_per_page":50,"pages":2,"attribution":"Jobs by Adzuna — https://www.adzuna.co.uk"}', 2500, 100,
 'Free developer key. 25/min, 250/day. Descriptions are truncated snippets: fetch the real posting (robots-checked) before scoring on skills. Show Adzuna attribution where ads are displayed.'),
('reed', 'Reed Jobseeker API', 'api', false, '{REED_API_KEY}', '25 6,18 * * *',
 '{"locationName":"London","distanceFromLocation":40,"resultsToTake":100,"graduate":true}', 1000, 200,
 'Basic auth, key as username. Rate limit unpublished — self-imposed 1 req/s, 200/day.'),
('riba_jobs_rss', 'RIBA Jobs RSS', 'feed', true, '{}', '5 */2 * * *',
 '{"feed_url":"https://jobs.architecture.com/jobsrss/","keywords":["Part 1","Part I","Architectural Assistant","Graduate","Technician","Junior"]}', 3000, 50,
 'Valid RSS 2.0 at /jobsrss/?keywords=… ; poll at most every 2 h.'),
('architecture_social', 'Architecture Social jobs sitemap', 'periodic_fetch_with_robots_check', true, '{}', '40 3 * * *',
 '{"sitemap_url":"https://www.architecturesocial.com/jobs-sitemap.xml","respect_lastmod":true}', 6000, 60,
 'Fetch only the jobs sitemap and job pages; never /api. Jobs are syndicated elsewhere — expect duplicates.'),
('ninebee_careers', '9B Careers (agency)', 'periodic_fetch_with_robots_check', true, '{}', '45 3 * * *',
 '{"listing_url":"https://www.9bcareers.com/jobs.aspx","max_pages":5,"posted_by_agency":true}', 3000, 40,
 'Recruitment agency; employers usually anonymised. Vacancies recorded as posted_by_agency.'),
('bd4jobs', 'BD4Jobs', 'periodic_fetch_with_robots_check', false, '{}', '50 3 * * *',
 '{"sitemap_url":"https://www.bd4jobs.com/sitemap.xml","crawl_delay_s":10}', 10000, 20, 'robots Crawl-delay 10. Listing was thin at research time; enable if useful.'),
('jobsgopublic', 'Jobs Go Public / LGjobs', 'periodic_fetch_with_robots_check', false, '{}', '55 3 * * *',
 '{"category_urls":["https://www.jobsgopublic.com/jobs/planning","https://www.jobsgopublic.com/jobs/architecture"],"crawl_delay_s":10}', 10000, 20,
 'robots Crawl-delay 10. Prefer email alerts; low-frequency keyword pages only.'),
('aj_jobs', 'AJ Jobs', 'periodic_fetch_with_robots_check', false, '{}', '0 4 * * *',
 '{"listing_url":"https://www.architectsjournaljobs.com/jobs/"}', 5000, 20, 'No RSS. robots checked at runtime. Prefer email alerts.'),
('email_alert_dezeen', 'Dezeen Jobs email alerts', 'email_alert_ingest', true, '{}', null,
 '{"sender_patterns":["dezeenjobs.com","dezeen.com"],"link_host_patterns":["dezeenjobs.com"]}', 0, null,
 'Dezeen Jobs blocks non-browser clients (WAF). Subscribe to its daily jobs email; links are extracted from the email, never fetched around the WAF.'),
('email_alert_indeed', 'Indeed job alert emails', 'email_alert_ingest', true, '{}', null,
 '{"sender_patterns":["indeed.com","indeed.co.uk"],"link_host_patterns":["indeed.com","indeed.co.uk"]}', 0, null, 'Indeed forbids scraping; alert emails only, vacancy pages are entered manually.'),
('email_alert_linkedin', 'LinkedIn job alert emails', 'email_alert_ingest', true, '{}', null,
 '{"sender_patterns":["linkedin.com"],"link_host_patterns":["linkedin.com"]}', 0, null, 'LinkedIn forbids scraping; alert emails only.'),
('email_alert_generic', 'Other job alert emails (AJ Jobs, BD4Jobs, JGP, practice newsletters)', 'email_alert_ingest', true, '{}', null,
 '{"sender_patterns":["architectsjournaljobs.com","bd4jobs.com","jobsgopublic.com","jobs.architecture.com"],"link_host_patterns":[]}', 0, null, null),
('companies_house', 'Companies House Public Data API', 'api', false, '{COMPANIES_HOUSE_API_KEY}', '0 4 * * 1',
 '{"base_url":"https://api.company-information.service.gov.uk","sic_codes":["71111","71112","71129","74100"]}', 600, 500,
 'Free key, Basic auth. 600 requests per 5 minutes. Register data is free to reuse. Verifies corporate identity; a director is not automatically the hiring contact.'),
('planit', 'PlanIt planning applications', 'api', true, '{}', '50 2 * * *',
 '{"base_url":"https://www.planit.org.uk/api/applics/json","pg_sz":100,"lookback_days":120}', 3000, 100,
 'No key. Search by agent name for hiring signals (practice named as planning agent). Honour 429 / Retry-After; descriptive User-Agent.'),
('postcodes_io', 'postcodes.io geocoding', 'api', true, '{}', null, '{"base_url":"https://api.postcodes.io"}', 200, null, 'Free, OGL.'),
('google_routes', 'Google Routes API (travel times)', 'api', false, '{GOOGLE_MAPS_API_KEY}', '0 5 1 * *',
 '{"arrive_by":"09:00","weekday":"tuesday","modes":["TRANSIT","DRIVE"]}', 300, 400, 'Essentials SKU: 10k free events/month. Primary provider for both modes.'),
('tfl', 'TfL Unified API (journey planner)', 'api', false, '{TFL_APP_KEY}', null, '{"base_url":"https://api.tfl.gov.uk"}', 300, 400,
 'Free key. Covers Zones A/B only (no results for Petersfield/Chichester). Used as a cross-check.'),
('riba_directory_manual', 'RIBA Find an Architect (manual lookups)', 'manual_import', true, '{}', null, '{"url":"https://www.architecture.com/find-an-architect"}', 0, null,
 'RIBA terms forbid reproducing or storing directory content. Look practices up manually, enter name + website; store only the directory URL as provenance.'),
('manual_import', 'Manual import (paste / CSV)', 'manual_import', true, '{}', null, '{}', 0, null, 'User-entered employers and vacancies.')
on conflict (code) do update set label = excluded.label, adapter_type = excluded.adapter_type, requires_env = excluded.requires_env,
  schedule_cron = excluded.schedule_cron, config = excluded.config, min_interval_ms = excluded.min_interval_ms, daily_request_cap = excluded.daily_request_cap, notes = excluded.notes;

-- Candidate profile singleton (details completed in Settings).
insert into public.candidate_profile (id, qualification, qualification_verified, university, experience_years, software, skills, sector_interests, target_role_families,
  accept_adjacent_entry_roles, objective, max_public_transport_minutes, max_car_minutes, has_uk_right_to_work)
values (true, 'part1_equivalent', false, 'University of Portsmouth', 0,
  '{AutoCAD,SketchUp,"Adobe Photoshop","Adobe InDesign","Revit (learning)"}',
  '{"Design development","Drawing production","Model making","Site analysis",Presentation}',
  '{residential,education,heritage,commercial,"public sector"}',
  '{part1_assistant,graduate_assistant,technician,technologist,bim_cad,design_coordinator,planning_assistant,urban_design_junior,visualisation,placement_internship,other_entry}',
  true, 'get_into_work_fast', 90, 90, true)
on conflict (id) do nothing;
