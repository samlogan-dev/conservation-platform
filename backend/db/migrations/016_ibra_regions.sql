-- IBRA 7 bioregion outlines for the portal's maps (4 Oct 2026). From ALA's spatial layer cl1048 —
-- the layer every record's ibra_region was intersected with, so names match exactly. Stored
-- simplified (~0.01°, about 1 km): the outlines draw maps, they never assign records to regions.
create table if not exists corpus.ibra_regions (
  name        text primary key,
  pid         text not null,
  area_km2    double precision not null,
  geom        geometry(MultiPolygon, 4326) not null,
  harvest_id  text not null
);
