-- Two corrections found by adjudicating the first AI-arm runs (3 Oct 2026).
--
-- 1. Managed populations, per taxon and state. Managed status was set per dataset, and only AWC's
--    monitoring dataset was marked managed — so ~215k NSW BioNet records of fenced-haven and
--    reintroduced mammals (Bilby, Bridled Nailtail Wallaby, Shark Bay Burrowing Bettong at
--    Pilliga, Mallee Cliffs and Scotia) read as wild. The open-brief AI run found it.
--    A rule here says: every record of this taxon in this state is a managed population, because
--    the taxon survives in the wild only elsewhere. Rules are curated by hand and kept narrow — a
--    state with any natural population (e.g. Bilby in WA, NT and Qld; Woylie in WA; Greater
--    Stick-nest Rat in SA, on the Franklin Islands) gets no rule, so wild records are never
--    relabelled. Havens inside such states stay labelled only where their dataset is (AWC).
--
-- 2. The record's local date. event_date is a real instant (timestamptz). Taking its UTC date puts
--    any record made between midnight and 10–11 am in eastern Australia on the previous day.
--    event_day is the Australian Eastern local date; date-only records, stored at 00:00 UTC, keep
--    their date. For WA and NT records this is still an approximation (an hour or three late), far
--    smaller than the UTC error. Both arms use event_day for every date window.

create table corpus.managed_populations (
  taxon_concept_id text not null references corpus.taxa (taxon_concept_id),
  state_province   text not null,
  note             text not null,
  primary key (taxon_concept_id, state_province)
);

insert into corpus.managed_populations (taxon_concept_id, state_province, note)
select t.taxon_concept_id, r.state, r.note
from (values
  ('Macrotis lagotis',              'New South Wales',              'Extinct in the wild in NSW; reintroduced to fenced havens (Pilliga, Mallee Cliffs, Scotia, Sturt).'),
  ('Macrotis lagotis',              'South Australia',              'Extinct in the wild in SA; Arid Recovery, Venus Bay, Thistle Island and other reintroductions.'),
  ('Macrotis lagotis',              'Victoria',                     'Extinct in the wild in Victoria; fenced and captive populations only.'),
  ('Onychogalea fraenata',          'New South Wales',              'Wild only in central Queensland; NSW populations are reintroductions (Pilliga, Scotia, Mallee Cliffs).'),
  ('Bettongia lesueur lesueur',     'New South Wales',              'Wild only on WA islands; NSW populations are reintroductions.'),
  ('Bettongia lesueur lesueur',     'South Australia',              'Wild only on WA islands; SA populations are reintroductions.'),
  ('Bettongia penicillata ogilbyi', 'New South Wales',              'Wild only in south-west WA; NSW populations are reintroductions.'),
  ('Bettongia penicillata ogilbyi', 'South Australia',              'Wild only in south-west WA; SA populations are translocations.'),
  ('Bettongia penicillata ogilbyi', 'Victoria',                     'Wild only in south-west WA; Victorian populations are fenced or captive.'),
  ('Bettongia penicillata ogilbyi', 'Northern Territory',           'Wild only in south-west WA; NT population is a fenced reintroduction (Newhaven).'),
  ('Myrmecobius fasciatus',         'New South Wales',              'Wild only in WA; NSW populations are fenced reintroductions.'),
  ('Myrmecobius fasciatus',         'South Australia',              'Wild only in WA; SA populations are fenced reintroductions.'),
  ('Leporillus conditor',           'New South Wales',              'Wild only on the Franklin Islands (SA); NSW populations are reintroductions.'),
  ('Leporillus conditor',           'Western Australia',            'Wild only on the Franklin Islands (SA); WA populations are reintroductions.'),
  ('Perameles bougainville',        'New South Wales',              'Wild only on Bernier and Dorre Islands (WA); NSW populations are reintroductions.'),
  ('Perameles bougainville',        'South Australia',              'Wild only on Bernier and Dorre Islands (WA); SA populations are reintroductions.'),
  ('Isoodon auratus auratus',       'New South Wales',              'Wild in the Kimberley and NT; NSW population is a fenced reintroduction (Sturt).'),
  ('Dasyurus geoffroii',            'New South Wales',              'Wild only in WA; NSW populations are reintroductions.'),
  ('Dasyurus geoffroii',            'South Australia',              'Wild only in WA; SA populations are reintroductions (Flinders Ranges, Arid Recovery).'),
  ('Dasyurus viverrinus',           'New South Wales',              'Extinct on the mainland; NSW populations are reintroductions (Booderee) or captive.'),
  ('Dasyurus viverrinus',           'Australian Capital Territory', 'Extinct on the mainland; ACT population is a fenced reintroduction (Mulligans Flat).'),
  ('Dasyurus viverrinus',           'Victoria',                     'Extinct on the mainland; Victorian populations are fenced or captive.')
) as r (scientific_name, state, note)
join corpus.taxa t on t.scientific_name = r.scientific_name;

alter table corpus.occurrences
  add column event_day date generated always as ((event_date at time zone 'Australia/Sydney')::date) stored;

create index occurrences_taxon_day on corpus.occurrences (taxon_concept_id, event_day);
create index occurrences_event_day on corpus.occurrences (event_day);

drop view corpus.taxon_tiers;
drop view corpus.analysable_occurrences;

create view corpus.analysable_occurrences as
select o.*,
       coalesce(d.kind, 'wild') as dataset_kind,
       case when coalesce(d.kind, 'wild') = 'managed' or m.taxon_concept_id is not null
            then 'managed' else 'wild' end as population
from corpus.occurrences o
left join corpus.datasets d using (data_resource_uid)
left join corpus.managed_populations m
  on m.taxon_concept_id = o.taxon_concept_id and m.state_province = o.state_province
where o.is_valid
  and o.event_date is not null
  and coalesce(d.kind, 'wild') <> 'telemetry';

create view corpus.taxon_tiers as
select t.taxon_concept_id,
       t.scientific_name,
       t.vernacular_name,
       t.national_status,
       count(a.record_id) filter (where a.event_day >= '2015-01-01') as records_since_2015,
       max(a.event_day) as last_record_day,
       count(a.record_id) filter (where a.event_day >= '2015-01-01') >= 100 as statistical_tier
from corpus.taxa t
left join corpus.analysable_occurrences a using (taxon_concept_id)
group by t.taxon_concept_id;

grant select on corpus.analysable_occurrences, corpus.taxon_tiers, corpus.managed_populations to ai_reader;
