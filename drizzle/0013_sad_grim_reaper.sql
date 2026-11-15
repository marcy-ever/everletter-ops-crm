CREATE TABLE "fulfillment_controls" (
	"mailing_id" text PRIMARY KEY NOT NULL,
	"owner" text DEFAULT 'Printer' NOT NULL,
	"exclude_from_printer" boolean DEFAULT false NOT NULL,
	"payment_cleared" boolean DEFAULT false NOT NULL,
	"mailing_eligible" boolean DEFAULT true NOT NULL,
	"late_addendum_status" text DEFAULT 'Main' NOT NULL,
	"fulfillment_status" text DEFAULT 'Pending' NOT NULL,
	"qc_initials" text DEFAULT '' NOT NULL,
	"exported_date" timestamp with time zone,
	"batch_name" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_date" date NOT NULL,
	"batch_name" text NOT NULL,
	"export_kind" text NOT NULL,
	"design_group" text NOT NULL,
	"row_count" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"exported_by" text,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfillment_controls" ADD CONSTRAINT "fulfillment_controls_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fulfillment_exports_batch_date_idx" ON "fulfillment_exports" USING btree ("batch_date");--> statement-breakpoint
CREATE INDEX "fulfillment_exports_batch_name_idx" ON "fulfillment_exports" USING btree ("batch_name");