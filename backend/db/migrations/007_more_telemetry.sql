-- Tracking datasets missed by the first curation (3 Oct 2026), found by searching the loaded
-- corpus for machine observations and tracking/tagging dataset names. Not added: dr5467
-- "Tracking Australia" is footprint (track-based) survey, not animal telemetry.
insert into corpus.datasets (data_resource_uid, name, kind, kind_reason) values
  ('dr23125', 'Tracking Red-necked stints (Calidris ruficollis) and Curlew sandpipers', 'telemetry', 'animal tracking'),
  ('dr23204', 'White shark (Carcharodon carcharias) tagging along eastern Australia', 'telemetry', 'tagging'),
  ('dr34308', 'ECOCEAN Maldives Whale Shark Tracking', 'telemetry', 'animal tracking')
on conflict (data_resource_uid) do update
  set kind = excluded.kind, kind_reason = excluded.kind_reason;
