import { index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SquarespacePreviewOrder } from "../../lib/domain/squarespace-preview";

export const squarespaceOrderReviews = pgTable("squarespace_order_reviews", {
  id: serial("id").primaryKey(),
  squarespaceOrderId: text("squarespace_order_id").notNull(),
  orderNumber: text("order_number").notNull(),
  snapshot: jsonb("snapshot").$type<SquarespacePreviewOrder>().notNull(),
  status: text("status").notNull().default("Pending"),
  stagedBy: text("staged_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("squarespace_order_reviews_order_id_idx").on(table.squarespaceOrderId),
  index("squarespace_order_reviews_status_idx").on(table.status),
]);
