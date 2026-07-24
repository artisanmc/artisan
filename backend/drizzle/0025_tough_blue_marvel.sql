ALTER TABLE "project_commits" DROP COLUMN IF EXISTS "editor_json";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "editor_json";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "deployed_editor_json";