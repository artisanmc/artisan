import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/artisan";

// Safety rail: Bun sets NODE_ENV=test automatically when running `bun test`.
// In that case the target DB MUST contain "test" in its name — the wrapper
// `scripts/test.ts` redirects DATABASE_URL to `artisan_test` before spawning
// the runner. Running `bun test` directly bypasses the wrapper and would let
// `beforeEach(clearAll)` wipe the dev DB. Real incident on 2026-06-01 —
// never again.
if (process.env.NODE_ENV === "test" && !/test/i.test(new URL(url).pathname)) {
  throw new Error(
    `[db] Refusing to instantiate against "${new URL(url).pathname}" while NODE_ENV=test. ` +
      `Use \`bun run test\` (which spawns the runner with DATABASE_URL=artisan_test) ` +
      `instead of \`bun test\` directly.`,
  );
}

const client = postgres(url);
export const db = drizzle(client, { schema });
