-- 25: Stage 4 vocabulary. Added on their own so later migrations can use the new values.
alter type public.application_stage add value if not exists 'selected' before 'preparing';
alter type public.application_stage add value if not exists 'awaiting_response' after 'submitted';
alter type public.application_stage add value if not exists 'assessment' after 'further_interview';
alter type public.application_stage add value if not exists 'offer_declined' after 'offer_accepted';
alter type public.application_stage add value if not exists 'vacancy_closed' after 'withdrawn';

alter type public.notification_kind add value if not exists 'application_deadline';
alter type public.notification_kind add value if not exists 'prepared_not_submitted';
alter type public.notification_kind add value if not exists 'follow_up_due';
alter type public.notification_kind add value if not exists 'interview_upcoming';
alter type public.notification_kind add value if not exists 'thank_you_due';
alter type public.notification_kind add value if not exists 'info_requested';
alter type public.notification_kind add value if not exists 'offer_decision';

alter type public.activity_type add value if not exists 'interview_invitation';
alter type public.activity_type add value if not exists 'assessment_request';
alter type public.activity_type add value if not exists 'employer_feedback';
alter type public.activity_type add value if not exists 'offer';
alter type public.activity_type add value if not exists 'submission_confirmation';
