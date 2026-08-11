import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions";

// The Squarespace-side transactional record. Month-to-month subscriptions
// produce a new order roughly monthly; longer terms may have just one order
// for the whole term. See docs/schema-design.md.
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id")
    .notNull()
    .references(() => subscriptions.id),
  externalOrderNumber: text("external_order_number").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
});
