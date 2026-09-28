ALTER TABLE "network_billing" ADD COLUMN "manual_plan_id" text;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "manual_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "manual_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "manual_period_id" text;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "manual_period_index" integer;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "manual_period_end" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "network_billing" ADD CONSTRAINT "network_billing_manual_plan_id_subscription_plans_id_fk" FOREIGN KEY ("manual_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
