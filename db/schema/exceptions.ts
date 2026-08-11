import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { subscriptions } from "./subscriptions";
import { mailings } from "./mailings";

// Needs-review flags. Nullable FKs rather than a polymorphic pattern, since
// a flag can relate to either level (a subscription-level problem like a
// bad address, or a mailing-level problem like a missing date on one
// specific letter). See docs/schema-design.md.
export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  subscriptionId: text("subscription_id").references(() => subscriptions.id),
  mailingId: text("mailing_id").references(() => mailings.id),
  type: text("type").notNull(),
  reviewed: boolean("reviewed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});
