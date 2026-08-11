CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"character" text NOT NULL,
	"term_type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"total_letters_expected" integer NOT NULL,
	"recipient_name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"external_order_number" text NOT NULL,
	"amount" numeric(10, 2),
	"ordered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailings" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"letter_number" integer NOT NULL,
	"scheduled_date" date NOT NULL,
	"status" text NOT NULL,
	"recipient_name" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip" text,
	"staging_location_id" integer
);
--> statement-breakpoint
CREATE TABLE "mailing_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailing_id" text NOT NULL,
	"component_type" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" text,
	"mailing_id" text,
	"type" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingestion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb,
	"status" text NOT NULL,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "staging_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailings" ADD CONSTRAINT "mailings_staging_location_id_staging_locations_id_fk" FOREIGN KEY ("staging_location_id") REFERENCES "public"."staging_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_components" ADD CONSTRAINT "mailing_components_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_mailing_id_mailings_id_fk" FOREIGN KEY ("mailing_id") REFERENCES "public"."mailings"("id") ON DELETE no action ON UPDATE no action;