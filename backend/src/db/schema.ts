import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const networks = pgTable(
	"networks",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		// URL slug, globally unique. Nullable only so the column can be added to
		// existing rows before backfillSlugs() populates them; set on create.
		slug: text("slug"),
		tier: text("tier").notNull().default("free"),
		subscriptionId: text("subscription_id"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [uniqueIndex("networks_slug_uniq").on(t.slug)],
);

export const serverKeys = pgTable(
	"server_keys",
	{
		id: text("id").primaryKey(),
		hash: text("hash").notNull(),
		label: text("label"),
		// URL slug, unique per network. Nullable during backfill; set on create.
		slug: text("slug"),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		lastMcVersion: text("last_mc_version"),
		createdAt: timestamp("created_at").notNull(),
		resourcePackHash: text("resource_pack_hash"),
		resourcePackUpdatedAt: timestamp("resource_pack_updated_at"),
		// Optional IP allowlist. If null OR empty array → any source IP is accepted
		// (default behaviour). Otherwise the hello must come from a listed IP, else
		// it's rejected and the attempt is recorded in server_key_helloes with a
		// non-null `rejected_reason`.
		allowedIps: jsonb("allowed_ips").$type<string[] | null>(),
	},
	(t) => [
		index("server_keys_network_idx").on(t.networkId),
		uniqueIndex("server_keys_network_slug_uniq").on(t.networkId, t.slug),
	],
);

// Append-only audit log of plugin hellos. One row per successful `hello`,
// so an admin can spot anomalies (unexpected IPs, hellos at odd hours) and
// rotate the key if it looks compromised. This is the actual defense — the
// key itself is a bearer secret and can't be made un-stealable.
export const serverKeyHelloes = pgTable(
	"server_key_helloes",
	{
		id: text("id").primaryKey(),
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		ip: text("ip").notNull(),
		mcVersion: text("mc_version"),
		helloAt: timestamp("hello_at").notNull(),
		// null = accepted; non-null = rejected with this reason (e.g. "ip_not_allowed").
		// Surfacing rejections is what lets an admin diagnose a misconfigured allowlist
		// (legit server suddenly "offline") without digging through plugin logs.
		rejectedReason: text("rejected_reason"),
	},
	(t) => [
		index("server_key_helloes_key_time_idx").on(t.serverKeyId, t.helloAt),
	],
);

// Active module set per server, reported by the plugin at every `hello`
// (`installed_modules`). The editor reads this to decide which modules to
// mount — a module appears because its plugin is installed on the server.
// Presence only: removing a row hides the module's UI; authored content is
// never touched. Cf. docs/superpowers/specs/2026-06-15-modules-architecture-design.md §8.
export const serverModules = pgTable(
	"server_modules",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		moduleId: text("module_id").notNull(),
		version: text("version"),
		lastSeen: timestamp("last_seen").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.moduleId] })],
);

export const linkCodes = pgTable("link_codes", {
	code: text("code").primaryKey(),
	createdAt: timestamp("created_at").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	claimedAt: timestamp("claimed_at"),
	serverKeyId: text("server_key_id").references(() => serverKeys.id),
});

export const editorSessions = pgTable(
	"editor_sessions",
	{
		token: text("token").primaryKey(),
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		revokedAt: timestamp("revoked_at"),
		exchangedAt: timestamp("exchanged_at"),
		refreshToken: text("refresh_token"),
		accessToken: text("access_token"),
		accessExpiresAt: timestamp("access_expires_at"),
		trustCode: text("trust_code"),
		trustedAt: timestamp("trusted_at"),
		trustedIp: text("trusted_ip"),
	},
	(t) => [
		uniqueIndex("trust_code_uniq")
			.on(t.trustCode)
			.where(sql`trust_code IS NOT NULL`),
	],
);

export const users = pgTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		name: text("name").notNull(),
		passwordHash: text("password_hash"), // null = Discord-only users
		avatarUrl: text("avatar_url"),
		editorLanguage: text("editor_language"), // null = no preference set
		theme: text("theme"), // "dark" | "light" | null
		isAdmin: boolean("is_admin").notNull().default(false),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [uniqueIndex("users_email_uniq").on(t.email)],
);

export const userSessions = pgTable(
	"user_sessions",
	{
		id: text("id").primaryKey(), // session token (random 32-char)
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull(),
		lastUsedAt: timestamp("last_used_at").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
	},
	(t) => [index("user_sessions_userid_idx").on(t.userId)],
);

export const discordAccounts = pgTable(
	"discord_accounts",
	{
		discordUserId: text("discord_user_id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		username: text("username").notNull(),
		email: text("email"),
		linkedAt: timestamp("linked_at").notNull(),
	},
	(t) => [uniqueIndex("discord_accounts_userid_uniq").on(t.userId)],
);

export const networkTransfers = pgTable(
	"network_transfers",
	{
		token: text("token").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		initiatedByUserId: text("initiated_by_user_id")
			.notNull()
			.references(() => users.id),
		expiresAt: timestamp("expires_at").notNull(),
		consumedAt: timestamp("consumed_at"),
		consumedByUserId: text("consumed_by_user_id").references(() => users.id),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [index("network_transfers_network_idx").on(t.networkId)],
);

export const memberships = pgTable(
	"memberships",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("memberships_user_network_uniq").on(t.userId, t.networkId),
		index("memberships_network_idx").on(t.networkId),
	],
);

export const packs = pgTable(
	"packs",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		// URL slug, unique per server key (workspace). Nullable during backfill.
		slug: text("slug"),
		description: text("description"),
		hash: text("hash").notNull().default(""),
		filesJson: text("files_json").notNull().default("{}"),
		editorJson: text("editor_json"),
		deployedEditorJson: text("deployed_editor_json"),
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("packs_network_idx").on(t.networkId),
		index("packs_network_deleted_idx").on(t.networkId, t.deletedAt),
		index("packs_server_key_idx").on(t.serverKeyId),
		uniqueIndex("packs_serverkey_slug_uniq").on(t.serverKeyId, t.slug),
	],
);

export const packCommits = pgTable(
	"pack_commits",
	{
		id: text("id").primaryKey(),
		packId: text("pack_id")
			.notNull()
			.references(() => packs.id, { onDelete: "cascade" }),
		parentId: text("parent_id"),
		parentId2: text("parent_id_2"),
		contentHash: text("content_hash").notNull(),
		filesJson: text("files_json").notNull(),
		editorJson: text("editor_json"),
		authorUserId: text("author_user_id"),
		message: text("message").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("pack_commits_pack_idx").on(t.packId),
		index("pack_commits_pack_created_idx").on(t.packId, t.createdAt),
		uniqueIndex("pack_commits_pack_content_uniq").on(t.packId, t.contentHash),
	],
);

export const packBranches = pgTable(
	"pack_branches",
	{
		packId: text("pack_id")
			.notNull()
			.references(() => packs.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		headCommitId: text("head_commit_id")
			.notNull()
			.references(() => packCommits.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		uniqueIndex("pack_branches_uniq").on(t.packId, t.name),
		index("pack_branches_head_idx").on(t.headCommitId),
	],
);

export const assets = pgTable(
	"assets",
	{
		id: text("id").primaryKey(),
		packId: text("pack_id")
			.notNull()
			.references(() => packs.id, { onDelete: "cascade" }),
		type: text("type").notNull(), // "texture" | "glyph" | "font"
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
	},
	(t) => [
		uniqueIndex("assets_pack_name_type_uniq").on(t.packId, t.type, t.name),
		uniqueIndex("assets_pack_codepoint_uniq")
			.on(t.packId, t.codepoint)
			.where(sql`codepoint IS NOT NULL`),
		index("assets_pack_type_idx").on(t.packId, t.type),
	],
);

// Generic platform-wide key/value store for super-admin settings (e.g. the AI
// assistant provider config). Values are JSON-stringified; secrets within are
// encrypted via secretBox before being stored.
export const appSettings = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(), // JSON stringifié
	updatedAt: timestamp("updated_at").notNull(),
	updatedBy: text("updated_by").references(() => users.id),
});

// AI assistant conversation history. Scoped per `(ownerKey, packId)` so the
// panel can list a workspace's past conversations and resume them. `messages`
// holds the full LLM transcript (LlmMessage[]) — the working copy is rebuilt
// from the live pack on each turn, so it is NOT persisted here. `ownerKey`
// mirrors routes.ts `resolveOwnerKey`: `sk:<serverKeyId>` or `user:<userId>`.
export const assistantConversations = pgTable(
	"assistant_conversations",
	{
		id: text("id").primaryKey(),
		ownerKey: text("owner_key").notNull(),
		packId: text("pack_id").notNull(),
		title: text("title").notNull().default(""),
		messages: jsonb("messages").notNull().$type<unknown[]>(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [index("assistant_conv_owner_pack_idx").on(t.ownerKey, t.packId)],
);
