/**
 * Cross-cutting ingestion settings. Seeded from config rather than hard-coded so that a run
 * is described by values that can be version-controlled and quoted in the write-up.
 *
 * Overridable by env var so that a slow or unhappy source can be accommodated without a
 * code change — but the defaults are the polite ones, and the defaults are what is committed.
 */
const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const INGESTION = {
  /**
   * Ethics pillar 1 requires an identifying User-Agent naming the project and a contact
   * address, so a source operator who objects to this traffic can reach someone.
   */
  userAgent:
    process.env.INGESTION_USER_AGENT ??
    "ConservationReportingPlatform/0.1 (UTS Honours research; +mailto:sam@samlogan.com.au)",

  /** Ethics pillar 1: >= 1000ms between requests to the same host. */
  minRequestIntervalMs: num("INGESTION_MIN_INTERVAL_MS", 1100),

  requestTimeoutMs: num("INGESTION_TIMEOUT_MS", 60_000),
  maxAttempts: num("INGESTION_MAX_ATTEMPTS", 4),
  baseBackoffMs: num("INGESTION_BASE_BACKOFF_MS", 2_000),
  maxBackoffMs: num("INGESTION_MAX_BACKOFF_MS", 30_000),

  /** Where frozen snapshots and canonical output are written. */
  dataDir: process.env.INGESTION_DATA_DIR ?? "data",
} as const;
