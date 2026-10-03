import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** Clean axis ticks from zero: 0 / 1,000 / 2,000 rather than 0 / 1,293 / 2,586. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Compact figure for an axis tick: 80,000 → 80K. */
export const compact = (value: number): string =>
  value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${+(value / 1_000).toFixed(1)}K` : String(value);

/** The rendered width of an element, kept current as the layout changes. */
export function useWidth(el: Ref<HTMLElement | null>, fallback = 600) {
  const width = ref(fallback);
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    if (!el.value) return;
    width.value = el.value.clientWidth || fallback;
    observer = new ResizeObserver(([entry]) => {
      if (entry) width.value = entry.contentRect.width || fallback;
    });
    observer.observe(el.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
export function columnPath(x: number, y: number, w: number, baseline: number, r = 4): string {
  const h = baseline - y;
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${baseline}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${baseline}Z`;
}
