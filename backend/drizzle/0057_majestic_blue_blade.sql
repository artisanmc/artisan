CREATE TABLE IF NOT EXISTS "project_draft_blobs" (
	"draft_id" text NOT NULL,
	"hash" text NOT NULL,
	"content" "bytea" NOT NULL,
	CONSTRAINT "project_draft_blobs_draft_id_hash_pk" PRIMARY KEY("draft_id","hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_draft_blobs" ADD CONSTRAINT "project_draft_blobs_draft_id_project_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."project_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "project_draft_storage" DROP CONSTRAINT IF EXISTS "project_draft_storage_state_check";--> statement-breakpoint
ALTER TABLE "project_draft_storage" ADD CONSTRAINT "project_draft_storage_state_check" CHECK ("state" IN ('backend', 'frozen', 'server', 'returning'));
