import type { PortalWindow } from "@/apis/portalTypes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);

/** "2025" for a calendar year, "Jan–Jun 2025" for a part-year inside one year, the dates otherwise. */
export function windowLabel(w: Pick<PortalWindow, "startDate" | "endDate" | "calendarYear">): string {
  if (w.calendarYear !== null) return String(w.calendarYear);
  const [sy, ey] = [w.startDate.slice(0, 4), w.endDate.slice(0, 4)];
  if (sy === ey) return `${month(w.startDate)}–${month(w.endDate)} ${sy}`;
  return `${w.startDate} → ${w.endDate}`;
}

/** The console route that shows one run's records, for tracing a portal figure back to its source. */
export const consoleRunLink = (harvestKey: string, runId: string, page: "schema" | "raw" = "schema") => ({
  path: page === "raw" ? "/console" : "/console/schema",
  query: { harvest: harvestKey, run: runId },
});
