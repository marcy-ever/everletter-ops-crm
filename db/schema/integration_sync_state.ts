import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const integrationSyncState = pgTable("integration_sync_state", {
  provider: text("provider").primaryKey(),
  baselineOrderCreatedAt: timestamp("baseline_order_created_at", { withTimezone: true }).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().default(sql`now()`),
});
