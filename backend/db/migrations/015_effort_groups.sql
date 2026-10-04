-- Effort per taxonomic group (4 Oct 2026). The all-taxa denominator is a bird index — birds are
-- ~76% of ALA records in a month (Oct 2024), plants ~9.5% — so reporting rates for threatened
-- plants fell across the board (median ratio 0.68 against 0.91 for birds) as birdwatching and
-- iNaturalist grew. Each group's rate is now read against records of the same group.
alter table corpus.effort_cells add column taxon_group text not null default 'all';
alter table corpus.effort_cells drop constraint effort_cells_pkey;
alter table corpus.effort_cells add primary key (taxon_group, cell_lat, cell_lon, period_start, period_end);
