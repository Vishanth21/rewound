// scripts/migrate.ts
// STAND-IN for Member B's migration runner (design plan section 17). Replace with B's version.
//
//   npm run db:migrate          apply every db/migrations/*.sql not applied yet, in name order
//   npm run db:reset            drop the whole schema and the login roles, then apply everything
//
// Runs as the schema owner (MIGRATION_DATABASE_URL). For a migration number that has no real
// file yet, the stand-in from db/tests/stubs/ is used, as db/tests/run_tests.py does.
// Role passwords come from APP_DB_PASSWORD / ANALYST_DB_PASSWORD and replace the psql
// variables :'app_pw' / :'analyst_pw', so they are never written into the SQL files.
//
// A stand-in is recorded as "stub:<file>" so that once the real file lands, the database is
// known to be out of date. Stand-ins cannot be upgraded in place (the real file re-creates the
// same tables), so in that case, or when a migration is missing from the middle of the history
// (databases migrated before stand-ins were recorded this way), the script stops and asks for
// `npm run db:reset` instead of skipping migrations and leaving the app half-built.
import { need } from "./env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS = "db/migrations";
const STUBS = "db/tests/stubs";
const num = (f: string) => Number(f.split("_", 1)[0]);
const literal = (s: string) => "'" + s.replace(/'/g, "''") + "'";

type Migration = { file: string; key: string };

function migrationFiles(): Migration[] {
  const real = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  const have = new Set(real.map(num));
  const stubs = readdirSync(STUBS).filter((f) => f.endsWith(".sql") && !have.has(num(f)));
  return [
    ...real.map((f) => ({ file: path.join(MIGRATIONS, f), key: f })),
    ...stubs.map((f) => ({ file: path.join(STUBS, f), key: `stub:${f}` })),
  ].sort((a, b) => num(path.basename(a.file)) - num(path.basename(b.file)) || a.file.localeCompare(b.file));
}

// Why this database cannot be brought up to date by applying the remaining files, or null.
function outOfDate(migrations: Migration[], done: Set<string>): string | null {
  const realNums = new Set(migrations.filter((m) => !m.key.startsWith("stub:")).map((m) => num(m.key)));
  const replaced = [...done].filter((k) => k.startsWith("stub:") && realNums.has(num(k.slice(5))));
  if (replaced.length) return `built with stand-ins that now have real migrations: ${replaced.join(", ")}`;

  const lastDone = Math.max(-1, ...migrations.filter((m) => done.has(m.key)).map((m) => num(path.basename(m.file))));
  const gaps = migrations.filter((m) => !done.has(m.key) && num(path.basename(m.file)) < lastDone);
  if (gaps.length) return `earlier migrations were never applied: ${gaps.map((m) => m.key).join(", ")}`;
  return null;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const db = new Client({ connectionString: need("MIGRATION_DATABASE_URL") });
  await db.connect();
  try {
    if (reset) {
      await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await db.query("DROP ROLE IF EXISTS lecturelens_app; DROP ROLE IF EXISTS lecturelens_analyst;");
      console.log("reset: schema and login roles dropped");
    }
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
                      file text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await db.query("SELECT file FROM schema_migrations")).rows.map((r) => r.file as string));

    const migrations = migrationFiles();
    const problem = outOfDate(migrations, done);
    if (problem) {
      throw new Error(
        `this database is out of date (${problem}).\n` +
          "It cannot be upgraded in place. Run `npm run db:reset` then `npm run db:seed` (this deletes all data).",
      );
    }

    for (const { file, key } of migrations) {
      if (done.has(key)) continue;
      const sql = readFileSync(file, "utf8")
        .replace(/:'app_pw'/g, literal(need("APP_DB_PASSWORD")))
        .replace(/:'analyst_pw'/g, literal(need("ANALYST_DB_PASSWORD")));
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations (file) VALUES ($1)", [key]);
        await db.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (e) {
        await db.query("ROLLBACK");
        throw new Error(`${file}: ${(e as Error).message}`);
      }
    }
    console.log("migrations up to date");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
