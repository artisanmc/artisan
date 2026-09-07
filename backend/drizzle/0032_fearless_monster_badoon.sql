CREATE TABLE IF NOT EXISTS "assistant_migration_events" (
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"step_id" text,
	"code" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "assistant_migration_events_run_id_sequence_pk" PRIMARY KEY("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_migration_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"proposal" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_migration_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"project_id" text NOT NULL,
	"network_id" text NOT NULL,
	"server_key_id" text NOT NULL,
	"owner_key" text NOT NULL,
	"model_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"manifest" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"issues" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_migration_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"source_file_id" text NOT NULL,
	"target_id" text NOT NULL,
	"base_hash" text,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_token" text,
	"lease_expires_at" timestamp,
	"credits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_events" ADD CONSTRAINT "assistant_migration_events_run_id_assistant_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_migration_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_proposals" ADD CONSTRAINT "assistant_migration_proposals_run_id_assistant_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_migration_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_proposals" ADD CONSTRAINT "assistant_migration_proposals_step_id_assistant_migration_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."assistant_migration_steps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_runs" ADD CONSTRAINT "assistant_migration_runs_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_runs" ADD CONSTRAINT "assistant_migration_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_runs" ADD CONSTRAINT "assistant_migration_runs_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_runs" ADD CONSTRAINT "assistant_migration_runs_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_migration_steps" ADD CONSTRAINT "assistant_migration_steps_run_id_assistant_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assistant_migration_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_migration_proposal_step_uniq" ON "assistant_migration_proposals" USING btree ("step_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_migration_request_uniq" ON "assistant_migration_runs" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_migration_step_key_uniq" ON "assistant_migration_steps" USING btree ("run_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_idempotency_uniq" ON "ai_usage_log" USING btree ("idempotency_key");