CREATE TABLE "mailing_proofs" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailing_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailing_proofs_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "mailing_proofs" ADD CONSTRAINT "mailing_proofs_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailing_proofs_mailing_id_idx" ON "mailing_proofs" USING btree ("mailing_id");--> statement-breakpoint
CREATE INDEX "mailing_proofs_captured_at_idx" ON "mailing_proofs" USING btree ("captured_at" DESC NULLS LAST);