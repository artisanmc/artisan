-- ADR `server-only-projects`, étape 2 : la démo passe en base, le stockage hébergé disparaît.
-- Projets hébergés de compte : jamais utilisés en réel (décision du propriétaire,
-- 2026-09-28) ; supprimés avec tout ce qui en dépend (FK en cascade).
DELETE FROM "projects" WHERE "storage_kind" = 'hosted' AND "network_id" IS NOT NULL;--> statement-breakpoint
-- Démos jetables : celles en cours vivaient sur le volume retiré.
DELETE FROM "project_drafts" WHERE "project_id" IN (SELECT "id" FROM "projects" WHERE "demo_session_id" IS NOT NULL);--> statement-breakpoint
DELETE FROM "projects" WHERE "demo_session_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "demo_sessions";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_owner_check";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_location_check";--> statement-breakpoint
ALTER TABLE "demo_sessions" DROP CONSTRAINT IF EXISTS "demo_sessions_state_check";--> statement-breakpoint
DROP TABLE "project_copies";--> statement-breakpoint
ALTER TABLE "project_draft_operations" DROP CONSTRAINT "project_draft_operations_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "project_drafts" DROP CONSTRAINT "project_drafts_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "project_drafts" DROP CONSTRAINT "project_drafts_updated_by_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "projects_hosted_root_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "projects_hosted_network_external_uniq";--> statement-breakpoint
DROP INDEX IF EXISTS "projects_hosted_network_slug_uniq";--> statement-breakpoint
ALTER TABLE "demo_sessions" DROP COLUMN IF EXISTS "claim_operation_id";--> statement-breakpoint
ALTER TABLE "demo_sessions" DROP COLUMN IF EXISTS "claim_owner_id";--> statement-breakpoint
ALTER TABLE "demo_sessions" DROP COLUMN IF EXISTS "claim_network_id";--> statement-breakpoint
ALTER TABLE "demo_sessions" DROP COLUMN IF EXISTS "superseded_claims";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "hosted_root_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "hosted_creation_fingerprint";
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_check" CHECK (("network_id" IS NOT NULL AND "demo_session_id" IS NULL) OR ("network_id" IS NULL AND "demo_session_id" IS NOT NULL AND "storage_kind" = 'demo'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_location_check" CHECK (("storage_kind" = 'server' AND "server_key_id" IS NOT NULL) OR ("storage_kind" = 'demo' AND "server_key_id" IS NULL));--> statement-breakpoint
ALTER TABLE "demo_sessions" ADD CONSTRAINT "demo_sessions_state_check" CHECK ("state" IN ('active', 'expired'));
