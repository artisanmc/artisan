CREATE TABLE IF NOT EXISTS "server_data_sources" (
	"server_key_id" text NOT NULL,
	"ref" text NOT NULL,
	"schema_hint" text,
	"reported_at" timestamp NOT NULL,
	CONSTRAINT "server_data_sources_server_key_id_ref_pk" PRIMARY KEY("server_key_id","ref")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_data_sources" ADD CONSTRAINT "server_data_sources_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
