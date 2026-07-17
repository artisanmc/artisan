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

export const projects = pgTable(
	"projects",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		// URL slug, unique per server key. Nullable during backfill.
		slug: text("slug"),
		description: text("description"),
		hash: text("hash").notNull().default(""),
		// Optimistic-concurrency counter for draft content. Bumped by every
		// content write (editor save, plugin push, deploy); editor PUTs must
		// present the version they loaded or get a 409.
		version: integer("version").notNull().default(0),
		filesJson: text("files_json").notNull().default("{}"),
		editorJson: text("editor_json"),
		deployedEditorJson: text("deployed_editor_json"),
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("projects_network_idx").on(t.networkId),
		index("projects_network_deleted_idx").on(t.networkId, t.deletedAt),
		index("projects_server_key_idx").on(t.serverKeyId),
		uniqueIndex("projects_serverkey_slug_uniq").on(t.serverKeyId, t.slug),
	],
);

export const projectCommits = pgTable(
	"project_commits",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
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
		index("project_commits_project_idx").on(t.projectId),
		index("project_commits_project_created_idx").on(t.projectId, t.createdAt),
		uniqueIndex("project_commits_project_content_uniq").on(t.projectId, t.contentHash),
	],
);

export const projectBranches = pgTable(
	"project_branches",
	{
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		headCommitId: text("head_commit_id")
			.notNull()
			.references(() => projectCommits.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		uniqueIndex("project_branches_uniq").on(t.projectId, t.name),
		index("project_branches_head_idx").on(t.headCommitId),
	],
);

export const assets = pgTable(
	"assets",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
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
		uniqueIndex("assets_project_name_type_uniq").on(t.projectId, t.type, t.name),
		uniqueIndex("assets_project_codepoint_uniq")
			.on(t.projectId, t.codepoint)
			.where(sql`codepoint IS NOT NULL`),
		index("assets_project_type_idx").on(t.projectId, t.type),
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
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [index("assistant_conv_owner_project_idx").on(t.ownerKey, t.projectId)],
);

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

// Admin-defined recurring subscription plans. interval="month" in V1
// (year reserved). credits_per_period granted each renewal; rollover_cap caps
// carried-over credits. Cf. spec §2.1/§2.2.
export const subscriptionPlans = pgTable("subscription_plans", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	interval: text("interval").notNull().default("month"), // "month" | "year"
	priceCents: integer("price_cents").notNull(),
	currency: text("currency").notNull().default("eur"),
	creditsPerPeriod: integer("credits_per_period").notNull(),
	rolloverCap: integer("rollover_cap").notNull().default(0),
	features: text("features").notNull().default(""),
	isActive: boolean("is_active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	stripeProductId: text("stripe_product_id"),
	stripePriceId: text("stripe_price_id"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
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
	graceUntil: timestamp("grace_until"),
	// periodId of the current subscription period (Stripe invoice/period id).
	// The recurring invoice.paid webhook passes it as renewSubscriptionPeriod's
	// closingPeriodId, then overwrites it with the new period.
	currentPeriodId: text("current_period_id"),
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
