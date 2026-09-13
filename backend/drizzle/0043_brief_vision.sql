ALTER TABLE "project_renames" ALTER COLUMN "server_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_renames" ADD COLUMN "hosted_network_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hosted_minecraft_version" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hosted_creation_fingerprint" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_renames" ADD CONSTRAINT "project_renames_hosted_network_id_networks_id_fk" FOREIGN KEY ("hosted_network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_renames_hosted_pending_target" ON "project_renames" USING btree ("hosted_network_id",lower("target_id")) WHERE "project_renames"."status" = 'pending';
--> statement-breakpoint
ALTER TABLE "project_renames" ADD CONSTRAINT "project_renames_location_check" CHECK (("server_key_id" IS NOT NULL AND "hosted_network_id" IS NULL) OR ("server_key_id" IS NULL AND "hosted_network_id" IS NOT NULL));
