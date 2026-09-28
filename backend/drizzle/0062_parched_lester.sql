ALTER TABLE "subscription_plans" DROP CONSTRAINT "subscription_plans_target_network_id_networks_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_target_network_id_networks_id_fk" FOREIGN KEY ("target_network_id") REFERENCES "public"."networks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
