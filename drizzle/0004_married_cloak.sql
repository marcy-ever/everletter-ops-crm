ALTER TABLE "subscriptions" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailings" ADD COLUMN "active" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "mailings" ADD COLUMN "notes" text;