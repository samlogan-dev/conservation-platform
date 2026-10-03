-- Evaluating the managed-population rules inside the view, once per row, made every query over
-- analysable_occurrences several times slower (range change 9 s → 40 s), enough to push the AI
-- arm's queries towards their timeout. The rule result is now stored on each record and refreshed
-- by corpus.apply_managed_rules(), which every corpus load and every rule change calls.

alter table corpus.occurrences add column managed_by_rule boolean not null default false;

create function corpus.apply_managed_rules() returns bigint language sql as $$
  with target as (
    select o.record_id,
           exists (select 1 from corpus.managed_populations m
                   where m.taxon_concept_id = o.taxon_concept_id
                     and m.state_province = o.state_province
                     and (m.ibra_region is null or m.ibra_region = o.ibra_region)
                     and (m.data_resource_uid is null or m.data_resource_uid = o.data_resource_uid)) as managed
    from corpus.occurrences o
    where o.taxon_concept_id in (select taxon_concept_id from corpus.managed_populations) or o.managed_by_rule
  ), changed as (
    update corpus.occurrences o set managed_by_rule = t.managed
    from target t where o.record_id = t.record_id and o.managed_by_rule <> t.managed
    returning 1
  )
  select count(*) from changed;
$$;

select corpus.apply_managed_rules();

drop view corpus.taxon_tiers;
drop view corpus.analysable_occurrences;

create view corpus.analysable_occurrences as
select o.*,
       coalesce(d.kind, 'wild') as dataset_kind,
       case when coalesce(d.kind, 'wild') = 'managed' or o.managed_by_rule then 'managed' else 'wild' end as population
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

analyze corpus.occurrences;
