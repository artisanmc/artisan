CREATE TABLE IF NOT EXISTS "oauth_accounts" (
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"linked_at" timestamp NOT NULL,
	CONSTRAINT "oauth_accounts_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_accounts_provider_user_uniq" ON "oauth_accounts" USING btree ("provider","user_id");
--> statement-breakpoint
INSERT INTO "oauth_accounts" ("provider", "subject", "user_id", "name", "email", "linked_at")
SELECT 'discord', "discord_user_id", "user_id", "username", "email", "linked_at"
FROM "discord_accounts"
ON CONFLICT DO NOTHING;
