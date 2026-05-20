import { pgTable, text, timestamp, uniqueIndex, integer, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const networks = pgTable("networks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull().default("free"),
  subscriptionId: text("subscription_id"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  lastMcVersion: text("last_mc_version"),
  createdAt: timestamp("created_at").notNull(),
  resourcePackHash: text("resource_pack_hash"),
  resourcePackUpdatedAt: timestamp("resource_pack_updated_at"),
}, (t) => [
  index("server_keys_network_idx").on(t.networkId),
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

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),       // null = Discord-only users
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("users_email_uniq").on(t.email),
]);

export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),               // session token (random 32-char)
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
  lastUsedAt: timestamp("last_used_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  index("user_sessions_userid_idx").on(t.userId),
]);

export const discordAccounts = pgTable("discord_accounts", {
  discordUserId: text("discord_user_id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  email: text("email"),
  linkedAt: timestamp("linked_at").notNull(),
}, (t) => [
  uniqueIndex("discord_accounts_userid_uniq").on(t.userId),
]);

export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("memberships_user_network_uniq").on(t.userId, t.networkId),
  index("memberships_network_idx").on(t.networkId),
]);

export const packs = pgTable("packs", {
  id: text("id").primaryKey(),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  hash: text("hash").notNull().default(""),
  filesJson: text("files_json").notNull().default("{}"),
  editorJson: text("editor_json"),
  deployedEditorJson: text("deployed_editor_json"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  index("packs_network_idx").on(t.networkId),
  index("packs_network_deleted_idx").on(t.networkId, t.deletedAt),
]);

export const packBindings = pgTable("pack_bindings", {
  id: text("id").primaryKey(),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("pack_bindings_uniq").on(t.serverKeyId, t.packId),
  index("pack_bindings_pack_idx").on(t.packId),
  index("pack_bindings_serverkey_idx").on(t.serverKeyId),
]);

export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  type: text("type").notNull(),                 // "texture" | "glyph" | "font"
  name: text("name").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  ascent: integer("ascent"),
  codepoint: integer("codepoint"),
  contentWidth: integer("content_width"),
  fontMeta: jsonb("font_meta"),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("assets_pack_name_type_uniq").on(t.packId, t.type, t.name),
  uniqueIndex("assets_pack_codepoint_uniq")
    .on(t.packId, t.codepoint)
    .where(sql`codepoint IS NOT NULL`),
  index("assets_pack_type_idx").on(t.packId, t.type),
]);

export const packConflicts = pgTable("pack_conflicts", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull(),  // no FK yet — Plan 1C will drop pack_conflicts entirely
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
