-- The AI arm's database role: read-only, corpus only, bounded.
--
-- The role itself (with its password) is created by the migration runner from AI_READER_PASSWORD,
-- because a migration file cannot carry a secret. This file only grants and constrains, so it is
-- safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_reader') then
    raise exception 'role ai_reader missing — run the migration runner, which creates it first';
  end if;
end $$;

-- Read the corpus and nothing else. PostGIS functions live in public, which every role can use.
grant usage on schema corpus to ai_reader;
grant select on all tables in schema corpus to ai_reader;
alter default privileges in schema corpus grant select on tables to ai_reader;

revoke all on schema analysis from ai_reader;
revoke all on all tables in schema analysis from ai_reader;

-- Bounded: every transaction read-only, every statement time-limited, every lock wait short.
alter role ai_reader set default_transaction_read_only = on;
alter role ai_reader set statement_timeout = '30s';
alter role ai_reader set lock_timeout = '2s';
alter role ai_reader set idle_in_transaction_session_timeout = '60s';
alter role ai_reader set search_path = corpus, public;
alter role ai_reader connection limit 4;
