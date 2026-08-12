ALTER TABLE "projects" ADD COLUMN "external_id" text;--> statement-breakpoint
-- Backfill: before this column, the internal id WAS the id the plugin used on
-- disk and on the wire, so `external_id = id` is exact for every existing row,
-- not an approximation. Must run before the unique index: NULLs do not collide
-- in Postgres, so an unbackfilled table would silently accept duplicates.
UPDATE "projects" SET "external_id" = "id" WHERE "external_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_serverkey_external_uniq" ON "projects" USING btree ("server_key_id","external_id");
