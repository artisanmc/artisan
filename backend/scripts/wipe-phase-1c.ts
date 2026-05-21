import { db } from "../src/db/index";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[wipe-1c] Dropping pack_conflicts...");
  await db.execute(sql`DROP TABLE IF EXISTS pack_conflicts CASCADE`);
  console.log("[wipe-1c] Done. Run `bun run db:push` to apply the schema.");
}

main().catch((e) => { console.error(e); process.exit(1); });
