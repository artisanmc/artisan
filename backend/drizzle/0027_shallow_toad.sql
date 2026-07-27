CREATE TABLE IF NOT EXISTS "server_editor_screens" (
	"server_key_id" text NOT NULL,
	"screen_id" text NOT NULL,
	"screen_json" text NOT NULL,
	"reported_at" timestamp NOT NULL,
	CONSTRAINT "server_editor_screens_server_key_id_screen_id_pk" PRIMARY KEY("server_key_id","screen_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "server_editor_screens" ADD CONSTRAINT "server_editor_screens_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
