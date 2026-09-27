CREATE TABLE IF NOT EXISTS "project_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"hash" text NOT NULL,
	"files" jsonb NOT NULL,
	"binaries" jsonb NOT NULL,
	"author_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_versions_project_created_idx" ON "project_versions" USING btree ("project_id","created_at");