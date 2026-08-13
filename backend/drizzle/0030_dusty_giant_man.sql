DROP TABLE "project_branches";--> statement-breakpoint
DROP TABLE "project_commits";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "hash";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "version";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "files_json";