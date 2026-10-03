-- Analysis output from both arms, in one shape so the two can be compared by matching keys
-- rather than by reading prose. The AI arm's role has no access to this schema: it must not see
-- the calculated arm's answers.

create schema analysis;

-- One execution of an arm over the corpus.
create table analysis.runs (
  run_id          uuid primary key default gen_random_uuid(),
  arm             text not null check (arm in ('calculated', 'ai')),
  -- AI arm only: whether it was asked for the five insights by name, or given an open brief.
  brief           text check (brief in ('guided', 'open')),
  -- Which corpus it read: the harvest runs loaded at the time, so a run can be reproduced.
  corpus          jsonb not null,
  params          jsonb not null default '{}',
  model           text,                         -- logged on every AI run, never assumed
  prompt_version  text,
  temperature     double precision,             -- null where the model refused the parameter
  usage           jsonb,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running', 'done', 'failed')),
  error           text,
  check ((arm = 'ai') = (brief is not null))
);

-- Every query the AI arm ran, so each claim can be traced to one and the query re-run.
create table analysis.ai_queries (
  query_id      bigserial primary key,
  run_id        uuid not null references analysis.runs (run_id),
  sql           text not null,
  row_count     integer,
  truncated     boolean not null default false,
  result_hash   text,                           -- sha256 of the full result, for re-run checks
  error         text,
  duration_ms   integer,
  executed_at   timestamptz not null default now()
);

create index ai_queries_run on analysis.ai_queries (run_id);

-- The shared insight record.
create table analysis.insights (
  insight_id        bigserial primary key,
  run_id            uuid not null references analysis.runs (run_id),
  insight_type      text not null check (insight_type in
                      ('silent_species', 'range_change', 'reporting_rate', 'co_movement',
                       'notable_record', 'other')),
  taxon_concept_id  text,                       -- null for region-level insights
  region            text,                       -- IBRA region, state, or null for national
  period_start      date not null,
  period_end        date not null,
  figures           jsonb not null default '{}',
  confidence        jsonb not null default '{}', -- record volume, dataset mix, share obscured
  summary           text not null,
  -- AI arm: the logged queries supporting this insight. Calculated arm: empty.
  query_ids         bigint[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index insights_match on analysis.insights
  (insight_type, taxon_concept_id, region, period_start, period_end);
