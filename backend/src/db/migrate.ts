import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AI_READER_PASSWORD, closeDb, db } from "./pool.ts";

/**
 * Applies `db/migrations/*.sql` in name order, each in its own transaction, recording what has
 * run in `public.schema_migrations`. Before the migrations, it makes sure the ai_reader role
 * exists with the configured password — a migration file cannot carry a secret.
 *
 *   npm run db:migrate
 */
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");

async function ensureAiReaderRole(): Promise<void> {
  const client = await db().connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_roles where rolname = 'ai_reader'");
    // Identifiers and passwords cannot be bound parameters; the password is escaped as a literal.
    const password = client.escapeLiteral(AI_READER_PASSWORD);
    await client.query(
      rowCount === 0
        ? `create role ai_reader login password ${password}`
        : `alter role ai_reader with login password ${password}`,
    );
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  await ensureAiReaderRole();

  const client = await db().connect();
  try {
    await client.query(
      "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const applied = new Set(
      (await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
      }
    }
    console.log("migrations up to date");
  } finally {
    client.release();
  }
}

migrate()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
