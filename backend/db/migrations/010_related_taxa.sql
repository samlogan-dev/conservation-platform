-- An insight about several taxa (e.g. "eleven taxa with 50+ records have gone silent") names its
-- main taxon in taxon_concept_id and the rest here, so comparison can match every taxon it covers
-- rather than only the one. Added after the pilot open-brief run, which bundled taxa this way.
alter table analysis.insights add column related_taxa text[] not null default '{}';
