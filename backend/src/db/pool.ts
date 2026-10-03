import "dotenv/config";
import pg from "pg";

/**
 * Database connections.
 *
 * Two roles, two pools. The platform role owns the schema and writes the corpus and the analysis
 * output. The ai_reader role is what the AI arm's query tool connects as: read-only, corpus
 * schema only, statement-time-limited — so the restriction is enforced by Postgres rather than
 * by the tool's own good behaviour.
 *
 * The defaults match docker-compose.yml, so a fresh checkout works with no .env entries.
 */
const DEFAULT_URL = "postgres://platform:platform@localhost:54329/platform";
const DEFAULT_AI_READER_PASSWORD = "ai_reader_local";

export const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_URL;
export const AI_READER_PASSWORD = process.env.AI_READER_PASSWORD ?? DEFAULT_AI_READER_PASSWORD;

/** The ai_reader connection string: the platform URL with the role and password swapped. */
export function aiReaderUrl(): string {
  if (process.env.AI_DATABASE_URL) return process.env.AI_DATABASE_URL;
  const url = new URL(DATABASE_URL);
  url.username = "ai_reader";
  url.password = AI_READER_PASSWORD;
  return url.toString();
}

let platformPool: pg.Pool | null = null;
let aiReaderPool: pg.Pool | null = null;

export function db(): pg.Pool {
  platformPool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
  return platformPool;
}

export function aiReaderDb(): pg.Pool {
  aiReaderPool ??= new pg.Pool({ connectionString: aiReaderUrl(), max: 4 });
  return aiReaderPool;
}

export async function closeDb(): Promise<void> {
  await Promise.all([platformPool?.end(), aiReaderPool?.end()]);
  platformPool = null;
  aiReaderPool = null;
}
