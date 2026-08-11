ALTER TABLE "mailings" ADD COLUMN "app_mailing_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mailings" ADD COLUMN "last_source_row" text;