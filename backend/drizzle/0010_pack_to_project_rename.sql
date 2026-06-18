CREATE TABLE IF NOT EXISTS "project_branches" (
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"head_commit_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
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
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"server_key_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
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
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_pack_id_packs_id_fk";
--> statement-breakpoint
DROP TABLE "pack_branches";--> statement-breakpoint
DROP TABLE "pack_commits";--> statement-breakpoint
DROP TABLE "packs";--> statement-breakpoint
DROP INDEX IF EXISTS "assets_pack_name_type_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "assets_pack_codepoint_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "assets_pack_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "assistant_conv_owner_pack_idx";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "project_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD COLUMN "project_id" text NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_head_commit_id_project_commits_id_fk" FOREIGN KEY ("head_commit_id") REFERENCES "public"."project_commits"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_commits" ADD CONSTRAINT "project_commits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_branches_uniq" ON "project_branches" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_branches_head_idx" ON "project_branches" USING btree ("head_commit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_commits_project_idx" ON "project_commits" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_commits_project_created_idx" ON "project_commits" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_commits_project_content_uniq" ON "project_commits" USING btree ("project_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_network_idx" ON "projects" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_network_deleted_idx" ON "projects" USING btree ("network_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_server_key_idx" ON "projects" USING btree ("server_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_serverkey_slug_uniq" ON "projects" USING btree ("server_key_id","slug");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_project_name_type_uniq" ON "assets" USING btree ("project_id","type","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assets_project_codepoint_uniq" ON "assets" USING btree ("project_id","codepoint") WHERE codepoint IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_project_type_idx" ON "assets" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conv_owner_project_idx" ON "assistant_conversations" USING btree ("owner_key","project_id");--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN IF EXISTS "pack_id";--> statement-breakpoint
ALTER TABLE "assistant_conversations" DROP COLUMN IF EXISTS "pack_id";