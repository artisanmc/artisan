CREATE TABLE IF NOT EXISTS "assistant_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"pack_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conv_owner_pack_idx" ON "assistant_conversations" USING btree ("owner_key","pack_id");