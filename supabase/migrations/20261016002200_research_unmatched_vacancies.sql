-- 22: a vacancy can be researched and assessed before its employer has been matched (Stage 1 allows employer-less vacancies).
alter table public.assessments alter column employer_id drop not null;
alter table public.assessments add constraint assessments_entity_chk check (employer_id is not null or vacancy_id is not null);
alter table public.research_runs alter column employer_id drop not null;
alter table public.research_runs add constraint research_runs_entity_chk check (employer_id is not null or vacancy_id is not null);
