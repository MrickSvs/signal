-- Signal: initial schema (SPEC §7).
-- Applied migrations are never edited: any schema change goes into a new migration.
-- Access is server-side only (service role). RLS is enabled without policies so the
-- public anon key can read nothing; the service role bypasses RLS.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Readable identifiers (R-001, I-01, US-001…). Sequences never reuse a value.
-- ---------------------------------------------------------------------------

create function public.format_readable_id(prefix text, n bigint, width int)
returns text
language sql
immutable
set search_path = ''
as $$
  select prefix || '-' || case
    when length(n::text) >= width then n::text
    else lpad(n::text, width, '0')
  end
$$;

create sequence public.customer_id_seq;
create sequence public.feedback_id_seq;
create sequence public.insight_id_seq;
create sequence public.epic_id_seq;
create sequence public.story_id_seq;
create sequence public.bug_id_seq;
create sequence public.task_id_seq;
create sequence public.decision_id_seq;
create sequence public.reference_ticket_id_seq start 101;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.customer_status as enum ('client', 'prospect');
create type public.customer_segment as enum ('agence_com', 'agence_digitale', 'conseil', 'pme_services', 'hors_cible');
create type public.customer_plan as enum ('free', 'pro', 'business', 'enterprise');
create type public.customer_health as enum ('vert', 'orange', 'rouge');

create type public.feedback_channel as enum (
  'email_client', 'ticket_support', 'commentaire_in_app', 'nps', 'note_csm', 'note_sales', 'slack_interne'
);
create type public.feedback_source_type as enum ('client_direct', 'support', 'interne');
create type public.analysis_status as enum ('ok', 'failed');
create type public.urgency as enum ('basse', 'moyenne', 'haute', 'critique');
create type public.item_type as enum (
  'bug', 'demande_fonctionnelle', 'irritant_ux', 'question', 'eloge', 'signal_churn', 'autre'
);
create type public.product_area as enum (
  'taches', 'tableau_kanban', 'notifications', 'permissions_partage', 'reporting_export',
  'planification', 'integrations', 'facturation_temps', 'personnalisation', 'performance', 'autre'
);

create type public.insight_origin as enum ('retours', 'manuel');
create type public.insight_status as enum ('propose', 'actif', 'fusionne', 'rejete', 'archive');
create type public.insight_relation_kind as enum ('tension');

create type public.tshirt_size as enum ('S', 'M', 'L', 'XL');
create type public.confidence_level as enum ('basse', 'moyenne', 'haute');
create type public.reach_mode as enum ('comptes', 'mrr');
create type public.effort_source as enum ('estimation_initiale', 'backlog', 'manuel');
create type public.robustness as enum ('robuste', 'sensible', 'fragile');
create type public.alignment as enum ('aligne', 'neutre', 'hors_strategie');
create type public.moscow as enum ('must', 'should', 'could', 'wont');
create type public.override_param as enum ('reach', 'impact', 'confidence', 'effort', 'moscow');

create type public.decision_actor as enum ('po', 'signal');
create type public.decision_source as enum ('signal_ui', 'chat', 'notion');
create type public.decision_action as enum (
  'override', 'validation', 'rejet', 'modification', 'desaccord', 'conflit', 'ajustement'
);

create type public.backlog_kind as enum ('story', 'bug', 'tache');
create type public.bug_severity as enum ('bloquant', 'majeur', 'mineur');
create type public.backlog_status as enum ('brouillon', 'valide', 'envoye', 'modifie_notion', 'rejete');

create type public.alert_kind as enum ('nouveau_sujet', 'emergent', 'churn', 'bug_critique', 'engagement');
create type public.alert_status as enum ('nouvelle', 'vue', 'traitee', 'ignoree');
create type public.dossier_status as enum ('en_cours', 'pret', 'echec');

create type public.run_kind as enum ('full', 'incremental', 'digest', 'eval');
create type public.run_status as enum ('en_cours', 'termine', 'echec');

create type public.notion_data_source as enum ('retours', 'insights', 'backlog');

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  kind public.run_kind not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status public.run_status not null default 'en_cours',
  stats jsonb not null default '{}',
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_eur numeric(10, 4) not null default 0,
  langfuse_url text
);
create index pipeline_runs_started_at_idx on public.pipeline_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Customers and feedbacks
-- ---------------------------------------------------------------------------

create table public.customers (
  id text primary key default public.format_readable_id('C', nextval('public.customer_id_seq'), 3),
  name text not null,
  status public.customer_status not null default 'client',
  segment public.customer_segment not null,
  plan public.customer_plan,
  seats int check (seats >= 0),
  mrr_eur numeric(12, 2) not null default 0,
  renewal_date date,
  health public.customer_health,
  csm text,
  email_domain text,
  created_at timestamptz not null default now()
);
create index customers_email_domain_idx on public.customers (lower(email_domain));
create index customers_plan_idx on public.customers (plan);
create index customers_segment_idx on public.customers (segment);

create table public.feedbacks (
  id text primary key default public.format_readable_id('R', nextval('public.feedback_id_seq'), 3),
  channel public.feedback_channel not null,
  source_type public.feedback_source_type not null,
  author_name text,
  author_email text,
  customer_id text references public.customers (id) on delete set null,
  received_at timestamptz not null,
  subject text,
  raw_text text not null,
  truncated boolean not null default false,
  language text,
  nps_score smallint check (nps_score between 0 and 10),
  ingested_run_id uuid references public.pipeline_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index feedbacks_channel_idx on public.feedbacks (channel);
create index feedbacks_customer_id_idx on public.feedbacks (customer_id);
create index feedbacks_received_at_idx on public.feedbacks (received_at desc);

create table public.feedback_analyses (
  feedback_id text not null references public.feedbacks (id) on delete cascade,
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  model text not null,
  status public.analysis_status not null,
  error text,
  sentiment smallint check (sentiment between -2 and 2),
  urgency public.urgency,
  churn_signal boolean,
  injection_suspected boolean,
  confidence real check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  primary key (feedback_id, run_id)
);
create index feedback_analyses_run_id_idx on public.feedback_analyses (run_id);
create index feedback_analyses_status_idx on public.feedback_analyses (status);
create index feedback_analyses_injection_idx on public.feedback_analyses (feedback_id) where injection_suspected;

create table public.feedback_items (
  id text primary key generated always as (feedback_id || '.' || item_index::text) stored,
  feedback_id text not null references public.feedbacks (id) on delete cascade,
  item_index smallint not null check (item_index between 1 and 3),
  type public.item_type not null,
  product_area public.product_area not null,
  tags text[] not null default '{}' check (cardinality(tags) <= 3),
  expressed_request text,
  underlying_problem text not null,
  summary text not null,
  existing_feature boolean not null default false,
  embedding extensions.vector(1024),
  watch boolean not null default false,
  created_at timestamptz not null default now(),
  unique (feedback_id, item_index)
);
create index feedback_items_feedback_id_idx on public.feedback_items (feedback_id);
create index feedback_items_type_idx on public.feedback_items (type);
create index feedback_items_product_area_idx on public.feedback_items (product_area);
create index feedback_items_watch_idx on public.feedback_items (feedback_id) where watch;
create index feedback_items_embedding_idx on public.feedback_items
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Insights
-- ---------------------------------------------------------------------------

create table public.insights (
  id text primary key default public.format_readable_id('I', nextval('public.insight_id_seq'), 2),
  origin public.insight_origin not null default 'retours',
  title text not null,
  problem_statement text not null,
  product_area public.product_area,
  expressed_requests jsonb not null default '[]',
  segments_breakdown jsonb not null default '{}',
  accounts_count int not null default 0,
  mrr_exposed numeric(12, 2) not null default 0,
  renewals_90d int not null default 0,
  channels jsonb not null default '{}',
  trend jsonb not null default '{}',
  ranked boolean not null default false,
  status public.insight_status not null default 'propose',
  title_locked boolean not null default false,
  merged_into text references public.insights (id) on delete set null,
  first_run_id uuid references public.pipeline_runs (id) on delete set null,
  last_run_id uuid references public.pipeline_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index insights_status_idx on public.insights (status);

create table public.insight_items (
  insight_id text not null references public.insights (id) on delete cascade,
  item_id text not null references public.feedback_items (id) on delete cascade,
  feedback_id text not null references public.feedbacks (id) on delete cascade,
  similarity real,
  is_representative boolean not null default false,
  primary key (insight_id, item_id)
);
create index insight_items_item_id_idx on public.insight_items (item_id);
create index insight_items_feedback_id_idx on public.insight_items (feedback_id);

create table public.insight_relations (
  id uuid primary key default gen_random_uuid(),
  insight_a text not null references public.insights (id) on delete cascade,
  insight_b text not null references public.insights (id) on delete cascade,
  kind public.insight_relation_kind not null default 'tension',
  segments jsonb not null default '[]',
  rationale text,
  run_id uuid references public.pipeline_runs (id) on delete set null,
  check (insight_a <> insight_b),
  unique (insight_a, insight_b, kind)
);
create index insight_relations_insight_b_idx on public.insight_relations (insight_b);

-- ---------------------------------------------------------------------------
-- Estimation and scoring
-- ---------------------------------------------------------------------------

create table public.reference_tickets (
  id text primary key default public.format_readable_id('T', nextval('public.reference_ticket_id_seq'), 3),
  title text not null,
  description text not null,
  module text not null,
  components text[] not null default '{}',
  estimated_points int not null,
  actual_points int not null,
  actual_days numeric(6, 1),
  surprises text,
  shipped_at date,
  embedding extensions.vector(1024)
);
create index reference_tickets_embedding_idx on public.reference_tickets
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.complexity_estimates (
  id uuid primary key default gen_random_uuid(),
  insight_id text references public.insights (id) on delete cascade,
  item_id text, -- backlog item, FK added below
  problem_hash text not null,
  components text[] not null default '{}',
  points_min int,
  points_max int,
  tshirt_min public.tshirt_size,
  tshirt_max public.tshirt_size,
  confidence public.confidence_level,
  analogies jsonb not null default '[]',
  rationale text,
  risks jsonb not null default '[]',
  model text,
  created_at timestamptz not null default now(),
  check (points_min is null or points_max is null or points_min <= points_max)
);
create index complexity_estimates_problem_hash_idx on public.complexity_estimates (problem_hash);
create index complexity_estimates_insight_id_idx on public.complexity_estimates (insight_id);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  insight_id text not null references public.insights (id) on delete cascade,
  version int not null,
  reach_mode public.reach_mode not null,
  reach numeric not null,
  reach_detail jsonb not null default '{}',
  impact numeric not null check (impact in (0.25, 0.5, 1, 2, 3)),
  impact_rationale text,
  impact_evidence text[] not null default '{}',
  confidence numeric not null check (confidence between 0 and 1),
  confidence_detail jsonb not null default '{}',
  effort_weeks numeric not null check (effort_weeks > 0),
  effort_source public.effort_source not null,
  rice numeric not null,
  rank int,
  robustness public.robustness,
  robustness_detail jsonb not null default '{}',
  alignment public.alignment,
  alignment_rationale text,
  okr_refs text[] not null default '{}',
  moscow_reco public.moscow,
  moscow_rationale text,
  rule_flags jsonb not null default '[]',
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (insight_id, version)
);
create unique index scores_one_current_per_insight on public.scores (insight_id) where is_current;
create index scores_is_current_idx on public.scores (is_current);

create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  insight_id text not null references public.insights (id) on delete cascade,
  param public.override_param not null,
  value jsonb not null,
  reason text,
  active boolean not null default true,
  context_changed boolean not null default false,
  created_at timestamptz not null default now(),
  check (param = 'moscow' or length(trim(coalesce(reason, ''))) > 0)
);
create unique index overrides_one_active_per_param on public.overrides (insight_id, param) where active;

create table public.decisions (
  id text primary key default public.format_readable_id('D', nextval('public.decision_id_seq'), 3),
  actor public.decision_actor not null,
  source public.decision_source not null,
  entity_type text not null,
  entity_id text not null,
  action public.decision_action not null,
  field text,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index decisions_created_at_idx on public.decisions (created_at desc);
create index decisions_entity_idx on public.decisions (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Backlog
-- ---------------------------------------------------------------------------

create table public.epics (
  id text primary key default public.format_readable_id('E', nextval('public.epic_id_seq'), 2),
  insight_id text not null references public.insights (id) on delete cascade,
  title text not null,
  goal text,
  okr_refs text[] not null default '{}',
  kpis jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index epics_insight_id_idx on public.epics (insight_id);

create table public.backlog_items (
  id text primary key, -- US-001 / BUG-001 / TT-001, set by trigger from kind
  kind public.backlog_kind not null,
  epic_id text references public.epics (id) on delete set null,
  insight_id text references public.insights (id) on delete set null,
  title text not null,
  -- story
  value text,
  persona text,
  want text,
  success_kpi text,
  -- bug
  expected_behavior text,
  actual_behavior text,
  repro_steps jsonb,
  severity public.bug_severity,
  affected_accounts text[] not null default '{}',
  -- technical task
  objective text,
  definition_of_done jsonb,
  -- common
  business_rules jsonb not null default '[]',
  acceptance_criteria jsonb not null default '[]',
  points int,
  complexity_estimate_id uuid references public.complexity_estimates (id) on delete set null,
  evidence text[] not null default '{}',
  dor_checklist jsonb not null default '{}',
  status public.backlog_status not null default 'brouillon',
  push_error text,
  judge jsonb,
  prototype_id uuid, -- FK added below
  notion_page_id text,
  notion_status_raw text,
  edited_in_notion boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'bug' or epic_id is null)
);
create index backlog_items_insight_id_idx on public.backlog_items (insight_id);
create index backlog_items_epic_id_idx on public.backlog_items (epic_id);
create index backlog_items_status_idx on public.backlog_items (status);

create function public.set_backlog_item_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is null then
    new.id := case new.kind
      when 'story' then public.format_readable_id('US', nextval('public.story_id_seq'), 3)
      when 'bug' then public.format_readable_id('BUG', nextval('public.bug_id_seq'), 3)
      when 'tache' then public.format_readable_id('TT', nextval('public.task_id_seq'), 3)
    end;
  end if;
  return new;
end;
$$;

create trigger backlog_items_set_id
  before insert on public.backlog_items
  for each row execute function public.set_backlog_item_id();

alter table public.complexity_estimates
  add constraint complexity_estimates_item_id_fkey
  foreign key (item_id) references public.backlog_items (id) on delete set null;
create index complexity_estimates_item_id_idx on public.complexity_estimates (item_id);

create table public.prototypes (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.backlog_items (id) on delete cascade,
  storage_path text not null,
  size_bytes int,
  model text,
  generation_ms int,
  created_at timestamptz not null default now()
);
create index prototypes_item_id_idx on public.prototypes (item_id);

alter table public.backlog_items
  add constraint backlog_items_prototype_id_fkey
  foreign key (prototype_id) references public.prototypes (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Alerts, digests, PO state
-- ---------------------------------------------------------------------------

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  kind public.alert_kind not null,
  insight_id text references public.insights (id) on delete set null,
  feedback_ids text[] not null default '{}',
  dedup_key text not null unique,
  status public.alert_status not null default 'nouvelle',
  dossier jsonb,
  dossier_markdown text,
  dossier_status public.dossier_status,
  cost_eur numeric(10, 4),
  langfuse_url text,
  created_at timestamptz not null default now()
);
create index alerts_status_idx on public.alerts (status, created_at desc);

create table public.digests (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  content jsonb not null default '{}',
  markdown text,
  run_id uuid references public.pipeline_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index digests_period_end_idx on public.digests (period_end desc);

create table public.po_state (
  id boolean primary key default true check (id), -- single row
  last_seen_at timestamptz,
  last_digest_id uuid references public.digests (id) on delete set null
);
insert into public.po_state (id) values (true);

-- ---------------------------------------------------------------------------
-- Notion
-- ---------------------------------------------------------------------------

create table public.notion_links (
  entity_type text not null,
  entity_id text not null,
  notion_page_id text not null unique,
  data_source public.notion_data_source not null,
  last_pushed_at timestamptz,
  last_notion_edited_time timestamptz,
  primary key (entity_type, entity_id)
);

create table public.notion_sync_state (
  data_source public.notion_data_source primary key,
  cursor text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Evals and chat
-- ---------------------------------------------------------------------------

create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  eval_name text not null,
  config jsonb not null default '{}',
  sample_size int,
  metrics jsonb not null default '{}',
  cost_eur numeric(10, 4),
  langfuse_url text,
  git_sha text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index eval_runs_name_idx on public.eval_runs (eval_name, started_at desc);

create table public.eval_results (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid not null references public.eval_runs (id) on delete cascade,
  item_id text not null,
  expected jsonb,
  actual jsonb,
  score numeric,
  pass boolean
);
create index eval_results_run_idx on public.eval_results (eval_run_id);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  title text,
  page_context jsonb,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index threads_last_message_at_idx on public.threads (last_message_at desc);

-- ---------------------------------------------------------------------------
-- Access: server-side only
-- ---------------------------------------------------------------------------

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
revoke all on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('prototypes', 'prototypes', false)
on conflict (id) do nothing;
