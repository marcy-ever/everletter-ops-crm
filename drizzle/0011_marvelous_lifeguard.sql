CREATE TABLE "integration_sync_state" (
	"provider" text PRIMARY KEY NOT NULL,
	"baseline_order_created_at" timestamp with time zone NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
