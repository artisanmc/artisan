ALTER TABLE "projects" ALTER COLUMN "server_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "storage_kind" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hosted_root_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_hosted_root_uniq" ON "projects" USING btree ("hosted_root_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_hosted_network_external_uniq" ON "projects" USING btree ("network_id","external_id") WHERE "projects"."storage_kind" = 'hosted';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_hosted_network_slug_uniq" ON "projects" USING btree ("network_id","slug") WHERE "projects"."storage_kind" = 'hosted';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_location_check" CHECK (
  ("storage_kind" = 'server' AND "server_key_id" IS NOT NULL AND "hosted_root_id" IS NULL)
  OR ("storage_kind" = 'hosted' AND "server_key_id" IS NULL AND "hosted_root_id" IS NOT NULL AND length("hosted_root_id") > 0 AND "external_id" IS NOT NULL AND length("external_id") > 0)
);
