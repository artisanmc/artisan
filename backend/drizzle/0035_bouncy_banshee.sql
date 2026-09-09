CREATE TABLE IF NOT EXISTS "assistant_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assistant_tasks" ADD CONSTRAINT "assistant_tasks_conversation_id_assistant_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_tasks_request_uniq" ON "assistant_tasks" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_tasks_active_uniq" ON "assistant_tasks" USING btree ("conversation_id") WHERE status in ('queued', 'running', 'stopping');