import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log("[migrate] applying migrations from ./drizzle/");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[migrate] done");

await client.end();
