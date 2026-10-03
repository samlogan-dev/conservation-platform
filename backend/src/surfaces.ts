/**
 * Which of the two surfaces this server exposes.
 *
 * The portal (practitioner-facing, read-only) is always on. The console (researcher-facing:
 * raw responses, run-by-run schema checks, starting harvests, generating the AI analysis) is
 * a flag, on by default for local work, because everything that touches a source system,
 * costs money, or serves unprotected data lives behind it. Switching it off for a deployment
 * removes those routes outright rather than relying on each one's own guard.
 */
export const SURFACES = {
  consoleEnabled: (process.env.CONSOLE_ENABLED ?? "true").toLowerCase() !== "false",
} as const;
