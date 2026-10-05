-- PLAN 4.3. Backlog drafting (SPEC §9).
-- A technical task lists its risks (§9.3) and every item its dependencies (Definition of Ready, §9.4):
-- ids of other backlog items (US-, BUG-, TT-).
alter table public.backlog_items add column risks jsonb not null default '[]';
alter table public.backlog_items add column dependencies text[] not null default '{}';

-- The last drafting of an insight's backlog: the format proposed by the code, the one chosen by
-- the model and its reason when they differ, the discoverability action when nothing goes into the
-- backlog, and the total of the items against the insight's range. Null: never drafted.
alter table public.insights add column backlog_plan jsonb;
