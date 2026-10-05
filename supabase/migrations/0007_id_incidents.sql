-- PLAN 4.2. Journal of the readable ids an agent answer cites but that do not exist (SPEC §10.7,
-- CL-28): the chat shows them as « ID inconnu » and records one row per id and message, so
-- eval:guardrails and the Évals screen can count them.
create table public.id_incidents (
  id bigint generated always as identity primary key,
  thread_id uuid references public.threads (id) on delete set null,
  cited_id text not null,
  -- The sentence around the id, to see what the model claimed (bounded by the application).
  excerpt text,
  created_at timestamptz not null default now()
);
create index id_incidents_created_at_idx on public.id_incidents (created_at desc);

-- Server-side only, like every table (0001): RLS on, no policy; only the service role reads it.
alter table public.id_incidents enable row level security;
