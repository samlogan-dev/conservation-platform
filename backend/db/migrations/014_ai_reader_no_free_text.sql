-- Ethics pillar 2: free text is not sent to an LLM unscreened. occurrence_remarks and event_remarks
-- are contributor-written and can name people, and the AI arm could read them — through the view
-- and, by 004's schema-wide grant, the base table. One pilot query read 28 remarks (none
-- identifying); the access itself was the gap.
--
-- corpus.restrict_ai_reader() grants ai_reader every column of occurrences and of the analysable
-- view except the free-text ones. Recreating a view re-grants it in full (default privileges), so
-- the migration runner calls this function after every run of migrations, not only here.
create function corpus.restrict_ai_reader() returns void language plpgsql as $$
declare
  rel text;
  cols text;
begin
  foreach rel in array array['occurrences', 'analysable_occurrences'] loop
    execute format('revoke select on corpus.%I from ai_reader', rel);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
    where table_schema = 'corpus' and table_name = rel
      and column_name not in ('occurrence_remarks', 'event_remarks');
    execute format('grant select (%s) on corpus.%I to ai_reader', cols, rel);
  end loop;
end $$;

select corpus.restrict_ai_reader();
