/**
 * Test runner — isolates tests in a separate `artisan_test` DB so they
 * never wipe the developer's `artisan` dev DB.
 *
 * Flow :
 *   1. Connect to the default `postgres` database as admin.
 *   2. CREATE DATABASE "artisan_test" if it doesn't already exist.
 *   3. Run Drizzle migrations against it.
 *   4. Spawn `bun test --isolate` with DATABASE_URL pointing at the test DB.
 *
 * Override the admin URL via ADMIN_DATABASE_URL if your local Postgres uses
 * different credentials (e.g. `postgresql://user:pwd@localhost:5432/postgres`).
 */
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import postgres from "postgres";
import { spawnSync } from "child_process";

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const TEST_DB = process.env.TEST_DATABASE_NAME ?? "artisan_test";
const HOST = new URL(ADMIN_URL).host;
const USER = new URL(ADMIN_URL).username;
const PWD = new URL(ADMIN_URL).password;
const TEST_URL = `postgresql://${USER}:${PWD}@${HOST}/${TEST_DB}`;

async function ensureTestDb(): Promise<void> {
  const sql = postgres(ADMIN_URL);
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`;
    if (rows.length === 0) {
      console.log(`[test] creating database "${TEST_DB}"`);
      await sql.unsafe(`CREATE DATABASE "${TEST_DB}"`);
    }
  } finally {
    await sql.end();
  }
}

function migrateTestDb(): void {
  console.log(`[test] migrating "${TEST_DB}"`);
  const r = spawnSync("bun", ["run", "src/db/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runTests(): void {
  console.log(`[test] running bun test --isolate against "${TEST_DB}"`);
  const args = ["test", "--isolate", ...process.argv.slice(2)];
  // Cache d'assets isolé et NEUF à chaque run : partagé avec le dev, il ferait
  // passer des tests sur des octets laissés par un run précédent — un cache qui
  // survit à ce qu'il cache est un test qui ne teste plus rien.
  const assetCacheDir = join(tmpdir(), `artisan-asset-cache-test-${process.pid}`);
  rmSync(assetCacheDir, { recursive: true, force: true });
  const r = spawnSync("bun", args, {
    env: { ...process.env, DATABASE_URL: TEST_URL, ASSET_CACHE_DIR: assetCacheDir },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  rmSync(assetCacheDir, { recursive: true, force: true });
  process.exit(r.status ?? 0);
}

await ensureTestDb();
migrateTestDb();
runTests();
