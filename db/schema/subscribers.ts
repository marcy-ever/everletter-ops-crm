import { sql } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The paying account holder, identified primarily by email. One subscriber
// can have multiple subscriptions. See docs/schema-design.md.
export const subscribers = pgTable("subscribers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
