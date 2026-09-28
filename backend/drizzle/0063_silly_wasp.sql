ALTER TABLE "network_billing" ADD COLUMN "last_paid_invoice_id" text;--> statement-breakpoint
ALTER TABLE "network_billing" ADD COLUMN "last_paid_invoice_created_at" timestamp;