CREATE TABLE IF NOT EXISTS "network_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"code" text NOT NULL,
	"email" text,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_invites" ADD CONSTRAINT "network_invites_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_invites" ADD CONSTRAINT "network_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "network_invites_code_uniq" ON "network_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_invites_network_idx" ON "network_invites" USING btree ("network_id");