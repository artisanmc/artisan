CREATE TABLE IF NOT EXISTS "ai_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"usage_log_id" text,
	"note" text,
	"created_by" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_models" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"badge" text NOT NULL,
	"provider" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"credits_per_m_input" integer NOT NULL,
	"credits_per_m_output" integer NOT NULL,
	"real_usd_per_m_input" integer NOT NULL,
	"real_usd_per_m_output" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"user_id" text,
	"server_key_id" text,
	"model_id" text,
	"model_name" text NOT NULL,
	"provider" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"action_type" text DEFAULT 'chat' NOT NULL,
	"conversation_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"real_cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"prompt_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_ai_model_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_usage_log_id_ai_usage_log_id_fk" FOREIGN KEY ("usage_log_id") REFERENCES "public"."ai_usage_log"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_credit_ledger" ADD CONSTRAINT "ai_credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_ledger_network_time_idx" ON "ai_credit_ledger" USING btree ("network_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_default_uniq" ON "ai_models" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_network_time_idx" ON "ai_usage_log" USING btree ("network_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_user_time_idx" ON "ai_usage_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_model_idx" ON "ai_usage_log" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_time_idx" ON "ai_usage_log" USING btree ("created_at");