CREATE TABLE IF NOT EXISTS "project_renames" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"server_key_id" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "identity_kind" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_renames" ADD CONSTRAINT "project_renames_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_renames" ADD CONSTRAINT "project_renames_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_renames_pending_project" ON "project_renames" USING btree ("project_id") WHERE "project_renames"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_renames_pending_target" ON "project_renames" USING btree ("server_key_id",lower("target_id")) WHERE "project_renames"."status" = 'pending';