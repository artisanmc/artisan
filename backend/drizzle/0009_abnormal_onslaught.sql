CREATE TABLE IF NOT EXISTS "server_modules" (
	"server_key_id" text NOT NULL,
	"module_id" text NOT NULL,
	"version" text,
	"last_seen" timestamp NOT NULL,
	CONSTRAINT "server_modules_server_key_id_module_id_pk" PRIMARY KEY("server_key_id","module_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_modules" ADD CONSTRAINT "server_modules_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
