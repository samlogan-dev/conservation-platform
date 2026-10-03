-- The corpus: what the sources sent, as canonical records, plus the reference tables the
-- analysis groups by. Both analysis arms read this schema; the AI arm's role can read nothing
-- else (see 003_ai_reader.sql).

create extension if not exists postgis;

create schema corpus;

-- One row per harvest run. The frozen snapshot on disk is the evidence; this is its index.
create table corpus.harvest_runs (
  harvest_id        text primary key,          -- `${harvestKey}/${runId}`
  harvest_key       text not null,
  run_id            text not null,
  source            text not null,
  description       text,
  query             jsonb not null,
  started_at        timestamptz not null,
  finished_at       timestamptz not null,
  expected_records  integer not null,
  retrieved_records integer not null,
  complete          boolean not null,
  corpus_hash       text not null,
  request_count     integer not null,
  warnings          jsonb not null default '[]',
  -- Field coverage, free-text bands, dataset breakdown and validation counts for the run.
  analysis          jsonb,
  loaded_at         timestamptz not null default now()
);

-- Contributing datasets inside the source. `kind` is curated, not derived: whether a dataset's
-- records can be read as wild occurrences is a judgement, recorded with its reason.
create table corpus.datasets (
  data_resource_uid text primary key,
  name              text,
  kind              text not null default 'wild'
                    check (kind in ('wild', 'managed', 'telemetry')),
  kind_reason       text,
  first_seen_at     timestamptz not null default now()
);

comment on column corpus.datasets.kind is
  'wild: read as ordinary occurrences. managed: kept but labelled (fenced havens, reintroductions). telemetry: excluded from counts (one tagged animal yields thousands of points).';

-- Taxa, keyed on ALA's taxon concept id. National status is the value ALA attached at the
-- latest harvest, kept with when it was seen; it is never set or changed by a model.
create table corpus.taxa (
  taxon_concept_id  text primary key,
  scientific_name   text,
  vernacular_name   text,
  taxon_rank        text,
  kingdom           text,
  phylum            text,
  taxon_class       text,
  taxon_order       text,
  family            text,
  genus             text,
  national_status   text,
  status_seen_at    timestamptz not null default now()
);

-- Canonical occurrence records. Precise coordinates are stored; they are fuzzed at the API
-- boundary, never here (ethics pillar 4 — see privacy/coordinates.ts).
create table corpus.occurrences (
  record_id                 text primary key,  -- `${source}:${sourceRecordId}`
  source                    text not null,
  source_record_id          text not null,
  occurrence_id             text,
  harvest_id                text not null references corpus.harvest_runs (harvest_id),
  snapshot_page             text not null,
  fetched_at                timestamptz not null,
  data_resource_uid         text references corpus.datasets (data_resource_uid),
  license                   text,

  taxon_concept_id          text references corpus.taxa (taxon_concept_id),
  scientific_name           text,
  vernacular_name           text,
  national_status           text,

  event_date                timestamptz,
  first_loaded_at           timestamptz,       -- when the source first held it: the lag signal

  decimal_latitude          double precision,
  decimal_longitude         double precision,
  coordinate_uncertainty_m  double precision,
  state_province            text,
  ibra_region               text,
  locality                  text,
  geom                      geometry (Point, 4326) generated always as (
                              case when decimal_latitude is not null and decimal_longitude is not null
                                   then st_setsrid(st_makepoint(decimal_longitude, decimal_latitude), 4326)
                              end
                            ) stored,

  basis_of_record           text,
  individual_count          integer,
  recorded_by_pseudonym     text,
  occurrence_remarks        text,
  event_remarks             text,
  source_assertions         text[] not null default '{}',

  is_valid                  boolean not null,
  issue_count               integer not null default 0
);

create index occurrences_taxon_date on corpus.occurrences (taxon_concept_id, event_date);
create index occurrences_event_date on corpus.occurrences (event_date);
create index occurrences_ibra on corpus.occurrences (ibra_region);
create index occurrences_dataset on corpus.occurrences (data_resource_uid);
create index occurrences_geom on corpus.occurrences using gist (geom);

-- All-taxa record counts per grid cell and period: the effort denominator for reporting rates.
-- Filled from aggregate (facet) queries, not from harvested records.
create table corpus.effort_cells (
  cell          text not null,                 -- ALA point-0.1 label, e.g. '-33.9,151.2'
  period_start  date not null,
  period_end    date not null,
  records       integer not null,
  fetched_at    timestamptz not null,
  primary key (cell, period_start, period_end)
);

-- The records the analysis reads: valid, dated, and not telemetry. Managed populations stay in,
-- labelled, so each insight decides what to do with them.
create view corpus.analysable_occurrences as
select o.*, coalesce(d.kind, 'wild') as dataset_kind
from corpus.occurrences o
left join corpus.datasets d using (data_resource_uid)
where o.is_valid
  and o.event_date is not null
  and coalesce(d.kind, 'wild') <> 'telemetry';

-- Which tier each taxon falls in: every listed taxon is reported for insight #1; those with at
-- least 100 analysable records since 2015 also qualify for the statistical insights (#2–#5).
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
