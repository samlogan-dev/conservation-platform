-- 0.1° grid cells, as ALA assigns them: verified 3 Oct 2026 that ALA's `point-0.1` facet rounds
-- each coordinate to the nearest 0.1° (-42.526 → -42.5, 147.463 → 147.5). Cells are stored as a
-- numeric pair rather than ALA's text label, whose number formatting is not worth depending on,
-- and every occurrence carries the same rounding, so the effort join is exact.

drop table corpus.effort_cells;

create table corpus.effort_cells (
  cell_lat      numeric(4, 1) not null,
  cell_lon      numeric(4, 1) not null,
  period_start  date not null,
  period_end    date not null,
  -- All-taxa records in the cell and period, telemetry datasets excluded: the denominator for
  -- reporting rates (insight #3).
  records       integer not null,
  harvest_id    text not null,                 -- the frozen facet responses it came from
  primary key (cell_lat, cell_lon, period_start, period_end)
);

grant select on corpus.effort_cells to ai_reader;

-- Postgres rounds numeric halves away from zero where ALA (Java) rounds them up; the two differ
-- only for a coordinate exactly on a .x5 boundary.
alter table corpus.occurrences
  add column cell_lat numeric(4, 1) generated always as (round(decimal_latitude::numeric, 1)) stored,
  add column cell_lon numeric(4, 1) generated always as (round(decimal_longitude::numeric, 1)) stored;

create index occurrences_cell on corpus.occurrences (cell_lat, cell_lon);

-- The views selected o.* before these columns existed. Postgres cannot insert columns into a
-- view in place, so both are dropped and recreated (taxon_tiers depends on the other).
drop view corpus.taxon_tiers;
drop view corpus.analysable_occurrences;

create view corpus.analysable_occurrences as
select o.*, coalesce(d.kind, 'wild') as dataset_kind
from corpus.occurrences o
left join corpus.datasets d using (data_resource_uid)
where o.is_valid
  and o.event_date is not null
  and coalesce(d.kind, 'wild') <> 'telemetry';

create view corpus.taxon_tiers as
select t.taxon_concept_id,
       t.scientific_name,
       t.vernacular_name,
       t.national_status,
       count(a.record_id) filter (where a.event_date >= '2015-01-01') as records_since_2015,
       max(a.event_date) as last_record_at,
       count(a.record_id) filter (where a.event_date >= '2015-01-01') >= 100 as statistical_tier
from corpus.taxa t
left join corpus.analysable_occurrences a using (taxon_concept_id)
group by t.taxon_concept_id;

grant select on corpus.analysable_occurrences, corpus.taxon_tiers to ai_reader;
