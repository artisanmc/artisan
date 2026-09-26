CREATE TABLE IF NOT EXISTS "project_snapshots" (
	"project_id" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"files" jsonb NOT NULL,
	"binaries" jsonb NOT NULL,
	"failed" jsonb NOT NULL,
	"received_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_blobs" (
	"hash" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
