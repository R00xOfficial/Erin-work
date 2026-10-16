-- 02: enums. Mirrored in packages/shared/src/enums.ts — keep in sync.
create type public.employer_outreach_stage as enum (
  'discovered','awaiting_research','research_in_progress','verified_eligible','ready_to_contact',
  'contact_approved','email_sent','follow_up_due','replied','conversation_in_progress','cv_requested',
  'informal_interview','opportunity_identified','closed_no_opportunity','suppressed');

create type public.application_stage as enum (
  'vacancy_discovered','eligibility_checked','preparing','ready_to_submit','submitted','acknowledged',
  'shortlisted','interview_1','further_interview','offer_received','offer_accepted','rejected','withdrawn',
  'closed_without_response');

create type public.pipeline_kind as enum ('employer_outreach','application');

create type public.evidence_status as enum ('verified_fact','source_supported_summary','inference','unverified','conflicting_sources');
create type public.evidence_type as enum ('primary_official','government_record','directory','job_board','recruiter','secondary_reputable','user_provided','ai_inference');

create type public.practice_type as enum (
  'architecture_practice','architectural_technologists','multidisciplinary_consultancy','interior_workplace_design',
  'urban_design_masterplanning','heritage_conservation','planning_consultancy','residential_developer','commercial_developer',
  'housing_association','local_authority','construction_design_build','building_surveying','bim_visualisation_studio',
  'university_research','specialist_consultancy','recruitment_agency','other');

create type public.size_band as enum ('1_5','6_20','21_50','51_200','201_1000','1000_plus','unknown');
create type public.data_quality as enum ('poor','fair','good','verified');
create type public.score_band as enum ('A','B','C','research_further');
create type public.yes_no_unknown as enum ('yes','no','unknown');

create type public.office_type as enum ('hq','studio','regional','site_office','registered_office_only');
create type public.office_status as enum ('active','closed','unverified');
create type public.working_arrangement as enum ('office','hybrid','remote','unknown');
create type public.travel_mode as enum ('public_transport','car');
create type public.travel_provider as enum ('google_routes','tfl','traveltime','manual');

create type public.role_category as enum ('director_partner','associate','hr_recruitment','studio_practice_manager','team_leader','graduate_coordinator','general_inbox','other');
create type public.hiring_authority as enum ('decision_maker','influencer','gatekeeper','unknown');
create type public.email_verification as enum ('unverified','pattern_inferred','confirmed_by_reply','bounced');
create type public.contact_channel as enum ('email','phone','linkedin','contact_form','in_person');
create type public.relationship_status as enum ('none','contacted','replied','warm','met');

create type public.vacancy_status as enum ('open','closing_soon','closed','filled','withdrawn','unverified');
create type public.employment_type as enum ('permanent','fixed_term','temporary','contract','internship','placement','apprenticeship','freelance','part_time','unknown');
create type public.seniority as enum ('entry','junior','mid','senior','unknown');
create type public.qualification_required as enum ('none','part1','part2','part3','technician','other','unknown');
create type public.salary_period as enum ('year','month','week','day','hour','unknown');
create type public.application_route as enum ('email','portal','ats','agency','linkedin','unknown');
create type public.employer_match_status as enum ('pending','matched','unmatched','agency_anonymised');
create type public.eligibility_status as enum ('eligible','ineligible','needs_review');
create type public.role_family as enum (
  'part1_assistant','part2_assistant','architect_part3','graduate_assistant','technician','technologist','bim_cad',
  'design_coordinator','planning_assistant','urban_design_junior','visualisation','placement_internship','other_entry',
  'senior_or_unsuitable','unknown');

create type public.application_type as enum ('advertised','speculative','referral','graduate_programme','direct');
create type public.interview_format as enum ('phone','video','in_person','portfolio_review','assessment');
create type public.interview_outcome as enum ('pending','progressed','rejected','offer','withdrawn');

create type public.activity_type as enum (
  'research','email_draft_created','email_sent','email_received','bounce_received','opt_out_received','call',
  'linkedin_message','meeting','interview','note','application_submitted','follow_up','system');
create type public.direction as enum ('outbound','inbound','internal');
create type public.channel as enum ('email','phone','linkedin','in_person','portal','system');
create type public.delivery_result as enum ('pending','drafted','approved','sending','sent','delivered','bounced','failed','blocked','cancelled','simulated');
create type public.approval_status as enum ('not_required','pending_approval','approved','rejected');
create type public.thread_status as enum ('awaiting_reply','replied','closed','bounced');

create type public.suppression_scope as enum ('email','domain','employer','contact');
create type public.suppression_reason as enum ('opt_out','hard_bounce','requested_no_contact','legal','user_decision','duplicate');

create type public.signal_type as enum (
  'vacancy_posted','careers_page_changed','new_office','office_relocation','project_win','project_announcement',
  'planning_agent_activity','award','press','headcount_growth','new_staff_profiles','senior_role_advertised',
  'graduate_recruitment_announcement','social_hiring_post','leadership_change','vacancy_reappeared');
create type public.signal_strength as enum ('weak','moderate','strong');

create type public.source_adapter_type as enum ('api','feed','periodic_fetch_with_robots_check','email_alert_ingest','manual_import');
create type public.source_run_status as enum ('running','succeeded','partial','failed','skipped_robots','rate_limited');
create type public.fetch_status as enum ('never','ok','unchanged','changed','error','forbidden','gone','disabled');
create type public.claim_extractor as enum ('human','adapter','ai');
create type public.claim_entity_type as enum ('employer','office','contact','vacancy','research_note','hiring_signal');

create type public.task_type as enum (
  'research','verify_vacancy','verify_employer','contact_approval','follow_up','apply','prepare_documents','review_stale',
  'resolve_duplicate','gmail_reauth','data_quality','interview_prep','other');
create type public.task_priority as enum ('high','normal','low');
create type public.task_status as enum ('open','in_progress','snoozed','done','cancelled');

create type public.document_kind as enum ('cv','portfolio','cover_letter','other');
create type public.template_purpose as enum ('advertised_vacancy','speculative','graduate_programme','recruiter','follow_up','thank_you');
create type public.ai_purpose as enum ('employer_briefing','vacancy_extraction','fit_note','email_draft');
create type public.ai_run_status as enum ('running','succeeded','failed','rejected_by_validation');
create type public.oauth_status as enum ('active','needs_reauth','revoked');
create type public.import_kind as enum ('csv_employers','csv_vacancies','pasted_vacancy','pasted_employer','email_alert');
create type public.import_row_result as enum ('created','merged','duplicate','rejected');
create type public.candidate_qualification as enum ('part1_equivalent','part1','part2','part3','architectural_technology','student','other');
create type public.job_request_status as enum ('pending','picked_up','done','failed');
