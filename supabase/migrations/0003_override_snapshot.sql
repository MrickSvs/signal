-- PLAN 2.5. CL-22: an override is flagged « contexte modifié » when more than 30 % of the insight's
-- feedbacks changed since it was set; the set of feedbacks at that time is kept here (null: unknown).
alter table public.overrides add column feedback_ids text[];

-- SPEC §8.5: an overridden parameter replaces the estimate but its original value stays visible.
-- { "<param>": { "original": <computed value>, "value": <override value> } }
alter table public.scores add column overridden jsonb not null default '{}';
