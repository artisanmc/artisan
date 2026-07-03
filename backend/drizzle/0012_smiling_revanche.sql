ALTER TABLE "ai_credit_ledger" ADD COLUMN "bucket" text DEFAULT 'topup' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_credit_ledger" ADD COLUMN "period_id" text;--> statement-breakpoint
UPDATE "ai_credit_ledger" SET "bucket" = 'topup' WHERE "bucket" IS NULL OR "bucket" = '';