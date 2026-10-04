-- The efficiency half of the evaluation (4 Oct 2026): for one calculated run, the steps the unaided
-- route — ALA's search and download, one taxon at a time — would take to reproduce its insights,
-- beside what the platform took. A model with stated assumptions, versioned like the scorer.
create table if not exists analysis.manual_baselines (
  baseline_id       bigserial primary key,
  calculated_run_id uuid not null references analysis.runs (run_id),
  model_version     text not null,
  steps             jsonb not null,
  totals            jsonb not null,
  platform          jsonb not null,
  created_at        timestamptz not null default now()
);
