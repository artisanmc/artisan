import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { assertTestDatabaseName } from "../../../scripts/testPlan";

test("0061 preserves existing offers as private inactive custom drafts with their original rights and cadence", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assertTestDatabaseName(url.pathname.slice(1));
  const sql = postgres(url.toString(), { max: 1, prepare: false });
  const rollback = new Error("rollback_migration_fixture");
  try {
    await sql.begin(async tx => {
      const [identity] = await tx`SELECT current_database() AS name`;
      expect(identity.name).toBe(url.pathname.slice(1));
      const namespace = `catalog_migration_${crypto.randomUUID().replaceAll("-", "")}`;
      await tx.unsafe(`CREATE SCHEMA "${namespace}"`);
      await tx.unsafe(`SET LOCAL search_path TO "${namespace}", public`);
      const snapshot = JSON.parse(readFileSync(new URL("../../../drizzle/meta/0060_snapshot.json", import.meta.url), "utf8"));
      const columns = Object.values(snapshot.tables["public.subscription_plans"].columns) as {
        name: string; type: string; primaryKey: boolean; notNull: boolean; default?: string | number | boolean;
      }[];
      await tx.unsafe(`CREATE TABLE subscription_plans (${columns.map(column =>
        `"${column.name}" ${column.type}${column.primaryKey ? " PRIMARY KEY" : ""}${column.notNull ? " NOT NULL" : ""}${column.default !== undefined ? ` DEFAULT ${column.default}` : ""}`,
      ).join(", ")})`);
      for (const interval of ["month", "year"]) {
        for (const editorPro of [false, true]) {
          const id = `manual-${interval}-${editorPro}`;
          await tx`INSERT INTO subscription_plans
            (id, name, interval, price_cents, credits_per_period, rollover_cap, features,
             description, highlighted, editor_pro, is_active, sort_order, stripe_product_id,
             stripe_price_id, created_at, updated_at)
            VALUES (${id}, ${`Manual ${id}`}, ${interval}, 1700, 42, 100, 'Existing feature',
              'Existing description', true, ${editorPro}, true, 7, ${`prod_${id}`},
              ${`price_${id}`}, '2026-01-01 12:00:00', '2026-09-01 13:00:00')`;
        }
      }
      const before = await tx`SELECT * FROM subscription_plans ORDER BY id`;
      const migration = readFileSync(new URL("../../../drizzle/0061_fair_lady_deathstrike.sql", import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.unsafe(statement);
      }
      const after = await tx`SELECT * FROM subscription_plans ORDER BY id`;
      expect(after).toHaveLength(4);
      for (const [index, row] of after.entries()) {
        expect(row).toMatchObject({
          ...before[index],
          key: `custom:${before[index].id}`,
          version: 1,
          managed_by: "admin",
          audience: "private",
          target_network_id: null,
          publication_status: "draft",
          is_active: false,
          capabilities: { editorPro: before[index].editor_pro },
          limits: before[index].editor_pro
            ? { resourcesPerServer: 250, servers: 10, collaborators: null }
            : { resourcesPerServer: 10, servers: 2, collaborators: 2 },
          credit_interval: before[index].interval === "year" && !before[index].editor_pro ? "year" : "month",
        });
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await sql.end();
  }
});
