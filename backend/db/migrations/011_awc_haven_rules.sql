-- AWC's monitoring dataset (dr499) was marked managed as a whole (003). It holds fenced-haven and
-- translocated mammals (Mt Gibson, Karakamia, Faure Island, Newhaven, Scotia, Yookamurra) but also
-- wild surveys on unfenced sanctuaries — Northern Quolls and Ghost Bats in the Kimberley, Cape York
-- mammals, and every bird and reptile. Once range change used wild records only, the dataset-wide
-- label removed those wild records too (Ghost Bat, Palm Cockatoo). So managed status for AWC moves
-- from the dataset to its haven populations: rules may now name a dataset and an IBRA region.
-- A rule with a null region covers the whole state; with a null dataset, every dataset.

alter table corpus.managed_populations drop constraint managed_populations_pkey;
alter table corpus.managed_populations
  add column rule_id serial primary key,
  add column ibra_region text,
  add column data_resource_uid text references corpus.datasets (data_resource_uid);

update corpus.datasets set kind = 'wild' where data_resource_uid = 'dr499';

insert into corpus.managed_populations (taxon_concept_id, state_province, ibra_region, data_resource_uid, note)
select t.taxon_concept_id, r.state, r.region, 'dr499', r.note
from (values
  ('Bettongia penicillata ogilbyi',    'Western Australia',  'Yalgoo',             'AWC Mt Gibson fenced haven.'),
  ('Bettongia penicillata ogilbyi',    'Western Australia',  'Avon Wheatbelt',     'AWC Mt Gibson fenced haven.'),
  ('Bettongia penicillata ogilbyi',    'Western Australia',  'Jarrah Forest',      'AWC Karakamia fenced sanctuary.'),
  ('Bettongia lesueur lesueur',        'Western Australia',  null,                 'AWC Faure Island and Mt Gibson translocations; wild only on Bernier, Dorre and Barrow Islands, which AWC does not survey.'),
  ('Lagostrophus fasciatus fasciatus', 'Western Australia',  null,                 'AWC Faure Island and Mt Gibson translocations.'),
  ('Perameles bougainville',           'Western Australia',  null,                 'AWC Faure Island and Mt Gibson translocations.'),
  ('Macrotis lagotis',                 'Western Australia',  'Yalgoo',             'AWC Mt Gibson fenced haven.'),
  ('Macrotis lagotis',                 'Western Australia',  'Avon Wheatbelt',     'AWC Mt Gibson fenced haven.'),
  ('Macrotis lagotis',                 'Northern Territory', 'Great Sandy Desert', 'AWC Newhaven fenced haven.'),
  ('Phascogale calura',                'Western Australia',  'Yalgoo',             'AWC Mt Gibson reintroduction.'),
  ('Phascogale calura',                'Western Australia',  'Avon Wheatbelt',     'AWC Mt Gibson reintroduction.'),
  ('Phascogale calura',                'Northern Territory', null,                 'Extinct in the NT; AWC Newhaven reintroduction.'),
  ('Myrmecobius fasciatus',            'Western Australia',  'Yalgoo',             'AWC Mt Gibson fenced haven.'),
  ('Myrmecobius fasciatus',            'Western Australia',  'Avon Wheatbelt',     'AWC Mt Gibson fenced haven.'),
  ('Dasyurus geoffroii',               'Western Australia',  'Yalgoo',             'AWC Mt Gibson reintroduction.'),
  ('Dasyurus geoffroii',               'Western Australia',  'Avon Wheatbelt',     'AWC Mt Gibson reintroduction.'),
  ('Zyzomys pedunculatus',             'Northern Territory', 'Great Sandy Desert', 'AWC Newhaven fenced translocation.')
) as r (scientific_name, state, region, note)
join corpus.taxa t on t.scientific_name = r.scientific_name;

drop view corpus.taxon_tiers;
drop view corpus.analysable_occurrences;

-- EXISTS, not a join: a record matched by two rules must still appear once.
create view corpus.analysable_occurrences as
select o.*,
       coalesce(d.kind, 'wild') as dataset_kind,
       case when coalesce(d.kind, 'wild') = 'managed'
              or exists (select 1 from corpus.managed_populations m
                         where m.taxon_concept_id = o.taxon_concept_id
                           and m.state_province = o.state_province
                           and (m.ibra_region is null or m.ibra_region = o.ibra_region)
                           and (m.data_resource_uid is null or m.data_resource_uid = o.data_resource_uid))
            then 'managed' else 'wild' end as population
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
       count(a.record_id) filter (where a.event_day >= '2015-01-01') as records_since_2015,
       max(a.event_day) as last_record_day,
       count(a.record_id) filter (where a.event_day >= '2015-01-01') >= 100 as statistical_tier
from corpus.taxa t
left join corpus.analysable_occurrences a using (taxon_concept_id)
group by t.taxon_concept_id;

grant select on corpus.analysable_occurrences, corpus.taxon_tiers to ai_reader;
grant select on corpus.managed_populations to ai_reader;
