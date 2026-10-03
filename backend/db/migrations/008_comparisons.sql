-- One row per scoring of an AI run against a calculated run: the three layers of the evaluation
-- design (reproduction, discovery, grounding), with per-insight detail kept for adjudication.
create table analysis.comparisons (
  comparison_id     bigserial primary key,
  ai_run_id         uuid not null references analysis.runs (run_id),
  calculated_run_id uuid not null references analysis.runs (run_id),
  scorer_version    text not null,
  summary           jsonb not null,
  details           jsonb not null,
  created_at        timestamptz not null default now()
);
