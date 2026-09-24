ALTER TABLE "subscription_plans" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "highlighted" boolean DEFAULT false NOT NULL;