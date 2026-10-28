-- Advisor lint 0011: pin the search_path of the report-immutability trigger function.
alter function public.fn_insight_reports_immutable() set search_path = public;
