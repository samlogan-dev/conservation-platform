/**
 * Per-host rate limiting. Ethics pillar 1 (polite ingestion): a minimum interval between
 * requests to the same host, enforced by serialising them through a per-host promise chain.
 *
 * Serialising rather than merely delaying matters — concurrent callers would otherwise each
 * check the clock, see enough elapsed time, and fire together.
 */
export class HostRateLimiter {
  private queues = new Map<string, Promise<void>>();
  private lastRequestAt = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  /** Run `fn` once the host's minimum interval has elapsed since the previous call. */
  async schedule<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(host) ?? Promise.resolve();

    const turn = previous.then(async () => {
      const last = this.lastRequestAt.get(host);
      if (last !== undefined) {
        const wait = this.minIntervalMs - (Date.now() - last);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      this.lastRequestAt.set(host, Date.now());
    });

    // Keep the chain alive even if a caller's fn rejects, or one failure stalls the host.
    this.queues.set(
      host,
      turn.then(
        () => undefined,
        () => undefined,
      ),
    );

    await turn;
    return fn();
  }
}
