import { politeFetch, type FetchResult } from "../../http/politeClient.ts";
import { ALA_BASE_URL, ALA_REQUESTED_FIELDS } from "./fields.ts";

/**
 * A thin ALA query builder and caller. It deliberately does no parsing beyond what a caller
 * needs to make a decision — the raw body is passed back so the snapshot store can freeze it.
 */

/** An ALA occurrence query: a main query plus zero or more filter queries. */
export interface AlaQuery {
  q: string;
  fq: string[];
}

export function buildSearchUrl(
  query: AlaQuery,
  options: { pageSize: number; startIndex: number; includeFields?: boolean },
): string {
  const url = new URL(`${ALA_BASE_URL}/occurrences/search`);
  url.searchParams.set("q", query.q);
  for (const fq of query.fq) url.searchParams.append("fq", fq);
  url.searchParams.set("pageSize", String(options.pageSize));
  url.searchParams.set("startIndex", String(options.startIndex));
  // Sorting by `id` is what makes paging reproducible. ALA's default sort is by relevance
  // score, which carries no guarantee of a stable tiebreak between records of equal score —
  // so a page boundary could drop or duplicate records between runs. `id` is unique and
  // total, so the same query returns the same records in the same order. `sort=uuid` is
  // rejected with HTTP 400; the sortable name is `id`.
  url.searchParams.set("sort", "id");
  url.searchParams.set("dir", "asc");
  if (options.includeFields !== false) {
    url.searchParams.set("fl", ALA_REQUESTED_FIELDS.join(","));
  }
  return url.toString();
}

export function buildFacetUrl(query: AlaQuery, facet: string, limit = 200): string {
  const url = new URL(`${ALA_BASE_URL}/occurrences/search`);
  url.searchParams.set("q", query.q);
  for (const fq of query.fq) url.searchParams.append("fq", fq);
  url.searchParams.set("pageSize", "0");
  url.searchParams.set("facets", facet);
  url.searchParams.set("flimit", String(limit));
  return url.toString();
}

/** Count only — `pageSize=0` returns the total without transferring any records. */
export async function countRecords(query: AlaQuery): Promise<number> {
  const url = buildSearchUrl(query, { pageSize: 0, startIndex: 0, includeFields: false });
  const result = await politeFetch(url);
  const parsed = JSON.parse(result.body) as { totalRecords?: number };
  if (typeof parsed.totalRecords !== "number") {
    throw new Error(`ALA count response had no totalRecords: ${result.body.slice(0, 200)}`);
  }
  return parsed.totalRecords;
}

export interface AlaFacetValue {
  label: string;
  count: number;
  fq?: string;
}

/**
 * Facet counts. Used for the contributing-data-resource breakdown, which the API can answer
 * as an aggregate — no paging, and therefore no exposure to the offset cap.
 */
export async function fetchFacet(query: AlaQuery, facet: string): Promise<AlaFacetValue[]> {
  const result = await politeFetch(buildFacetUrl(query, facet));
  const parsed = JSON.parse(result.body) as {
    facetResults?: { fieldName: string; fieldResult: AlaFacetValue[] }[];
  };
  const match = parsed.facetResults?.find((f) => f.fieldName === facet);
  return match?.fieldResult ?? [];
}

/** One page of occurrences, returned unparsed so it can be frozen verbatim. */
export async function fetchPage(
  query: AlaQuery,
  startIndex: number,
  pageSize: number,
): Promise<FetchResult> {
  return politeFetch(buildSearchUrl(query, { pageSize, startIndex }));
}

/** Convenience: the `fq` clause restricting a query to an inclusive event-date window. */
export function eventDateFilter(startDate: string, endDate: string): string {
  return `eventDate:[${startDate}T00:00:00Z TO ${endDate}T23:59:59Z]`;
}

/** Convenience: the `fq` clause restricting to an Australian state (ALA layer cl22). */
export function stateFilter(stateProvince: string): string {
  return `cl22:"${stateProvince}"`;
}
