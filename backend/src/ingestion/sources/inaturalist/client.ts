import { politeFetch, type FetchResult } from "../../http/politeClient.ts";

/**
 * iNaturalist API v1 client.
 *
 * Verified against the live API on 29 Aug 2026: open reads, no key, no auth. iNaturalist asks
 * for an identifying User-Agent and no more than roughly one request per second, both of which
 * the shared polite client already provides.
 */

export const INAT_BASE_URL = process.env.INAT_BASE_URL ?? "https://api.inaturalist.org/v1";

/** 200 succeeds. The documented ceiling, and double what ALA allows. */
export const INAT_MAX_PER_PAGE = 200;

export interface InatQuery {
  taxonId: number;
  placeId: number;
  /** Inclusive observation-date bounds. */
  d1: string;
  d2: string;
}

function buildUrl(query: InatQuery, extra: Record<string, string | number>): string {
  const url = new URL(`${INAT_BASE_URL}/observations`);
  url.searchParams.set("taxon_id", String(query.taxonId));
  url.searchParams.set("place_id", String(query.placeId));
  url.searchParams.set("d1", query.d1);
  url.searchParams.set("d2", query.d2);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, String(v));
  return url.toString();
}

/** Total matching observations, without transferring any. */
export async function countObservations(query: InatQuery): Promise<number> {
  const result = await politeFetch(buildUrl(query, { per_page: 0 }));
  const parsed = JSON.parse(result.body) as { total_results?: number };
  if (typeof parsed.total_results !== "number") {
    throw new Error(`iNaturalist count response had no total_results: ${result.body.slice(0, 200)}`);
  }
  return parsed.total_results;
}

/**
 * One page, fetched by id cursor rather than offset.
 *
 * iNaturalist caps offset paging at 10,000 results, but `id_above` with `order_by=id&order=asc`
 * has no ceiling and cannot skip or repeat a record when the underlying set changes mid-harvest.
 * It also removes the need for the date-slicing ALA required — the constraint that shaped Stage
 * 1's harvester simply does not exist here, which is itself worth noting: the partition logic is
 * a property of ALA, not of harvesting.
 */
export async function fetchPage(query: InatQuery, idAbove: number): Promise<FetchResult> {
  return politeFetch(
    buildUrl(query, {
      per_page: INAT_MAX_PER_PAGE,
      order_by: "id",
      order: "asc",
      id_above: idAbove,
    }),
  );
}
