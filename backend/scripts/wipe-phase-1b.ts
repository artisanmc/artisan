import { db } from "../src/db/index";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[wipe] Dropping Phase 1B tables (preserving Plan 1A users/sessions/discord)...");
  await db.execute(sql`DROP TABLE IF EXISTS pack_conflicts CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS assets CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS pack_bundles CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS editor_sessions CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS link_codes CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS server_keys CASCADE`);
  console.log("[wipe] Done. Run `bun run db:push` to apply the new schema.");
}

main().catch((e) => { console.error(e); process.exit(1); });
