import { HostRateLimiter } from "./rateLimiter.ts";
import { INGESTION } from "../config/ingestion.ts";

/**
 * The only way ingestion code reaches the network.
 *
 * Ethics pillar 1 in one place: identifying User-Agent, per-host rate limiting, bounded
 * retries with backoff. It returns the response body as an unparsed string, because the
 * snapshot store has to freeze exactly what arrived — parsing first would mean freezing our
 * reading of the response rather than the response.
 */

export interface FetchResult {
  url: string;
  status: number;
  /** Verbatim response body. Frozen as-is; parsed only downstream. */
  body: string;
  /** Wall-clock time for the successful attempt, in ms. */
  durationMs: number;
  /** How many attempts were needed. >1 means the source pushed back. */
  attempts: number;
  fetchedAt: string;
}

export class PoliteHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "PoliteHttpError";
  }
}

/** Status codes worth retrying: rate limiting and transient upstream failures. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const limiter = new HostRateLimiter(INGESTION.minRequestIntervalMs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url: string): Promise<FetchResult> {
  const host = new URL(url).host;
  let lastError: string = "no attempt made";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= INGESTION.maxAttempts; attempt++) {
    const result = await limiter.schedule(host, async () => {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          headers: {
            // Ethics pillar 1: identify the client and give the source a contact address.
            "User-Agent": INGESTION.userAgent,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(INGESTION.requestTimeoutMs),
        });
        const body = await response.text();
        return { ok: true as const, response, body, durationMs: Date.now() - startedAt };
      } catch (error) {
        return { ok: false as const, error, durationMs: Date.now() - startedAt };
      }
    });

    if (result.ok && result.response.ok) {
      return {
        url,
        status: result.response.status,
        body: result.body,
        durationMs: result.durationMs,
        attempts: attempt,
        fetchedAt: new Date().toISOString(),
      };
    }

    if (result.ok) {
      lastStatus = result.response.status;
      lastError = `HTTP ${lastStatus}: ${result.body.slice(0, 200)}`;
      // A 4xx that is not rate limiting will not fix itself — fail fast rather than hammer.
      if (!RETRYABLE.has(lastStatus)) {
        throw new PoliteHttpError(lastError, lastStatus, url, attempt);
      }
      // Honour Retry-After when the source sends one; it is the source telling us the answer.
      const retryAfter = Number(result.response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(Math.min(retryAfter * 1000, INGESTION.maxBackoffMs));
        continue;
      }
    } else {
      lastError = result.error instanceof Error ? result.error.message : String(result.error);
    }

    if (attempt < INGESTION.maxAttempts) {
      // Exponential backoff with jitter, so parallel harvests do not resynchronise on retry.
      const backoff = Math.min(INGESTION.baseBackoffMs * 2 ** (attempt - 1), INGESTION.maxBackoffMs);
      await sleep(backoff + Math.random() * INGESTION.baseBackoffMs);
    }
  }

  throw new PoliteHttpError(
    `giving up after ${INGESTION.maxAttempts} attempts — ${lastError}`,
    lastStatus,
    url,
    INGESTION.maxAttempts,
  );
}
