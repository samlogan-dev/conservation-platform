-- Curated dataset kinds (decided 3 Oct 2026). Identified from ALA's machine-observation records
-- for nationally threatened taxa since 2015; ids resolved against ALA's facet filters.

insert into corpus.datasets (data_resource_uid, name, kind, kind_reason) values
  ('dr23141', 'Ningaloo Outlook turtle tracking of Green turtles (Chelonia mydas), Western Australia (2018-present)', 'telemetry', 'animal tracking'),
  ('dr9942',  'IMOS - Animal Tracking Facility - Acoustic Tracking - Quality Controlled Detections (2007 -2021)', 'telemetry', 'acoustic tag detections'),
  ('dr23118', 'IMOS - AATAMS Facility Satellite Relay Tagging Program - Satellite tracking of pinnipeds - Delayed mode data, 2007-2017', 'telemetry', 'satellite tracking'),
  ('dr31514', 'Mapping critical Australian sea lion habitat with animal-borne instruments (NESP MaC 2.6), South Australia (2022-2023)', 'telemetry', 'animal-borne instruments'),
  ('dr23201', 'Tracking speartooth sharks (Glyphis glyphis) and bull sharks (Carcharhinus leucas), Wenlock and Ducie rivers, Cape York, Australia (2014-2018)', 'telemetry', 'acoustic tracking'),
  ('dr34309', 'ECOCEAN Western Australia Whale Shark Tracking', 'telemetry', 'animal tracking'),
  ('dr34307', 'ECOCEAN Christmas Island Whale Shark Tracking', 'telemetry', 'animal tracking'),
  ('dr499',   'AWC Ecological Monitoring Surveys', 'managed', 'includes fenced havens and reintroduced populations; not separable at dataset level')
on conflict (data_resource_uid) do update
  set kind = excluded.kind, kind_reason = excluded.kind_reason;
