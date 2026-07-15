ALTER TABLE "link_codes" DROP CONSTRAINT "link_codes_server_key_id_server_keys_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_server_key_id_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
