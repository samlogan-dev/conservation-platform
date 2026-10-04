import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import { geoArea } from 'd3'
import apiClient from '@/apis/apiClient'

export type RegionFeatures = FeatureCollection<Polygon | MultiPolygon, { name: string; area_km2: number }>

/**
 * d3-geo reads a ring's winding on the sphere: a polygon wound the "wrong" way means everything
 * except it. The server forces exterior rings clockwise, but simplification leaves some tiny
 * island parts degenerate, and those still came out inverted — a sheet over the whole map.
 * Any part covering more than half the globe is reversed.
 */
function rewind(rings: Position[][]): Position[][] {
  return geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings
}

/** IBRA outlines, fetched once per page load: ~1 MB, unchanged between corpus loads. */
let cache: Promise<RegionFeatures> | null = null
export const regionOutlines = () => {
  cache ??= apiClient.get<RegionFeatures>('/geo/regions?v=2').then((r) => {
    for (const f of r.data.features) {
      const g = f.geometry
      if (g.type === 'Polygon') g.coordinates = rewind(g.coordinates)
      else g.coordinates = g.coordinates.map(rewind)
    }
    return r.data
  })
  cache.catch(() => (cache = null))
  return cache
}
