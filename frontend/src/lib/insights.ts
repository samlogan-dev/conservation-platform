import type { Insight, InsightType } from '@/apis/portal'

/** What each insight is, in practitioner terms, and how its labels read. */
export const INSIGHT_META: Record<
  Exclude<InsightType, 'other'>,
  { number: number; title: string; question: string; labels: Record<string, string>; defaultSort: string }
> = {
  silent_species: {
    number: 1,
    title: 'Silent species and evidence gaps',
    question: 'Which threatened species have gone quiet, or have too little data to judge — nationally and by bioregion?',
    labels: { silent: 'Silent', evidence_gap: 'Evidence gap', regional_silence: 'Regional silence' },
    defaultSort: 'baseline_annual_mean',
  },
  range_change: {
    number: 2,
    title: 'Range change',
    question: 'Is a species’ footprint contracting, in the area-of-occupancy terms listing assessments use?',
    labels: { contraction: 'Contraction', expansion: 'Expansion' },
    defaultSort: 'aoo_change_reliable',
  },
  reporting_rate: {
    number: 3,
    title: 'Reporting-rate trend',
    question: 'Is a species recorded less often relative to how much recording happens where it lives?',
    labels: { decline: 'Decline', increase: 'Increase' },
    defaultSort: 'detection_ratio',
  },
  co_movement: {
    number: 4,
    title: 'Regional co-movement',
    question: 'Where are several threatened species moving together in one bioregion?',
    labels: { co_decline: 'Co-decline', co_increase: 'Co-increase' },
    defaultSort: 'p_decline',
  },
  notable_record: {
    number: 5,
    title: 'Notable records this month',
    question: 'What is new: records far outside a species’ known range, in a new bioregion, or out of season?',
    labels: {},
    defaultSort: 'distance',
  },
}

export const INSIGHT_ORDER = Object.keys(INSIGHT_META) as (keyof typeof INSIGHT_META)[]

/** The label an insight is filed under: its kind or flag. */
export const labelOf = (i: Pick<Insight, 'figures'>): string | null => i.figures.kind ?? i.figures.flag ?? null

/** Tone for a label: does it call for attention, signal recovery, or neither? */
export function toneOf(label: string | null): 'alert' | 'good' | 'neutral' {
  if (!label) return 'neutral'
  if (['silent', 'regional_silence', 'contraction', 'decline', 'co_decline'].includes(label)) return 'alert'
  if (['expansion', 'increase', 'co_increase'].includes(label)) return 'good'
  return 'neutral'
}

export const taxonName = (i: { vernacular_name: string | null; scientific_name: string | null }) =>
  i.vernacular_name ?? i.scientific_name ?? 'Unnamed taxon'

export function groupOf(i: { kingdom: string | null; taxon_class: string | null }): string {
  if (i.kingdom === 'Plantae') return 'plants'
  return { Aves: 'birds', Mammalia: 'mammals', Reptilia: 'reptiles', Amphibia: 'amphibians' }[i.taxon_class ?? ''] ?? 'other'
}

export const fmt = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-AU', { maximumFractionDigits: digits })

/** A ratio as a signed percentage change: 0.63 → "−37%". */
export const pctChange = (ratio: number | null | undefined) =>
  ratio === null || ratio === undefined ? '—' : `${ratio >= 1 ? '+' : '−'}${Math.abs(Math.round((ratio - 1) * 100))}%`

/** A fractional change as a signed percentage: −0.3 → "−30%". */
export const pct = (change: number | null | undefined) =>
  change === null || change === undefined ? '—' : `${change >= 0 ? '+' : '−'}${Math.abs(Math.round(change * 100))}%`

/** The one or two numbers that matter most for an insight, as short label–value pairs. */
export function keyFigures(i: Insight): { label: string; value: string }[] {
  const f = i.figures
  // A headline insight (AI arm): a count across all taxa, with no taxon or region of its own.
  if (isHeadline(i)) return [{ label: 'Count', value: fmt(f.count) }]
  switch (i.insight_type) {
    case 'silent_species':
      return f.kind === 'regional_silence'
        ? [
            { label: 'Baseline records', value: fmt(f.baseline_records) },
            { label: 'Last recorded here', value: f.last_record_date ?? '—' },
          ]
        : [
            { label: 'Last record', value: f.last_record_date ?? 'none since 2015' },
            { label: 'Records since 2015', value: fmt(f.records_since_2015) },
          ]
    case 'range_change':
      return [
        { label: 'AOO (10 km)', value: `${fmt(f.aoo_10km_km2?.baseline)} → ${fmt(f.aoo_10km_km2?.recent)} km² (${pct(f.aoo_10km_km2?.change)})` },
        { label: 'EOO', value: pct(f.eoo_km2?.change) },
      ]
    case 'reporting_rate':
      return [
        {
          label: 'Reporting rate',
          value: `${pctChange(f.detection_ratio)}${f.detection_ratio_ci95 ? ` (95% CI ${pctChange(f.detection_ratio_ci95[0])} to ${pctChange(f.detection_ratio_ci95[1])})` : ''}`,
        },
        { label: 'Detections', value: `${fmt(f.detections?.baseline)} → ${fmt(f.detections?.recent)}` },
      ]
    case 'co_movement':
      return [
        { label: 'Declined / increased', value: `${f.declines} / ${f.increases} of ${f.taxa_assessed}` },
        {
          label: f.flag === 'co_increase' ? 'p (q)' : 'p (q)',
          value: f.flag === 'co_increase' ? `${f.p_increase} (${f.q_increase})` : `${f.p_decline} (${f.q_decline})`,
        },
      ]
    case 'notable_record':
      return [
        { label: 'Records', value: fmt(f.records) },
        { label: 'Distance to nearest earlier', value: f.max_distance_to_prior_km === null ? 'no earlier record' : `${fmt(f.max_distance_to_prior_km)} km` },
      ]
    default:
      return []
  }
}

const REASONS: Record<string, string> = {
  outside_range: '>100 km from earlier records',
  new_region: 'new bioregion',
  out_of_season: 'out of season',
}
export const reasonText = (r: string) => REASONS[r] ?? r

/** A data caveat strong enough to show beside the finding itself, or null. */
export function caveatOf(i: Insight): string | null {
  const stopped = i.confidence.baseline_share_from_sources_no_longer_recording
  // Range change only: reporting rates already count consistent sources alone, so stopped sources cannot drive them.
  if (i.insight_type === 'range_change' && typeof stopped === 'number' && stopped >= 0.5) {
    return `Likely artefact: ${Math.round(stopped * 100)}% of baseline records came from sources that stopped recording it`
  }
  if (i.insight_type === 'range_change' && i.confidence.share_managed > 0.5) return 'Mostly managed populations'
  return null
}

/** For a co-movement finding, the taxa named in its summary (after "…expected (p …): "). */
export const movedTaxaText = (i: Insight) => i.summary.match(/\): (.+)\.$/)?.[1] ?? null

export const isHeadline = (i: Insight) => !i.taxon_concept_id && !i.region && typeof i.figures.count === 'number'

/**
 * Per bioregion, reporting-rate increases minus declines as a share of the taxa assessed there.
 * With one or two taxa a region swings to ±1 on a single species, so regions with fewer than
 * MIN_TAXA_FOR_BALANCE assessed are left unshaded.
 */
export const MIN_TAXA_FOR_BALANCE = 5
export const regionBalance = (regions: { region: string; co_movement: Record<string, any> | null }[]) =>
  Object.fromEntries(
    regions
      .filter((r) => (r.co_movement?.taxa_assessed ?? 0) >= MIN_TAXA_FOR_BALANCE)
      .map((r) => [r.region, (r.co_movement!.increases - r.co_movement!.declines) / r.co_movement!.taxa_assessed]),
  )
