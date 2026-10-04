import apiClient from './apiClient'

/** Shapes returned by the backend's portal routes (backend/src/api/portal.ts). */

export type InsightType = 'silent_species' | 'range_change' | 'reporting_rate' | 'co_movement' | 'notable_record' | 'other'

export interface Insight {
  insight_id: number
  insight_type: InsightType
  taxon_concept_id: string | null
  scientific_name: string | null
  vernacular_name: string | null
  national_status: string | null
  kingdom: string | null
  taxon_class: string | null
  region: string | null
  period_start: string
  period_end: string
  figures: Record<string, any>
  confidence: Record<string, any>
  summary: string
  query_ids: number[]
  related_taxa: string[]
}

export interface Summary {
  run: {
    run_id: string
    params_version: string
    report_month: string
    baseline: { start: string; end: string }
    window_baseline: { start: string; end: string }
    window_recent: { start: string; end: string }
    finished_at: string
  }
  counts: { insight_type: InsightType; national: boolean; label: string; n: number }[]
  corpus: {
    analysable_records: number
    taxa: number
    statistical_tier: number
    datasets: number
    latest_record: string
    doi: string
  }
}

export interface Region {
  region: string
  co_movement: Record<string, any> | null
  insights: number
  silences: number
  notable: number
  rate_flags: number
}

export interface Run {
  run_id: string
  arm: 'calculated' | 'ai'
  brief: 'guided' | 'open' | null
  model: string | null
  prompt_version: string | null
  params_version: string | null
  status: string
  started_at: string
  finished_at: string | null
  usage: Record<string, any> | null
  error: string | null
  insights: number
  score: Record<string, any> | null
  calculated_run_id: string | null
  scorer_version: string | null
}

export interface LoggedQuery {
  query_id: number
  sql: string
  row_count: number
  truncated: boolean
  error: string | null
  duration_ms: number
}

export interface ManualBaseline {
  model_version: string
  calculated_run_id: string
  steps: { insight: string; step: string; unit: string; units: number; perUnit: Record<string, number> }[]
  totals: { queries: number; downloads: number; joins: number; computations: number; ala_request_floor_hours: number }
  platform: {
    manual_steps: number
    calculated_arm_seconds: number
    ai_arm: { brief: string; runs: number; mean_cost: number; mean_minutes: number; mean_turns: number; mean_queries: number }[]
  }
}

export interface InsightQuery {
  run?: string
  type?: InsightType
  label?: string
  region?: string
  taxon?: string
  group?: string
  q?: string
  sort?: string
  flagged?: boolean
  limit?: number
  offset?: number
}

const get = async <T>(url: string, params?: object): Promise<T> => (await apiClient.get<T>(url, { params })).data

export const portalApi = {
  summary: (run?: string) => get<Summary>('/summary', { run }),
  insights: (query: InsightQuery) => get<{ run: string; total: number; items: Insight[] }>('/insights', query),
  regions: (run?: string) => get<{ run: string; regions: Region[] }>('/regions', { run }),
  taxon: (id: string, run?: string) =>
    get<{ run: string; taxon: Record<string, any>; insights: Insight[]; ai_insights: Record<string, any>[] }>(
      `/taxa/${encodeURIComponent(id)}`,
      { run },
    ),
  runs: () => get<{ runs: Run[] }>('/runs'),
  run: (id: string) => get<{ run: Run & { params: any; corpus: any }; comparison: Record<string, any> | null }>(`/runs/${id}`),
  baseline: (run?: string) => get<{ run: string; baseline: ManualBaseline | null }>('/baseline', { run }),
  currency: () => get<{ months: { month: string; records: number; wild: number; datasets: number }[] }>('/currency'),
  taxonSeries: (id: string, run?: string) =>
    get<{
      windows: { baseline: { start: string; end: string }; recent: { start: string; end: string } }
      years: { year: number; records: number; wild: number; datasets: number }[]
      regions: { region: string; baseline: number; recent: number; since_2015: number }[]
    }>(`/taxon-series/${encodeURIComponent(id)}`, { run }),
  queries: (ids: number[]) => get<{ queries: LoggedQuery[] }>('/queries', { ids: ids.join(',') }),
}
