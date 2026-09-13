CREATE TABLE IF NOT EXISTS "project_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_project_id" text NOT NULL,
	"source_revision" text NOT NULL,
	"server_key_id" text NOT NULL,
	"target_id" text NOT NULL,
	"target_network_id" text NOT NULL,
	"minecraft_version" text NOT NULL,
	"modules" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"artifact" jsonb,
	"status" text NOT NULL,
	"destination_project_id" text,
	"error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_copies" ADD CONSTRAINT "project_copies_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_copies" ADD CONSTRAINT "project_copies_target_network_id_networks_id_fk" FOREIGN KEY ("target_network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_copies_pending_target" ON "project_copies" USING btree ("server_key_id",lower("target_id")) WHERE "project_copies"."status" = 'pending';
--> statement-breakpoint
ALTER TABLE "project_copies" ADD CONSTRAINT "project_copies_state_check" CHECK ("status" IN ('pending', 'completed', 'failed'));
