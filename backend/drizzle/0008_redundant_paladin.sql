ALTER TABLE "networks" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "server_keys" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "networks_slug_uniq" ON "networks" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "packs_serverkey_slug_uniq" ON "packs" USING btree ("server_key_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "server_keys_network_slug_uniq" ON "server_keys" USING btree ("network_id","slug");