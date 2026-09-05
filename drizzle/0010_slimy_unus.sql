CREATE TABLE "squarespace_order_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"squarespace_order_id" text NOT NULL,
	"order_number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"staged_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "squarespace_order_reviews_order_id_idx" ON "squarespace_order_reviews" USING btree ("squarespace_order_id");--> statement-breakpoint
CREATE INDEX "squarespace_order_reviews_status_idx" ON "squarespace_order_reviews" USING btree ("status");