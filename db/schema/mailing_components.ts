import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mailings } from "./mailings";

// Per-mailing parts and their individual production status (envelope /
// letter / insert). See docs/schema-design.md.
export const mailingComponents = pgTable("mailing_components", {
  id: serial("id").primaryKey(),
  mailingId: text("mailing_id")
    .notNull()
    .references(() => mailings.id),
  componentType: text("component_type").notNull(),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
