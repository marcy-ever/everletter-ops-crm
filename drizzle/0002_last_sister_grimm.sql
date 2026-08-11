ALTER TABLE "subscriptions" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "ordered_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mailings" ALTER COLUMN "letter_number" DROP NOT NULL;