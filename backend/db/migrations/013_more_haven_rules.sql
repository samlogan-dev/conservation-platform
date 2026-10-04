-- Two NSW reintroductions still read as wild, found by an open-brief AI run (b1cf4846, 4 Oct 2026)
-- and confirmed: Plains Rat at Pilliga (Brigalow Belt South, from late 2023) and Red-tailed
-- Phascogale at Mallee Cliffs (Murray Darling Depression, from Nov 2021). Neither survives in the
-- wild in NSW.
insert into corpus.managed_populations (taxon_concept_id, state_province, note)
select t.taxon_concept_id, 'New South Wales', r.note
from (values
  ('Pseudomys australis', 'Extinct in the wild in NSW; Pilliga reintroduction from 2023.'),
  ('Phascogale calura',   'Extinct in the wild in NSW; Mallee Cliffs reintroduction from 2021.')
) as r (scientific_name, note)
join corpus.taxa t on t.scientific_name = r.scientific_name;

select corpus.apply_managed_rules();
