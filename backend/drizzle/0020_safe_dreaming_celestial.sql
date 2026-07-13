CREATE TABLE IF NOT EXISTS "network_access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"created_at" timestamp NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_access_requests" ADD CONSTRAINT "network_access_requests_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_access_requests" ADD CONSTRAINT "network_access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_access_requests_network_idx" ON "network_access_requests" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_access_requests_user_idx" ON "network_access_requests" USING btree ("user_id");