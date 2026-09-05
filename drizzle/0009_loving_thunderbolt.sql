CREATE TABLE "mailing_photo_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"batch_date" date NOT NULL,
	"extracted_text" text NOT NULL,
	"suggested_mailing_id" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mailing_photo_reviews" ADD CONSTRAINT "mailing_photo_reviews_suggested_mailing_id_mailings_id_fk" FOREIGN KEY ("suggested_mailing_id") REFERENCES "public"."mailings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailing_photo_reviews_status_idx" ON "mailing_photo_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mailing_photo_reviews_batch_date_idx" ON "mailing_photo_reviews" USING btree ("batch_date");