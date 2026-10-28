-- 24: a recorded reason lets Erin approach an employer again before the cooldown ends (otherwise repeat outreach is held back).
alter table public.priority_items add column recontact_reason text, add column recontact_at timestamptz;
