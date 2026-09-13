CREATE TABLE IF NOT EXISTS "demo_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"project_id" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_activity_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"rate_key" text NOT NULL,
	"claim_operation_id" text,
	"claim_owner_id" text,
	"claim_network_id" text,
	CONSTRAINT "demo_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "demo_sessions_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "network_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "demo_session_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_sessions_expiry_idx" ON "demo_sessions" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_sessions_rate_idx" ON "demo_sessions" USING btree ("rate_key","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_demo_session_id_demo_sessions_id_fk" FOREIGN KEY ("demo_session_id") REFERENCES "public"."demo_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_demo_session_uniq" ON "projects" USING btree ("demo_session_id");