import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const serverKeys = sqliteTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const packBundles = sqliteTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [
  uniqueIndex("server_pack_uniq").on(t.serverId, t.packId),
]);
