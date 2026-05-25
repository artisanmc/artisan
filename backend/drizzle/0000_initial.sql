CREATE TABLE IF NOT EXISTS "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ascent" integer,
	"codepoint" integer,
	"content_width" integer,
	"font_meta" jsonb,
	"content_hash" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_accounts" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"linked_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "editor_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"server_key_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"exchanged_at" timestamp,
	"refresh_token" text,
	"access_token" text,
	"access_expires_at" timestamp,
	"trust_code" text,
	"trusted_at" timestamp,
	"trusted_ip" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"claimed_at" timestamp,
	"server_key_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"network_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_transfers" (
	"token" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"initiated_by_user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"consumed_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"subscription_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"server_key_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"branch_name" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_branches" (
	"pack_id" text NOT NULL,
	"name" text NOT NULL,
	"head_commit_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"parent_id" text,
	"parent_id_2" text,
	"content_hash" text NOT NULL,
	"files_json" text NOT NULL,
	"editor_json" text,
	"author_user_id" text,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packs" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hash" text DEFAULT '' NOT NULL,
	"files_json" text DEFAULT '{}' NOT NULL,
	"editor_json" text,
	"deployed_editor_json" text,
	"deleted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"label" text,
	"network_id" text NOT NULL,
	"last_mc_version" text,
	"created_at" timestamp NOT NULL,
	"resource_pack_hash" text,
	"resource_pack_updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_used_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"avatar_url" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_accounts" ADD CONSTRAINT "discord_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "editor_sessions" ADD CONSTRAINT "editor_sessions_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_transfers" ADD CONSTRAINT "network_transfers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_transfers" ADD CONSTRAINT "network_transfers_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_transfers" ADD CONSTRAINT "network_transfers_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_bindings" ADD CONSTRAINT "pack_bindings_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_bindings" ADD CONSTRAINT "pack_bindings_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_branches" ADD CONSTRAINT "pack_branches_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_branches" ADD CONSTRAINT "pack_branches_head_commit_id_pack_commits_id_fk" FOREIGN KEY ("head_commit_id") REFERENCES "public"."pack_commits"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_commits" ADD CONSTRAINT "pack_commits_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "packs" ADD CONSTRAINT "packs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_keys" ADD CONSTRAINT "server_keys_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_pack_name_type_uniq" ON "assets" USING btree ("pack_id","type","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_pack_codepoint_uniq" ON "assets" USING btree ("pack_id","codepoint") WHERE codepoint IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_pack_type_idx" ON "assets" USING btree ("pack_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_accounts_userid_uniq" ON "discord_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trust_code_uniq" ON "editor_sessions" USING btree ("trust_code") WHERE trust_code IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_user_network_uniq" ON "memberships" USING btree ("user_id","network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_network_idx" ON "memberships" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_transfers_network_idx" ON "network_transfers" USING btree ("network_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_bindings_uniq" ON "pack_bindings" USING btree ("server_key_id","pack_id","branch_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_bindings_pack_idx" ON "pack_bindings" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_bindings_serverkey_idx" ON "pack_bindings" USING btree ("server_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_branches_uniq" ON "pack_branches" USING btree ("pack_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_branches_head_idx" ON "pack_branches" USING btree ("head_commit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_commits_pack_idx" ON "pack_commits" USING btree ("pack_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_commits_pack_created_idx" ON "pack_commits" USING btree ("pack_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_commits_pack_content_uniq" ON "pack_commits" USING btree ("pack_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packs_network_idx" ON "packs" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "packs_network_deleted_idx" ON "packs" USING btree ("network_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "server_keys_network_idx" ON "server_keys" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_userid_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uniq" ON "users" USING btree ("email");