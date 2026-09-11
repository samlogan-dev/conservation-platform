import { createHmac } from "node:crypto";

/**
 * Ethics pillar 2 — contributor privacy.
 *
 * ALA's `recordedBy` carries observer identifiers, and across contributing data resources
 * those range from opaque codes ("OPJG22080905") to organisation names ("WIRES-HO") to, on
 * citizen-science resources, real personal names. The canonical record therefore stores an
 * anonymised platform identifier and never the raw value.
 *
 * The raw value survives in the frozen snapshot, which is the correct place for it: the
 * snapshot is the unmodified evidence of what the source returned, is not served to the
 * frontend, and is what makes re-derivation possible.
 *
 * HMAC rather than a plain hash: a bare sha256 of a short identifier is trivially reversible
 * by enumeration, which would defeat the point. The salt is read from the environment so that
 * pseudonyms are stable within a deployment and not comparable across unrelated ones.
 */
const SALT =
  process.env.CONTRIBUTOR_PSEUDONYM_SALT ??
  // A committed default keeps the dev loop running without setup. It is not a secret and is
  // not treated as one — deployments that matter set the env var.
  "stage1-development-salt";

export function pseudonymiseContributor(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.join("|") : value;
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const digest = createHmac("sha256", SALT).update(trimmed.toLowerCase()).digest("hex");
  return `obs_${digest.slice(0, 16)}`;
}
