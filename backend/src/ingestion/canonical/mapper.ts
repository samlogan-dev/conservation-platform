import type { FieldStatus, FieldTrace } from "./record.ts";

/**
 * A small helper that produces a canonical value and its trace line at the same time.
 *
 * Keeping the two together is the whole point. If the trace were assembled separately from
 * the mapping, the two would drift and the record inspector would be showing a plausible
 * story rather than what actually happened.
 */
export class Mapper {
  private readonly traces: FieldTrace[] = [];
  private readonly consumed = new Set<string>();
  private readonly excluded: { field: string; reason: string; value: unknown }[] = [];

  constructor(private readonly raw: Record<string, unknown>) {}

  /** Mark a source field as accounted for without mapping it to a canonical field. */
  ignore(...sourceFields: string[]): void {
    for (const f of sourceFields) this.consumed.add(f);
  }

  /**
   * Record a considered decision NOT to keep a source field.
   *
   * Distinct from `ignore` (internal plumbing not worth showing) and from leaving a field
   * unmapped (an oversight, and a warning). These surface in the inspector as the menu of what
   * the record could be widened with, so a deliberate omission never decays into folklore
   * about what the source does and does not supply.
   */
  exclude(reason: string, ...sourceFields: string[]): void {
    for (const f of sourceFields) {
      this.consumed.add(f);
      if (f in this.raw && !isEmpty(this.raw[f])) {
        this.excluded.push({ field: f, reason, value: this.raw[f] });
      }
    }
  }

  /**
   * Read the first populated field from `sourceFields`, optionally transform it, and record
   * what happened.
   *
   * @param transform  Applied to the first populated raw value. Returning null means the
   *                   value was present but could not be used — recorded as `rejected`.
   */
  map<T>(
    canonicalField: string,
    sourceFields: string[],
    transform?: (value: unknown) => T | null,
    options?: { note?: string },
  ): T | null {
    for (const f of sourceFields) this.consumed.add(f);

    const present = sourceFields.filter((f) => f in this.raw);
    const populated = present.find((f) => !isEmpty(this.raw[f]));

    // Nothing to work with: distinguish "the source omitted this" from "the source carried it
    // and it was empty". ALA omits unpopulated fields entirely, so the distinction is real and
    // is exactly what the coverage view needs.
    if (populated === undefined) {
      const status: FieldStatus = present.length === 0 ? "absent_from_source" : "empty_in_source";
      this.traces.push({
        canonicalField,
        sourceFields,
        rawValue: present.length === 0 ? undefined : this.raw[present[0]!],
        canonicalValue: null,
        status,
        note: options?.note,
      });
      return null;
    }

    const rawValue = this.raw[populated];
    let canonicalValue: T | null;
    let status: FieldStatus;
    let note = options?.note;

    if (transform) {
      try {
        canonicalValue = transform(rawValue);
        if (canonicalValue === null) {
          status = "rejected";
          note = note ?? "source value present but could not be interpreted";
        } else {
          // "derived" earns its own status so the inspector can distinguish a value that was
          // carried across from one that was computed — epoch millis to ISO, array to scalar.
          status = deepEqual(canonicalValue, rawValue) ? "mapped" : "derived";
        }
      } catch (error) {
        canonicalValue = null;
        status = "rejected";
        note = error instanceof Error ? error.message : String(error);
      }
    } else {
      canonicalValue = rawValue as T;
      status = "mapped";
    }

    this.traces.push({
      canonicalField,
      sourceFields,
      rawValue,
      canonicalValue,
      status,
      // Name the field actually used when several were candidates — otherwise a fallback
      // looks identical to a first-choice hit.
      note:
        note ??
        (sourceFields.length > 1 ? `taken from \`${populated}\`` : undefined),
    });

    return canonicalValue;
  }

  /**
   * Compute a canonical value from several source fields at once, and record which were read.
   *
   * `map` takes the first populated field; a derived classification needs all of its inputs,
   * so it gets its own entry point. The trace shows every input that was populated, and the
   * status is always `derived`, so the inspector never presents a computed value as carried.
   */
  derive<T>(
    canonicalField: string,
    sourceFields: string[],
    compute: (values: Record<string, unknown>) => T,
    options?: { note?: string },
  ): T {
    for (const f of sourceFields) this.consumed.add(f);
    const values: Record<string, unknown> = {};
    for (const f of sourceFields) if (f in this.raw && !isEmpty(this.raw[f])) values[f] = this.raw[f];
    const canonicalValue = compute(values);
    this.traces.push({
      canonicalField,
      sourceFields,
      rawValue: values,
      canonicalValue,
      status: "derived",
      note: options?.note,
    });
    return canonicalValue;
  }

  getTraces(): FieldTrace[] {
    return this.traces;
  }

  getExcluded(): { field: string; reason: string; value: unknown }[] {
    return this.excluded;
  }

  /**
   * Source fields no mapping consumed. The cheapest early warning that the canonical shape is
   * too narrow, and the "what was dropped" half of the record inspector.
   */
  getUnmapped(): { field: string; value: unknown }[] {
    return Object.keys(this.raw)
      .filter((k) => !this.consumed.has(k))
      .sort()
      .map((field) => ({ field, value: this.raw[field] }));
  }
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// --- Shared value coercions ---

export const asString = (value: unknown): string | null => {
  // Guard null/undefined explicitly: String(null) is "null", a five-character string that would
  // sail through every downstream emptiness check. The Mapper screens these out before calling a
  // transform, but these helpers are also called directly by adapters, so they must be safe alone.
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parts = value.filter((v) => !isEmpty(v)).map((v) => String(v).trim());
    return parts.length > 0 ? parts.join("; ") : null;
  }
  const s = String(value).trim();
  return s === "" ? null : s;
};

export const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
};

export const asInteger = (value: unknown): number | null => {
  const n = asNumber(value);
  return n === null ? null : Math.trunc(n);
};
