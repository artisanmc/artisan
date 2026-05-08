import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  lastMcVersion: text("last_mc_version"),
  createdAt: timestamp("created_at").notNull(),
});

export const packBundles = pgTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  editorJson: text("editor_json"),
  deployedEditorJson: text("deployed_editor_json"),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("server_pack_uniq").on(t.serverId, t.packId),
]);

export const linkCodes = pgTable("link_codes", {
  code: text("code").primaryKey(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at"),
  serverKeyId: text("server_key_id").references(() => serverKeys.id),
});

export const editorSessions = pgTable("editor_sessions", {
  token:           text("token").primaryKey(),
  serverKeyId:     text("server_key_id").notNull().references(() => serverKeys.id),
  createdBy:       text("created_by").notNull(),
  createdAt:       timestamp("created_at").notNull(),
  expiresAt:       timestamp("expires_at").notNull(),
  revokedAt:       timestamp("revoked_at"),
  exchangedAt:     timestamp("exchanged_at"),
  refreshToken:    text("refresh_token"),
  accessToken:     text("access_token"),
  accessExpiresAt: timestamp("access_expires_at"),
  trustCode:       text("trust_code"),
  trustedAt:       timestamp("trusted_at"),
  trustedIp:       text("trusted_ip"),
}, (t) => [
  uniqueIndex("trust_code_uniq").on(t.trustCode).where(sql`trust_code IS NOT NULL`),
]);
