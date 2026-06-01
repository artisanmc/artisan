ALTER TABLE "server_key_helloes" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "server_keys" ADD COLUMN "allowed_ips" jsonb;