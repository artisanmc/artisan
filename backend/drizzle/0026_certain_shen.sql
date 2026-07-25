CREATE TABLE IF NOT EXISTS "server_declared_models" (
	"server_key_id" text NOT NULL,
	"model_id" text NOT NULL,
	"document_json" text NOT NULL,
	"reported_at" timestamp NOT NULL,
	CONSTRAINT "server_declared_models_server_key_id_model_id_pk" PRIMARY KEY("server_key_id","model_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_declared_models" ADD CONSTRAINT "server_declared_models_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
