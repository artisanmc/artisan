import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	customType,
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
		// NULL = server created in the editor but not yet redeemed via `/artisan link`
		// (no secret issued). A null hash never authenticates. Set at redeem time.
		hash: text("hash"),
		label: text("label"),
		// URL slug, unique per network. Nullable during backfill; set on create.
		slug: text("slug"),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		lastMcVersion: text("last_mc_version"),
		editorAccessMode: text("editor_access_mode").notNull().default("invitation"),
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

// Data sources reported by the plugin at every `hello` / `modules_changed`.
// Presence only — feeds the editor's menu source picker; refs may dangle
// (hermetic invariant: the editor never blocks on an unknown ref).
export const serverDataSources = pgTable(
	"server_data_sources",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		ref: text("ref").notNull(),
		schemaHint: text("schema_hint"),
		// Owning module reported by the plugin (null = core / third-party direct registration).
		moduleId: text("module_id"),
		// Declared typed schema, JSON array of {name, type, description} (null = undeclared).
		schemaJson: text("schema_json"),
		// "static" | "dynamic" — placement mode is gated on static (null = legacy/dynamic).
		stability: text("stability"),
		// Row key field name for a static source (null unless static).
		keyField: text("key_field"),
		reportedAt: timestamp("reported_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.ref] })],
);

// Module-declared Data models reported at Presence (ADR composable-data-models
// §4): model/v1 documents stored verbatim per server key, mirroring
// server_data_sources (upsert at hello/modules_changed, pruned to the report).
export const serverDeclaredModels = pgTable(
	"server_declared_models",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		modelId: text("model_id").notNull(),
		// The model/v1 document verbatim (may carry version + migrations).
		documentJson: text("document_json").notNull(),
		reportedAt: timestamp("reported_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.modelId] })],
);

// Module-declared Config screens reported at Presence (ADR module-config-screens):
// wire objects stored verbatim per server key, mirroring server_declared_models.
export const serverEditorScreens = pgTable(
	"server_editor_screens",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		screenId: text("screen_id").notNull(),
		// The declared screen verbatim ({id, module_id, label, table, project_id}).
		screenJson: text("screen_json").notNull(),
		reportedAt: timestamp("reported_at").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.screenId] })],
);

export const linkCodes = pgTable("link_codes", {
	code: text("code").primaryKey(),
	createdAt: timestamp("created_at").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	claimedAt: timestamp("claimed_at"),
	// Cascade: a link code is meaningless without its server key. Deleting the
	// key (soft-delete endpoint, network teardown, test cleanup) drops its codes.
	serverKeyId: text("server_key_id").references(() => serverKeys.id, { onDelete: "cascade" }),
});

export const networkInvites = pgTable(
	"network_invites",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		role: text("role").notNull().default("member"),
		code: text("code").notNull(),
		email: text("email"),
		maxUses: integer("max_uses"),
		usedCount: integer("used_count").notNull().default(0),
		expiresAt: timestamp("expires_at").notNull(),
		revokedAt: timestamp("revoked_at"),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("network_invites_code_uniq").on(t.code),
		index("network_invites_network_idx").on(t.networkId),
	],
);

// Network access requests: a non-member asks to join; an owner/admin
// approves (→ membership "member") or denies. Applicative uniqueness only —
// createRequest() refuses a second row while a pending one exists for
// (userId, networkId); no partial unique index in plain drizzle.
export const networkAccessRequests = pgTable(
	"network_access_requests",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		message: text("message"),
		status: text("status").notNull().default("pending"), // pending | approved | denied
		resolvedBy: text("resolved_by"),
		createdAt: timestamp("created_at").notNull(),
		resolvedAt: timestamp("resolved_at"),
	},
	(t) => [
		index("network_access_requests_network_idx").on(t.networkId),
		index("network_access_requests_user_idx").on(t.userId),
	],
);

export interface EditorTourState {
	step: number;
	completed: boolean;
}

export const users = pgTable(
	"users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		name: text("name").notNull(),
		passwordHash: text("password_hash"), // null = OAuth-only users
		avatarUrl: text("avatar_url"),
		editorLanguage: text("editor_language"), // null = no preference set
		theme: text("theme"), // "dark" | "light" | null
		editorTour: jsonb("editor_tour").$type<EditorTourState>(),
		isAdmin: boolean("is_admin").notNull().default(false),
		// Last AI model picked in the assistant selector (plain id, no FK:
		// ai_models is declared later in this file and models are never
		// hard-deleted; a dangling id falls back to the default model at read time).
		preferredAiModelId: text("preferred_ai_model_id"),
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

// Password reset: one row per "forgot password" request. Only the SHA-256 of
// the emailed token is stored — a DB dump never yields a usable reset link.
// Consumption is atomic (used_at null + not expired) so a token is single-use
// even under concurrent submits.
export const passwordResetTokens = pgTable(
	"password_reset_tokens",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenHash: text("token_hash").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("password_reset_tokens_hash_uniq").on(t.tokenHash),
		index("password_reset_tokens_userid_idx").on(t.userId),
	],
);

export const accountDeletionTokens = pgTable("account_deletion_tokens", {
	userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	tokenHash: text("token_hash").notNull().unique(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at").notNull(),
});

export const oauthAccounts = pgTable(
	"oauth_accounts",
	{
		provider: text("provider").notNull(),
		subject: text("subject").notNull(),
		userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		email: text("email"),
		linkedAt: timestamp("linked_at").notNull(),
	},
	(t) => ({
		identity: primaryKey({ columns: [t.provider, t.subject] }),
		userProvider: uniqueIndex("oauth_accounts_provider_user_uniq").on(t.provider, t.userId),
	}),
);

// Retained as migration history; live OAuth identities use oauthAccounts.
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

export const demoSessions = pgTable("demo_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  projectId: text("project_id").notNull().unique(),
  state: text("state").notNull().$type<"active" | "claiming" | "claimed" | "expired">(),
  createdAt: timestamp("created_at").notNull(),
  lastActivityAt: timestamp("last_activity_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  rateKey: text("rate_key").notNull(),
  claimOperationId: text("claim_operation_id"),
  claimOwnerId: text("claim_owner_id"),
  claimNetworkId: text("claim_network_id"),
  supersededClaims: jsonb("superseded_claims").notNull().default([]).$type<{operationId:string;networkId:string;ownerId:string}[]>(),
}, t => ({expiry:index("demo_sessions_expiry_idx").on(t.state, t.expiresAt),rate:index("demo_sessions_rate_idx").on(t.rateKey, t.createdAt),state:check("demo_sessions_state_check",sql`${t.state} IN ('active','claiming','claimed','expired') AND ((${t.state} IN ('claiming','claimed') AND ${t.claimOwnerId} IS NOT NULL AND ${t.claimNetworkId} IS NOT NULL AND ${t.claimOperationId} IS NOT NULL) OR (${t.state} IN ('active','expired') AND ${t.claimOwnerId} IS NULL AND ${t.claimNetworkId} IS NULL AND ${t.claimOperationId} IS NULL))`)}));

export const projects = pgTable(
	"projects",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.references(() => networks.id, { onDelete: "cascade" }),
		demoSessionId: text("demo_session_id").references(() => demoSessions.id),
		serverKeyId: text("server_key_id")
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		storageKind: text("storage_kind").notNull().default("server").$type<"server" | "hosted">(),
		hostedRootId: text("hosted_root_id"),
		hostedMinecraftVersion: text("hosted_minecraft_version"),
		hostedCreationFingerprint: text("hosted_creation_fingerprint"),
		identityKind: text("identity_kind").notNull().default("unknown").$type<"unknown" | "folder" | "addon">(),
		name: text("name").notNull(),
		// Folder identity (or explicit add-on ID), scoped by server key or by
		// Network for hosted projects. `id` remains the immutable global FK.
		externalId: text("external_id"),
		// Read-only legacy URL alias. New projects leave it null.
		slug: text("slug"),
		description: text("description"),
		// Content belongs to the selected storage; SQL contains identity only.
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("projects_network_idx").on(t.networkId),
		uniqueIndex("projects_demo_session_uniq").on(t.demoSessionId),
		check("projects_owner_check", sql`(${t.networkId} IS NOT NULL AND ${t.demoSessionId} IS NULL) OR (${t.networkId} IS NULL AND ${t.demoSessionId} IS NOT NULL AND ${t.storageKind} = 'hosted')`),
		index("projects_network_deleted_idx").on(t.networkId, t.deletedAt),
		index("projects_server_key_idx").on(t.serverKeyId),
		uniqueIndex("projects_serverkey_slug_uniq").on(t.serverKeyId, t.slug),
		uniqueIndex("projects_serverkey_external_uniq").on(t.serverKeyId, t.externalId),
		uniqueIndex("projects_hosted_root_uniq").on(t.hostedRootId),
		uniqueIndex("projects_hosted_network_external_uniq").on(t.networkId, t.externalId).where(sql`${t.storageKind} = 'hosted'`),
		uniqueIndex("projects_hosted_network_slug_uniq").on(t.networkId, t.slug).where(sql`${t.storageKind} = 'hosted'`),
		check("projects_location_check", sql`(${t.storageKind} = 'server' AND ${t.serverKeyId} IS NOT NULL AND ${t.hostedRootId} IS NULL) OR (${t.storageKind} = 'hosted' AND ${t.serverKeyId} IS NULL AND ${t.hostedRootId} IS NOT NULL AND length(${t.hostedRootId}) > 0 AND ${t.externalId} IS NOT NULL AND length(${t.externalId}) > 0)`),
	],
);

export const projectDrafts = pgTable("project_drafts", {
	id: text("id").primaryKey(),
	projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
	ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	revision: integer("revision").notNull().default(1),
	status: text("status").notNull().default("active"),
	snapshot: jsonb("snapshot").notNull().$type<{
		baseline: Record<string, string>;
		tree: Record<string, string>;
		initialTree?: Record<string, string>;
		at: number;
		renames?: { from: string; to: string }[];
		binaryBaseline?: Record<string, { hash: string; size: number }>;
		binaryTree?: Record<string, { hash: string; size: number }>;
	}>(),
	updatedBy: text("updated_by").notNull().references(() => users.id, { onDelete: "cascade" }),
	source: text("source").notNull().default("editor"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}, (t) => [index("project_drafts_owner_project_idx").on(t.ownerId, t.projectId)]);

// Miroir du Snapshot d'un Project serveur (ADR `snapshot-mirror-and-backend-history`).
// Jetable : jamais une autorité ni une base de compare-and-swap. Contenus adressés
// par hash pour que les Versions (étape 2) les partagent sans migration.
export const snapshotBlobs = pgTable("snapshot_blobs", {
	hash: text("hash").primaryKey(),
	content: text("content").notNull(),
});

export const projectSnapshots = pgTable("project_snapshots", {
	projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
	hash: text("hash").notNull(),
	files: jsonb("files").notNull().$type<Record<string, string>>(),
	binaries: jsonb("binaries").notNull().$type<{ path: string; hash: string; size: number }[]>(),
	failed: jsonb("failed").notNull().$type<{ path: string; reason: string }[]>(),
	receivedAt: timestamp("received_at").notNull(),
});

// Versions d'un Project serveur : chaque Snapshot reçu qui diffère du précédent
// (ADR `snapshot-mirror-and-backend-history`, décision 6). Contenus dans `snapshot_blobs`.
export const projectVersions = pgTable("project_versions", {
	id: text("id").primaryKey(),
	projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
	hash: text("hash").notNull(),
	files: jsonb("files").notNull().$type<Record<string, string>>(),
	binaries: jsonb("binaries").notNull().$type<{ path: string; hash: string; size: number }[]>(),
	// `null` = le serveur lui-même (édition à la main puis reload).
	authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
	createdAt: timestamp("created_at").notNull(),
}, (t) => [index("project_versions_project_created_idx").on(t.projectId, t.createdAt)]);

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
	dataType: () => "bytea",
	toDriver: (value) => Buffer.from(value),
	fromDriver: (value) => new Uint8Array(value),
});

// Images privées d'un brouillon (ADR `snapshot-mirror-and-backend-history`,
// décision 4) : seules les versions qui diffèrent de la base publiée y vivent.
export const projectDraftBlobs = pgTable("project_draft_blobs", {
	draftId: text("draft_id").notNull().references(() => projectDrafts.id, { onDelete: "cascade" }),
	hash: text("hash").notNull(),
	content: bytea("content").notNull(),
}, (t) => [primaryKey({ columns: [t.draftId, t.hash] })]);

export const projectDraftStorage = pgTable("project_draft_storage", {
	projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
	state: text("state").notNull().default("backend").$type<"backend" | "frozen" | "server" | "returning">(),
	migrationId: text("migration_id").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}, (t) => [check("project_draft_storage_state_check", sql`${t.state} IN ('backend', 'frozen', 'server', 'returning')`)]);

export const projectDraftOperations = pgTable("project_draft_operations", {
	projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
	ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
	operationId: text("operation_id").notNull(),
	fingerprint: text("fingerprint").notNull(),
	expiresAt: timestamp("expires_at"),
	result: jsonb("result").notNull().$type<import("../lib/storage/DraftStore").DraftResult>(),
}, (t) => [primaryKey({ columns: [t.projectId, t.ownerId, t.operationId] })]);

// Durable revocation also applies to private drafts discovered in copied directories.
// No owner/project FK: deletion must not remove the outstanding purge instruction.
export const deletedDraftOwners = pgTable("deleted_draft_owners", {
	ownerId: text("owner_id").primaryKey(),
	deletedAt: timestamp("deleted_at").notNull(),
});

export const appSettings = pgTable("app_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(), // JSON stringifié
	updatedAt: timestamp("updated_at").notNull(),
	updatedBy: text("updated_by").references(() => users.id),
});

// AI assistant conversation history. Scoped per `(ownerKey, projectId)` so the
// panel can list a project's past conversations and resume them. `messages`
// holds the full LLM transcript (LlmMessage[]) — the working copy is rebuilt
// from the live project on each turn, so it is NOT persisted here. `ownerKey`
// mirrors ownerKey.ts `resolveOwnerKey`: `user:<userId>`.
export const assistantConversations = pgTable(
	"assistant_conversations",
	{
		id: text("id").primaryKey(),
		ownerKey: text("owner_key").notNull(),
		projectId: text("project_id").notNull(),
		title: text("title").notNull().default(""),
		messages: jsonb("messages").notNull().$type<unknown[]>(),
		uploadedFiles: jsonb("uploaded_files").$type<{
			networkId: string;
			serverKeyId: string | null;
			files: Record<string, string>;
		}>(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [index("assistant_conv_owner_project_idx").on(t.ownerKey, t.projectId)],
);

// Migration metadata and derived assistant proposals, never raw sources or a Project copy.
export const assistantMigrationRuns = pgTable("assistant_migration_runs", {
	id: text("id").primaryKey(),
	conversationId: text("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
	projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
	networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
	serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
	ownerKey: text("owner_key").notNull(),
	modelId: text("model_id").notNull(),
	requestId: text("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	status: text("status").notNull(),
	revision: integer("revision").notNull().default(0),
	manifest: jsonb("manifest").notNull(),
	budget: jsonb("budget").notNull(),
	issues: jsonb("issues").notNull(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}, (t) => ({ requestUnique: uniqueIndex("assistant_migration_request_uniq").on(t.conversationId, t.requestId) }));

export const assistantMigrationSteps = pgTable("assistant_migration_steps", {
	continuation: jsonb("continuation"),
	id: text("id").primaryKey(),
	runId: text("run_id").notNull().references(() => assistantMigrationRuns.id, { onDelete: "cascade" }),
	key: text("key").notNull(),
	position: integer("position").notNull(),
	sourceFileId: text("source_file_id").notNull(),
	targetId: text("target_id").notNull(),
	baseHash: text("base_hash"),
	status: text("status").notNull(),
	attemptCount: integer("attempt_count").notNull().default(0),
	leaseOwner: text("lease_owner"),
	leaseToken: text("lease_token"),
	leaseExpiresAt: timestamp("lease_expires_at"),
	credits: integer("credits").notNull().default(0),
}, (t) => ({ stepUnique: uniqueIndex("assistant_migration_step_key_uniq").on(t.runId, t.key) }));

export const assistantMigrationProposals = pgTable("assistant_migration_proposals", {
	id: text("id").primaryKey(),
	runId: text("run_id").notNull().references(() => assistantMigrationRuns.id, { onDelete: "cascade" }),
	stepId: text("step_id").notNull().references(() => assistantMigrationSteps.id, { onDelete: "cascade" }),
	proposal: jsonb("proposal").notNull(),
}, (t) => ({ proposalUnique: uniqueIndex("assistant_migration_proposal_step_uniq").on(t.stepId) }));

export const assistantMigrationEvents = pgTable("assistant_migration_events", {
	runId: text("run_id").notNull().references(() => assistantMigrationRuns.id, { onDelete: "cascade" }),
	sequence: integer("sequence").notNull(),
	type: text("type").notNull(),
	stepId: text("step_id"),
	code: text("code"),
	createdAt: timestamp("created_at").notNull(),
}, (t) => ({ sequencePk: primaryKey({ columns: [t.runId, t.sequence] }) }));

// AI model catalog (admin-managed). Prices are integers: credits per 1M tokens,
// real provider cost in micro-USD per 1M tokens ($0.075 → 75_000) — no floats
// in DB. Models referenced by usage history are never hard-deleted: deactivate
// instead. Cf. docs/superpowers/specs/2026-07-02-ai-model-system-design.md.
export const aiModels = pgTable(
	"ai_models",
	{
		id: text("id").primaryKey(),
		displayName: text("display_name").notNull(),
		description: text("description").notNull().default(""),
		badge: text("badge").notNull(), // "cheap" | "balanced" | "premium"
		provider: text("provider").notNull(), // slug into app_settings.ai_providers
		providerModelId: text("provider_model_id").notNull(),
		creditsPerMInput: integer("credits_per_m_input").notNull(),
		creditsPerMOutput: integer("credits_per_m_output").notNull(),
		realUsdPerMInput: integer("real_usd_per_m_input").notNull(),
		realUsdPerMOutput: integer("real_usd_per_m_output").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		isDefault: boolean("is_default").notNull().default(false),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		// Partial unique index: at most ONE row may have is_default = true.
		uniqueIndex("ai_models_default_uniq")
			.on(t.isDefault)
			.where(sql`is_default`),
	],
);

// One row per assistant turn (or future AI action — action_type is extensible).
// model_name/provider/provider_model_id are SNAPSHOTS so history survives
// renames. The only stored content is prompt_preview (~200 chars): full
// transcripts live in assistant_conversations; the admin "full view" links to
// the conversation.
export const aiUsageLog = pgTable(
	"ai_usage_log",
	{
		id: text("id").primaryKey(),
		idempotencyKey: text("idempotency_key"),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
		serverKeyId: text("server_key_id").references(() => serverKeys.id, {
			onDelete: "set null",
		}),
		modelId: text("model_id").references(() => aiModels.id, {
			onDelete: "set null", // snapshots keep the log readable
		}),
		modelName: text("model_name").notNull(),
		provider: text("provider").notNull(),
		providerModelId: text("provider_model_id").notNull(),
		actionType: text("action_type").notNull().default("chat"),
		conversationId: text("conversation_id"),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
		creditsCharged: integer("credits_charged").notNull().default(0),
		realCostMicroUsd: integer("real_cost_micro_usd").notNull().default(0),
		durationMs: integer("duration_ms"),
		status: text("status").notNull(), // "success" | "error"
		errorMessage: text("error_message"),
		promptPreview: text("prompt_preview").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("ai_usage_network_time_idx").on(t.networkId, t.createdAt),
		uniqueIndex("ai_usage_idempotency_uniq").on(t.idempotencyKey),
		index("ai_usage_user_time_idx").on(t.userId, t.createdAt),
		index("ai_usage_model_idx").on(t.modelId),
		index("ai_usage_time_idx").on(t.createdAt),
	],
);

// Credit ledger, one row per grant/debit. Balance(network) = SUM(delta).
// No materialized balance in V1 — the indexed SUM is enough.
export const aiCreditLedger = pgTable(
	"ai_credit_ledger",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		delta: integer("delta").notNull(), // grant > 0, debit < 0
		reason: text("reason").notNull(), // "grant" | "debit" | "refund" | "adjustment"
		// Credit bucket (billing). "subscription" = monthly quota (expires),
		// "rollover" = carried-over subscription credits (capped), "topup" =
		// permanent purchased/granted credits. Debit order: subscription →
		// rollover → topup (spec 2026-07-03 §4.1). Legacy grants default to topup.
		bucket: text("bucket").notNull().default("topup"),
		// Validity end for the entry (subscription bucket = period end). A bucket's
		// balance excludes entries with expires_at <= now(). null = never expires.
		expiresAt: timestamp("expires_at"),
		// Links an entry to a subscription billing period (renewal / rollover).
		periodId: text("period_id"),
		usageLogId: text("usage_log_id").references(() => aiUsageLog.id, {
			onDelete: "set null",
		}),
		note: text("note"),
		createdBy: text("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [index("ai_ledger_network_time_idx").on(t.networkId, t.createdAt)],
);

// Admin-defined top-up packs (one-off credit purchases). Provisioned as a
// Stripe product+price (stripe_price_id). Credits granted at purchase =
// credits + round(credits*bonus_pct/100). Cf. spec 2026-07-03 §1.1.
export const creditPacks = pgTable("credit_packs", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	priceCents: integer("price_cents").notNull(),
	currency: text("currency").notNull().default("eur"),
	credits: integer("credits").notNull(),
	bonusPct: integer("bonus_pct").notNull().default(0),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	stripeProductId: text("stripe_product_id"),
	stripePriceId: text("stripe_price_id"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

// Admin-defined recurring subscription plans. Annual editor Pro bills yearly
// but credits_per_period is its monthly credit grant; other plans grant at
// billing renewal. rollover_cap caps carried-over credits. Cf. spec §2.1/§2.2.
export const subscriptionPlans = pgTable("subscription_plans", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	interval: text("interval").notNull().default("month"), // "month" | "year"
	priceCents: integer("price_cents").notNull(),
	currency: text("currency").notNull().default("eur"),
	creditsPerPeriod: integer("credits_per_period").notNull(),
	rolloverCap: integer("rollover_cap").notNull().default(0),
	features: text("features").notNull().default(""),
	description: text("description").notNull().default(""),
	highlighted: boolean("highlighted").notNull().default(false),
	editorPro: boolean("editor_pro").notNull().default(false),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	stripeProductId: text("stripe_product_id"),
	stripePriceId: text("stripe_price_id"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const billingConfigAudit = pgTable("billing_config_audit", {
	id: text("id").primaryKey(),
	actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
	action: text("action").notNull(),
	before: jsonb("before"),
	after: jsonb("after").notNull(),
	createdAt: timestamp("created_at").notNull(),
});

// One row per network with billing state. status null = no subscription.
// networks.tier stays a denormalized quick flag updated by the webhook (B2).
export const networkBilling = pgTable("network_billing", {
	networkId: text("network_id")
		.primaryKey()
		.references(() => networks.id, { onDelete: "cascade" }),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	planId: text("plan_id").references(() => subscriptionPlans.id),
	status: text("status"), // "active" | "past_due" | "grace" | "canceled" | null
	currentPeriodEnd: timestamp("current_period_end"),
	paidThrough: timestamp("paid_through"), // confirmed only by invoice.paid; subscription updates cannot grant Pro
	paidEditorPro: boolean("paid_editor_pro").notNull().default(false),
	graceUntil: timestamp("grace_until"),
	// periodId of the current subscription period (Stripe invoice/period id).
	// The recurring invoice.paid webhook passes it as renewSubscriptionPeriod's
	// closingPeriodId, then overwrites it with the new period.
	currentPeriodId: text("current_period_id"),
	// Annual Artisan Pro is billed yearly but grants credits on monthly calendar
	// boundaries. These fields identify its paid-year anchor and last granted month.
	creditCycleStart: timestamp("credit_cycle_start"),
	creditMonthIndex: integer("credit_month_index"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

// Audit of top-up purchases (history §1.3). Invoices live in Stripe; we store
// the hosted invoice URL. credits = credits actually granted (incl. bonus).
export const creditPurchases = pgTable(
	"credit_purchases",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		packId: text("pack_id").references(() => creditPacks.id),
		stripeSessionId: text("stripe_session_id"),
		stripeInvoiceUrl: text("stripe_invoice_url"),
		amountCents: integer("amount_cents").notNull(),
		currency: text("currency").notNull().default("eur"),
		credits: integer("credits").notNull(),
		createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("credit_purchases_network_time_idx").on(t.networkId, t.createdAt),
		uniqueIndex("credit_purchases_session_uniq")
			.on(t.stripeSessionId)
			.where(sql`stripe_session_id is not null`),
	],
);

// Webhook idempotency: one row per processed Stripe event id (B2 uses it).
export const stripeEvents = pgTable("stripe_events", {
	eventId: text("event_id").primaryKey(),
	type: text("type").notNull(),
	processedAt: timestamp("processed_at").notNull(),
});

export const assistantTasks = pgTable("assistant_tasks", {
	id: text("id").primaryKey(),
	conversationId: text("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
	requestId: text("request_id").notNull(),
	requestHash: text("request_hash").notNull(),
	status: text("status").notNull(),
	message: text("message").notNull(),
	events: jsonb("events").notNull().default([]),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
}, (t) => ({
	requestUnique: uniqueIndex("assistant_tasks_request_uniq").on(t.conversationId, t.requestId),
	activeUnique: uniqueIndex("assistant_tasks_active_uniq").on(t.conversationId).where(sql`status in ('queued', 'running', 'stopping')`),
}));

// A bounded, immutable transfer artifact; never an editable project authority.
export const projectCopies = pgTable("project_copies", {
  id: text("id").primaryKey(),
  // Audit identifiers survive source/account deletion until uncertain activation is reconciled.
  ownerId: text("owner_id").notNull(),
  sourceProjectId: text("source_project_id").notNull(),
  sourceRevision: text("source_revision").notNull(),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull(),
  targetNetworkId: text("target_network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  minecraftVersion: text("minecraft_version").notNull(),
  modules: jsonb("modules").notNull().$type<string[]>(),
  fingerprint: text("fingerprint").notNull(),
  manifest: jsonb("manifest").notNull().$type<{ path: string; size: number; sha256: string }[]>(),
  artifact: jsonb("artifact").$type<import("../lib/storage/captureProjectSnapshot").CapturedFile[]>(),
  status: text("status").notNull().$type<"pending" | "completed" | "failed">(),
  destinationProjectId: text("destination_project_id"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, t => ({
  pendingTarget: uniqueIndex("project_copies_pending_target").on(t.serverKeyId, sql`lower(${t.targetId})`).where(sql`${t.status} = 'pending'`),
  stateCheck: check("project_copies_state_check", sql`${t.status} IN ('pending', 'completed', 'failed')`),
}));

export const projectRenames = pgTable("project_renames", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  serverKeyId: text("server_key_id").references(() => serverKeys.id, { onDelete: "cascade" }),
  hostedNetworkId: text("hosted_network_id").references(() => networks.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  status: text("status").notNull().$type<"pending" | "complete" | "failed">(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("project_renames_pending_project").on(t.projectId).where(sql`${t.status} = 'pending'`),
  uniqueIndex("project_renames_pending_target").on(t.serverKeyId, sql`lower(${t.targetId})`).where(sql`${t.status} = 'pending'`),
  uniqueIndex("project_renames_hosted_pending_target").on(t.hostedNetworkId, sql`lower(${t.targetId})`).where(sql`${t.status} = 'pending'`),
  check("project_renames_location_check", sql`(${t.serverKeyId} IS NOT NULL AND ${t.hostedNetworkId} IS NULL) OR (${t.serverKeyId} IS NULL AND ${t.hostedNetworkId} IS NOT NULL)`),
]);
