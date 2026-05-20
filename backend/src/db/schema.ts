import { pgTable, text, timestamp, uniqueIndex, integer, jsonb, index } from "drizzle-orm/pg-core";
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
  deletedAt: timestamp("deleted_at"),
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

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id),
  type: text("type").notNull(),                 // "texture" | "glyph" | "font"
  name: text("name").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  ascent: integer("ascent"),                    // nullable, set only for type=glyph
  codepoint: integer("codepoint"),              // nullable, set only for type=glyph
  fontMeta: jsonb("font_meta"),                 // forward-compat for Sub-project 4
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("assets_serverkey_name_type_uniq").on(t.serverKeyId, t.type, t.name),
  uniqueIndex("assets_serverkey_codepoint_uniq")
    .on(t.serverKeyId, t.codepoint)
    .where(sql`codepoint IS NOT NULL`),
  index("assets_serverkey_type_idx").on(t.serverKeyId, t.type),
]);

export const packConflicts = pgTable("pack_conflicts", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull(),
  diskFilesJson: text("disk_files_json").notNull(),
  diskHash: text("disk_hash").notNull(),
  lastSyncedHash: text("last_synced_hash").notNull(),
  backendHashAtDetection: text("backend_hash_at_detection").notNull(),
  detectedAt: timestamp("detected_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"), // NULL | "editor" | "server"
}, (t) => [
  uniqueIndex("pack_conflicts_open_uniq")
    .on(t.serverId, t.packId)
    .where(sql`resolved_at IS NULL`),
]);
