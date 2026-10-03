-- PLAN 2.6. The incremental mode re-judges only the insights it touched; the others keep the
-- model's judgment of their current score, stored here as validated (zod) JSON. Null: unknown
-- (scores written before this migration), the insight is judged again.
alter table public.scores add column judgment jsonb;
