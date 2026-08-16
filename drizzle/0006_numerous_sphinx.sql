CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text,
	"kind" text NOT NULL,
	"item_key" text NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exceptions" ADD COLUMN "review_key_subscriber_id" text;--> statement-breakpoint
ALTER TABLE "exceptions" ADD COLUMN "review_key_ship_date" date;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at" DESC NULLS LAST);