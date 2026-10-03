-- "Nearest earlier record of the same taxon" (insight #5) is a nearest-neighbour search filtered
-- by taxon. A spatial index alone finds the nearest point of any taxon and then filters, which
-- walks a long way for a rare one; indexing taxon and point together lets each search stay
-- inside one taxon. btree_gist supplies the GiST operator class for the text column.
create extension if not exists btree_gist;

create index occurrences_taxon_geom on corpus.occurrences using gist (taxon_concept_id, geom);
