CREATE TABLE IF NOT EXISTS "deleted_draft_owners" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_draft_operations" (
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "project_draft_operations_project_id_owner_id_operation_id_pk" PRIMARY KEY("project_id","owner_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_draft_storage" (
	"project_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'backend' NOT NULL,
	"migration_id" text NOT NULL,
	"updated_at" timestamp NOT NULL
	,CONSTRAINT "project_draft_storage_state_check" CHECK ("state" IN ('backend', 'frozen', 'server'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_draft_operations" ADD CONSTRAINT "project_draft_operations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_draft_operations" ADD CONSTRAINT "project_draft_operations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_draft_storage" ADD CONSTRAINT "project_draft_storage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
