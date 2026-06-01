CREATE TABLE IF NOT EXISTS "server_key_helloes" (
	"id" text PRIMARY KEY NOT NULL,
	"server_key_id" text NOT NULL,
	"ip" text NOT NULL,
	"mc_version" text,
	"hello_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_key_helloes" ADD CONSTRAINT "server_key_helloes_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "server_key_helloes_key_time_idx" ON "server_key_helloes" USING btree ("server_key_id","hello_at");