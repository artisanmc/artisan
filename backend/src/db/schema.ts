import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull(),
});

export const packBundles = pgTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("server_pack_uniq").on(t.serverId, t.packId),
]);
