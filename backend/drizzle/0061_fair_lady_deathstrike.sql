ALTER TABLE "subscription_plans" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "managed_by" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "audience" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "target_network_id" text;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "publication_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "credit_interval" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "limits" jsonb DEFAULT '{"resourcesPerServer":10,"servers":2,"collaborators":2}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "capabilities" jsonb DEFAULT '{"editorPro":false}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_target_network_id_networks_id_fk" FOREIGN KEY ("target_network_id") REFERENCES "public"."networks"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_key_interval_version_uniq" ON "subscription_plans" USING btree ("key","interval","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_stripe_price_uniq" ON "subscription_plans" USING btree ("stripe_price_id");--> statement-breakpoint
UPDATE "subscription_plans" SET "key" = 'custom:' || "id", "is_active" = false,
 "capabilities" = jsonb_build_object('editorPro', "editor_pro"),
 "limits" = CASE WHEN "editor_pro" THEN '{"resourcesPerServer":250,"servers":10,"collaborators":null}'::jsonb ELSE "limits" END,
 "credit_interval" = CASE WHEN "interval" = 'year' AND NOT "editor_pro" THEN 'year' ELSE 'month' END;
