import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const serverKeys = sqliteTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
