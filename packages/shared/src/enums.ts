/**
 * Enumerations mirrored 1:1 with the Postgres enums in supabase/migrations/*_enums.sql.
 * Keep both in sync: a new value here needs an `alter type ... add value` migration.
 */

export const EMPLOYER_OUTREACH_STAGES = [
  "discovered",
  "awaiting_research",
  "research_in_progress",
  "verified_eligible",
  "ready_to_contact",
  "contact_approved",
  "email_sent",
  "follow_up_due",
  "replied",
  "conversation_in_progress",
  "cv_requested",
  "informal_interview",
  "opportunity_identified",
  "closed_no_opportunity",
  "suppressed",
] as const;
export type EmployerOutreachStage = (typeof EMPLOYER_OUTREACH_STAGES)[number];
export const TERMINAL_OUTREACH_STAGES: readonly EmployerOutreachStage[] = [
  "closed_no_opportunity",
  "suppressed",
];

export const APPLICATION_STAGES = [
  "vacancy_discovered",
  "eligibility_checked",
  "selected",
  "preparing",
  "ready_to_submit",
  "submitted",
  "awaiting_response",
  "acknowledged",
  "shortlisted",
  "interview_1",
  "further_interview",
  "assessment",
  "offer_received",
  "offer_accepted",
  "offer_declined",
  "rejected",
  "withdrawn",
  "vacancy_closed",
  "closed_without_response",
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const TERMINAL_APPLICATION_STAGES: readonly ApplicationStage[] = [
  "offer_accepted",
  "offer_declined",
  "rejected",
  "withdrawn",
  "vacancy_closed",
  "closed_without_response",
];
export const ACTIVE_APPLICATION_STAGES: readonly ApplicationStage[] = [
  "submitted",
  "awaiting_response",
  "acknowledged",
  "shortlisted",
  "interview_1",
  "further_interview",
  "assessment",
  "offer_received",
];

export const EVIDENCE_STATUSES = [
  "verified_fact",
  "source_supported_summary",
  "inference",
  "unverified",
  "conflicting_sources",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_TYPES = [
  "primary_official",
  "government_record",
  "directory",
  "job_board",
  "recruiter",
  "secondary_reputable",
  "user_provided",
  "ai_inference",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const PRACTICE_TYPES = [
  "architecture_practice",
  "architectural_technologists",
  "multidisciplinary_consultancy",
  "interior_workplace_design",
  "urban_design_masterplanning",
  "heritage_conservation",
  "planning_consultancy",
  "residential_developer",
  "commercial_developer",
  "housing_association",
  "local_authority",
  "construction_design_build",
  "building_surveying",
  "bim_visualisation_studio",
  "university_research",
  "specialist_consultancy",
  "recruitment_agency",
  "other",
] as const;
export type PracticeType = (typeof PRACTICE_TYPES)[number];

export const SIZE_BANDS = ["1_5", "6_20", "21_50", "51_200", "201_1000", "1000_plus", "unknown"] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

export const DATA_QUALITY = ["poor", "fair", "good", "verified"] as const;
export type DataQuality = (typeof DATA_QUALITY)[number];

export const SCORE_BANDS = ["A", "B", "C", "research_further"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];

export const OFFICE_TYPES = ["hq", "studio", "regional", "site_office", "registered_office_only"] as const;
export const OFFICE_STATUSES = ["active", "closed", "unverified"] as const;
export const WORKING_ARRANGEMENTS = ["office", "hybrid", "remote", "unknown"] as const;
export type WorkingArrangement = (typeof WORKING_ARRANGEMENTS)[number];

export const TRAVEL_MODES = ["public_transport", "car"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_PROVIDERS = ["google_routes", "tfl", "traveltime", "manual"] as const;

export const ROLE_CATEGORIES = [
  "director_partner",
  "associate",
  "hr_recruitment",
  "studio_practice_manager",
  "team_leader",
  "graduate_coordinator",
  "general_inbox",
  "other",
] as const;
export const HIRING_AUTHORITY = ["decision_maker", "influencer", "gatekeeper", "unknown"] as const;
export const EMAIL_VERIFICATION = ["unverified", "pattern_inferred", "confirmed_by_reply", "bounced"] as const;
export const CONTACT_CHANNELS = ["email", "phone", "linkedin", "contact_form", "in_person"] as const;
export const RELATIONSHIP_STATUSES = ["none", "contacted", "replied", "warm", "met"] as const;

export const DISCOVERY_STATES = ["new", "saved", "dismissed"] as const;
export type DiscoveryState = (typeof DISCOVERY_STATES)[number];

export const VACANCY_STATUSES = ["open", "closing_soon", "closed", "filled", "withdrawn", "unverified"] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export const EMPLOYMENT_TYPES = [
  "permanent",
  "fixed_term",
  "temporary",
  "contract",
  "internship",
  "placement",
  "apprenticeship",
  "freelance",
  "part_time",
  "unknown",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const SENIORITIES = ["entry", "junior", "mid", "senior", "unknown"] as const;
export type Seniority = (typeof SENIORITIES)[number];
export const QUALIFICATIONS_REQUIRED = ["none", "part1", "part2", "part3", "technician", "other", "unknown"] as const;
export type QualificationRequired = (typeof QUALIFICATIONS_REQUIRED)[number];
export const SALARY_PERIODS = ["year", "month", "week", "day", "hour", "unknown"] as const;
export const APPLICATION_ROUTES = ["email", "portal", "ats", "agency", "linkedin", "unknown"] as const;
export const EMPLOYER_MATCH_STATUSES = ["pending", "matched", "unmatched", "agency_anonymised"] as const;
export const ELIGIBILITY_STATUSES = ["eligible", "ineligible", "needs_review"] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const ROLE_FAMILIES = [
  "part1_assistant",
  "part2_assistant",
  "architect_part3",
  "graduate_assistant",
  "technician",
  "technologist",
  "bim_cad",
  "design_coordinator",
  "planning_assistant",
  "urban_design_junior",
  "visualisation",
  "placement_internship",
  "other_entry",
  "senior_or_unsuitable",
  "unknown",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

export const APPLICATION_TYPES = ["advertised", "speculative", "referral", "graduate_programme", "direct"] as const;
export const INTERVIEW_FORMATS = ["phone", "video", "in_person", "portfolio_review", "assessment"] as const;

export const ACTIVITY_TYPES = [
  "research",
  "email_draft_created",
  "email_sent",
  "email_received",
  "bounce_received",
  "opt_out_received",
  "call",
  "linkedin_message",
  "meeting",
  "interview",
  "note",
  "application_submitted",
  "follow_up",
  "system",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const DIRECTIONS = ["outbound", "inbound", "internal"] as const;
export const CHANNELS = ["email", "phone", "linkedin", "in_person", "portal", "system"] as const;
export const DELIVERY_RESULTS = [
  "pending",
  "drafted",
  "approved",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "blocked",
  "cancelled",
  "simulated",
] as const;
export type DeliveryResult = (typeof DELIVERY_RESULTS)[number];
export const APPROVAL_STATUSES = ["not_required", "pending_approval", "approved", "rejected"] as const;
export const THREAD_STATUSES = ["awaiting_reply", "replied", "closed", "bounced"] as const;

export const SUPPRESSION_SCOPES = ["email", "domain", "employer", "contact"] as const;
export const SUPPRESSION_REASONS = [
  "opt_out",
  "hard_bounce",
  "requested_no_contact",
  "legal",
  "user_decision",
  "duplicate",
] as const;

export const SIGNAL_TYPES = [
  "vacancy_posted",
  "careers_page_changed",
  "new_office",
  "office_relocation",
  "project_win",
  "project_announcement",
  "planning_agent_activity",
  "award",
  "press",
  "headcount_growth",
  "new_staff_profiles",
  "senior_role_advertised",
  "graduate_recruitment_announcement",
  "social_hiring_post",
  "leadership_change",
  "vacancy_reappeared",
] as const;
export const SIGNAL_STRENGTHS = ["weak", "moderate", "strong"] as const;

export const SOURCE_ADAPTER_TYPES = [
  "api",
  "feed",
  "periodic_fetch_with_robots_check",
  "email_alert_ingest",
  "manual_import",
] as const;
export type SourceAdapterType = (typeof SOURCE_ADAPTER_TYPES)[number];
export const SOURCE_RUN_STATUSES = ["running", "succeeded", "partial", "failed", "skipped_robots", "rate_limited"] as const;
export const FETCH_STATUSES = ["never", "ok", "unchanged", "changed", "error", "forbidden", "gone", "disabled"] as const;
export const CLAIM_EXTRACTORS = ["human", "adapter", "ai"] as const;
export const CLAIM_ENTITY_TYPES = ["employer", "office", "contact", "vacancy", "research_note", "hiring_signal"] as const;

export const TASK_TYPES = [
  "research",
  "verify_vacancy",
  "verify_employer",
  "contact_approval",
  "follow_up",
  "apply",
  "prepare_documents",
  "review_stale",
  "resolve_duplicate",
  "gmail_reauth",
  "data_quality",
  "interview_prep",
  "other",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export const TASK_STATUSES = ["open", "in_progress", "snoozed", "done", "cancelled"] as const;

export const DOCUMENT_KINDS = ["cv", "portfolio", "cover_letter", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const TEMPLATE_PURPOSES = [
  "advertised_vacancy",
  "speculative",
  "graduate_programme",
  "recruiter",
  "follow_up",
  "thank_you",
] as const;
export const AI_PURPOSES = ["employer_briefing", "vacancy_extraction", "fit_note", "email_draft"] as const;
export const OAUTH_STATUSES = ["active", "needs_reauth", "revoked"] as const;
export const IMPORT_KINDS = ["csv_employers", "csv_vacancies", "pasted_vacancy", "pasted_employer", "email_alert"] as const;

export const CANDIDATE_QUALIFICATIONS = [
  "part1_equivalent",
  "part1",
  "part2",
  "part3",
  "architectural_technology",
  "student",
  "other",
] as const;
export type CandidateQualification = (typeof CANDIDATE_QUALIFICATIONS)[number];

export const GEO_ZONE_CODES = ["A", "B", "C", "EXT", "OUT"] as const;
export type GeoZoneCode = (typeof GEO_ZONE_CODES)[number];

export const PIPELINES = ["employer_outreach", "application"] as const;
