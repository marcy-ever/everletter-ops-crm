CREATE TABLE `crm_state` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_state_kind_item_key_idx` ON `crm_state` (`kind`,`item_key`);