import { Hono } from "hono";
import { db } from "../db/pool.ts";

/**
 * Read-only routes behind the portal. Everything served is an aggregate or an insight — never a
 * record's coordinates (ethics pillar 4) and never observer fields (pillar 2). Insights carry their
 * corpus DOI through /summary so the portal can attribute the data (pillar 3).
 *
 *   GET /api/summary[?run=]            the report's run, corpus facts, and insight counts
 *   GET /api/insights?...              one run's insights, filtered, sorted, paged
 *   GET /api/regions[?run=]            IBRA regions: co-movement figures and insight counts
 *   GET /api/taxa/:id[?run=]           a taxon: its insights in the run, and AI insights naming it
 *   GET /api/runs                      every analysis run, AI runs with their latest score
 *   GET /api/runs/:id                  one run, with its comparison (AI runs)
 *   GET /api/queries?ids=1,2           the SQL behind an AI insight, as logged
 *   GET /api/baseline[?run=]           the manual route to the run's insights, against the platform
 *   GET /api/geo/regions               IBRA 7 outlines as GeoJSON, simplified for national maps
 *   GET /api/currency                  threatened records per month, to show how far recent months lag
 *   GET /api/taxon-series/:id[?run=]   a taxon's records per year and per bioregion in the run's windows
 *
 * `run` defaults to the latest completed calculated run that computed all five insights.
 */
export const portal = new Hono();

const CORPUS_DOI = "10.26197/ala.40eee344-07ce-48d2-9ec2-be39574ff4c7";
const UUID = /^[0-9a-f-]{36}$/i;

async function resolveRun(run: string | undefined): Promise<string> {
  if (run && UUID.test(run)) return run;
  const { rows } = await db().query<{ run_id: string }>(
    `select run_id from analysis.runs
     where arm = 'calculated' and status = 'done' and params->'insights' @> '["1","2","3","4","5"]'
     order by started_at desc limit 1`,
  );
  if (!rows[0]) throw new Error("no completed calculated run with all five insights");
  return rows[0].run_id;
}

const INSIGHT_COLUMNS = `
  i.insight_id::int, i.insight_type, i.taxon_concept_id, t.scientific_name, t.vernacular_name, t.national_status,
  t.kingdom, t.taxon_class, i.region, i.period_start::text, i.period_end::text, i.figures, i.confidence, i.summary,
  i.query_ids::int[], i.related_taxa`;

/** Sort keys the client may ask for, each a fixed SQL expression — never interpolated input. */
const SORTS: Record<string, string> = {
  default: "i.insight_id",
  baseline_annual_mean: "(i.figures->>'baseline_annual_mean')::float desc nulls last",
  baseline_records: "(i.figures->>'baseline_records')::float desc nulls last",
  records_since_2015: "(i.figures->>'records_since_2015')::float asc nulls last",
  aoo_change: "(i.figures->'aoo_10km_km2'->>'change')::float asc nulls last",
  // Contractions a practitioner should look at first: those mostly carried by sources that stopped
  // recording the taxon (a compilation ending, a survey wound up) go last.
  aoo_change_reliable:
    "coalesce((i.confidence->>'baseline_share_from_sources_no_longer_recording')::float, 0) >= 0.5, (i.figures->'aoo_10km_km2'->>'change')::float asc nulls last",
  aoo_change_desc: "(i.figures->'aoo_10km_km2'->>'change')::float desc nulls last",
  detection_ratio: "(i.figures->>'detection_ratio')::float asc nulls last",
  detection_ratio_desc: "(i.figures->>'detection_ratio')::float desc nulls last",
  p_decline: "(i.figures->>'p_decline')::float asc nulls last",
  p_increase: "(i.figures->>'p_increase')::float asc nulls last",
  distance: "(i.figures->>'max_distance_to_prior_km')::float desc nulls last",
  name: "coalesce(t.vernacular_name, t.scientific_name, i.region)",
};

/** Corpus facts change only when a corpus is loaded; counting 2M rows on every page view is waste. */
let corpusCache: { at: number; value: Promise<{ rows: Record<string, unknown>[] }> } | null = null;
const corpusFacts = () => {
  if (!corpusCache || Date.now() - corpusCache.at > 10 * 60_000) {
    corpusCache = {
      at: Date.now(),
      value: db().query(
        `select (select count(*) from corpus.analysable_occurrences)::int as analysable_records,
                (select count(*) from corpus.taxa)::int as taxa,
                (select count(*) from corpus.taxon_tiers where statistical_tier)::int as statistical_tier,
                (select count(distinct data_resource_uid) from corpus.occurrences)::int as datasets,
                (select max(event_day)::text from corpus.occurrences where event_day <= current_date) as latest_record`,
      ),
    };
    corpusCache.value.catch(() => (corpusCache = null));
  }
  return corpusCache.value;
};

portal.get("/summary", async (c) => {
  const runId = await resolveRun(c.req.query("run"));
  const [run, counts, corpus] = await Promise.all([
    db().query(
      `select run_id, arm, params->>'version' as params_version, params->>'reportMonth' as report_month,
              params->'baseline' as baseline, params->'rangeChange'->'baselineWindow' as window_baseline,
              params->'rangeChange'->'recentWindow' as window_recent, corpus, started_at, finished_at
       from analysis.runs where run_id = $1`,
      [runId],
    ),
    db().query(
      `select insight_type, (region is null) as national,
              coalesce(figures->>'kind', figures->>'flag', 'none') as label, count(*)::int as n
       from analysis.insights where run_id = $1 group by 1, 2, 3 order by 1, 2, 3`,
      [runId],
    ),
    corpusFacts(),
  ]);
  return c.json({ run: run.rows[0], counts: counts.rows, corpus: { ...corpus.rows[0], doi: CORPUS_DOI } });
});

portal.get("/insights", async (c) => {
  const q = c.req.query();
  const runId = await resolveRun(q.run);
  const where = ["i.run_id = $1"];
  const args: unknown[] = [runId];
  // One value per call; every "?" in the fragment refers to it.
  const add = (sql: string, value: unknown) => {
    args.push(value);
    where.push(sql.replaceAll("?", `$${args.length}`));
  };
  if (q.type) add("i.insight_type = ?", q.type);
  if (q.label) add("coalesce(i.figures->>'kind', i.figures->>'flag', 'none') = ?", q.label);
  if (q.flagged === "true") where.push("coalesce(i.figures->>'kind', i.figures->>'flag') is not null");
  if (q.region === "national") where.push("i.region is null");
  else if (q.region === "regional") where.push("i.region is not null");
  else if (q.region) add("i.region = ?", q.region);
  if (q.taxon) add("(i.taxon_concept_id = ? or i.related_taxa @> array[?]::text[])", q.taxon);
  if (q.group) add(
    `(case when t.kingdom = 'Plantae' then 'plants' when t.taxon_class = 'Aves' then 'birds'
           when t.taxon_class = 'Mammalia' then 'mammals' when t.taxon_class = 'Reptilia' then 'reptiles'
           when t.taxon_class = 'Amphibia' then 'amphibians' else 'other' end) = ?`, q.group);
  if (q.q) add("(t.vernacular_name ilike ? or t.scientific_name ilike ? or i.region ilike ?)", `%${q.q}%`);
  const order = SORTS[q.sort ?? "default"] ?? SORTS.default;
  const limit = Math.min(Number(q.limit) || 50, 500);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const from = `from analysis.insights i left join corpus.taxa t using (taxon_concept_id) where ${where.join(" and ")}`;
  const [items, total] = await Promise.all([
    db().query(`select ${INSIGHT_COLUMNS} ${from} order by ${order}, i.insight_id limit ${limit} offset ${offset}`, args),
    db().query<{ n: number }>(`select count(*)::int as n ${from}`, args),
  ]);
  return c.json({ run: runId, total: total.rows[0]!.n, items: items.rows });
});

portal.get("/regions", async (c) => {
  const runId = await resolveRun(c.req.query("run"));
  const { rows } = await db().query(
    `select r.region, cm.figures as co_movement, r.insights, r.silences, r.notable, r.rate_flags
     from (select region, count(*)::int as insights,
                  count(*) filter (where figures->>'kind' = 'regional_silence')::int as silences,
                  count(*) filter (where insight_type = 'notable_record')::int as notable,
                  count(*) filter (where insight_type = 'reporting_rate' and figures->>'flag' is not null)::int as rate_flags
           from analysis.insights where run_id = $1 and region is not null group by region) r
     left join analysis.insights cm on cm.run_id = $1 and cm.insight_type = 'co_movement' and cm.region = r.region
     order by r.region`,
    [runId],
  );
  return c.json({ run: runId, regions: rows });
});

portal.get("/baseline", async (c) => {
  const runId = await resolveRun(c.req.query("run"));
  const { rows } = await db().query(
    `select baseline_id::int, calculated_run_id, model_version, steps, totals, platform, created_at
     from analysis.manual_baselines where calculated_run_id = $1 order by baseline_id desc limit 1`,
    [runId],
  );
  return c.json({ run: runId, baseline: rows[0] ?? null });
});

/** Region outlines never change between corpus loads; build the GeoJSON once. */
let geoCache: Promise<string> | null = null;
portal.get("/geo/regions", async (c) => {
  geoCache ??= db()
    .query<{ geojson: string }>(
      // ~4 km tolerance and 2 decimals (~1 km): well under a pixel on a national map, ~1 MB raw.
      // Exterior rings clockwise, as d3-geo reads them; the other winding means "the globe minus this".
      `select json_build_object('type', 'FeatureCollection', 'features', json_agg(json_build_object(
         'type', 'Feature', 'properties', json_build_object('name', name, 'area_km2', round(area_km2)),
         'geometry', st_asgeojson(st_forcepolygoncw(st_simplifypreservetopology(geom, 0.04)), 2)::json) order by name))::text as geojson
       from corpus.ibra_regions`,
    )
    .then((r) => r.rows[0]!.geojson);
  geoCache.catch(() => (geoCache = null));
  c.header("Content-Type", "application/json");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(await geoCache);
});

let currencyCache: { at: number; value: Promise<unknown> } | null = null;
portal.get("/currency", async (c) => {
  if (!currencyCache || Date.now() - currencyCache.at > 10 * 60_000) {
    currencyCache = {
      at: Date.now(),
      value: db()
        .query(
          `select to_char(date_trunc('month', event_day), 'YYYY-MM') as month, count(*)::int as records,
                  count(*) filter (where population = 'wild')::int as wild,
                  count(distinct data_resource_uid)::int as datasets
           from corpus.analysable_occurrences
           where event_day >= '2015-01-01' and event_day <= current_date
           group by 1 order by 1`,
        )
        .then((r) => r.rows),
    };
    currencyCache.value.catch(() => (currencyCache = null));
  }
  return c.json({ months: await currencyCache.value });
});

portal.get("/taxon-series/:id{.+}", async (c) => {
  const id = c.req.param("id");
  const runId = await resolveRun(c.req.query("run"));
  const { rows: runRows } = await db().query<{ b: { start: string; end: string }; r: { start: string; end: string } }>(
    `select params->'rangeChange'->'baselineWindow' as b, params->'rangeChange'->'recentWindow' as r
     from analysis.runs where run_id = $1`,
    [runId],
  );
  const w = runRows[0];
  if (!w?.b || !w.r) return c.json({ error: "run has no windows" }, 404);
  const [years, regions] = await Promise.all([
    db().query(
      `select extract(year from event_day)::int as year, count(*)::int as records,
              count(*) filter (where population = 'wild')::int as wild,
              count(distinct data_resource_uid)::int as datasets
       from corpus.analysable_occurrences
       where taxon_concept_id = $1 and event_day >= '2015-01-01' and event_day <= current_date
       group by 1 order by 1`,
      [id],
    ),
    // Wild records only, as range change and reporting rate count them. Region counts, never points.
    db().query(
      `select ibra_region as region,
              count(*) filter (where event_day between $2::date and $3::date)::int as baseline,
              count(*) filter (where event_day between $4::date and $5::date)::int as recent,
              count(*)::int as since_2015
       from corpus.analysable_occurrences
       where taxon_concept_id = $1 and population = 'wild' and ibra_region is not null and event_day >= '2015-01-01'
       group by 1 order by 1`,
      [id, w.b.start, w.b.end, w.r.start, w.r.end],
    ),
  ]);
  return c.json({ run: runId, windows: { baseline: w.b, recent: w.r }, years: years.rows, regions: regions.rows });
});

portal.get("/taxa/:id{.+}", async (c) => {
  const id = c.req.param("id");
  const runId = await resolveRun(c.req.query("run"));
  const [taxon, insights, ai] = await Promise.all([
    db().query(
      `select t.*, tt.records_since_2015::int, tt.last_record_day::text, tt.statistical_tier
       from corpus.taxa t left join corpus.taxon_tiers tt using (taxon_concept_id) where t.taxon_concept_id = $1`,
      [id],
    ),
    db().query(
      `select ${INSIGHT_COLUMNS} from analysis.insights i left join corpus.taxa t using (taxon_concept_id)
       where i.run_id = $1 and (i.taxon_concept_id = $2 or i.related_taxa @> array[$2]::text[])
       order by i.insight_type, i.region nulls first`,
      [runId, id],
    ),
    db().query(
      `select i.insight_id::int, i.run_id, r.brief, r.prompt_version, i.insight_type, i.region, i.summary, i.figures->>'category' as category
       from analysis.insights i join analysis.runs r using (run_id)
       where r.arm = 'ai' and r.status = 'done' and (i.taxon_concept_id = $1 or i.related_taxa @> array[$1]::text[])
       order by r.started_at desc limit 50`,
      [id],
    ),
  ]);
  if (!taxon.rows[0]) return c.json({ error: "unknown taxon" }, 404);
  return c.json({ run: runId, taxon: taxon.rows[0], insights: insights.rows, ai_insights: ai.rows });
});

portal.get("/runs", async (c) => {
  const { rows } = await db().query(
    `select r.run_id, r.arm, r.brief, r.model, r.prompt_version, r.params->>'version' as params_version, r.status,
            r.started_at, r.finished_at, r.usage, r.error,
            (select count(*)::int from analysis.insights i where i.run_id = r.run_id) as insights,
            cmp.summary as score, cmp.calculated_run_id, cmp.scorer_version
     from analysis.runs r
     left join lateral (select summary, calculated_run_id, scorer_version from analysis.comparisons c
                        where c.ai_run_id = r.run_id order by c.comparison_id desc limit 1) cmp on true
     order by r.started_at desc`,
  );
  return c.json({ runs: rows });
});

portal.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "bad run id" }, 400);
  const [run, comparison] = await Promise.all([
    db().query(
      `select run_id, arm, brief, model, prompt_version, params, corpus, status, started_at, finished_at, usage, error
       from analysis.runs where run_id = $1`,
      [id],
    ),
    db().query(
      `select summary, details->'grounding' as ungrounded, details->'discovery' as discovery, calculated_run_id, scorer_version, created_at
       from analysis.comparisons where ai_run_id = $1 order by comparison_id desc limit 1`,
      [id],
    ),
  ]);
  if (!run.rows[0]) return c.json({ error: "unknown run" }, 404);
  return c.json({ run: run.rows[0], comparison: comparison.rows[0] ?? null });
});

portal.get("/queries", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").map(Number).filter(Number.isInteger).slice(0, 50);
  if (!ids.length) return c.json({ queries: [] });
  const { rows } = await db().query(
    `select query_id::int, run_id, sql, row_count, truncated, error, duration_ms, executed_at
     from analysis.ai_queries where query_id = any($1::bigint[]) order by query_id`,
    [ids],
  );
  return c.json({ queries: rows });
});

portal.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message }, 500);
});
