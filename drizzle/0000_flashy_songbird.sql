CREATE TABLE "crm_state" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"item_key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_state_kind_item_key_idx" ON "crm_state" USING btree ("kind","item_key");