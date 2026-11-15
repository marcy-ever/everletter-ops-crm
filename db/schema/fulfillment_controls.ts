import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mailings } from "./mailings";

export const fulfillmentControls = pgTable("fulfillment_controls", {
  mailingId: text("mailing_id").primaryKey().references(() => mailings.id, { onDelete: "cascade" }),
  owner: text("owner").notNull().default("Printer"),
  excludeFromPrinter: boolean("exclude_from_printer").notNull().default(false),
  paymentCleared: boolean("payment_cleared").notNull().default(false),
  mailingEligible: boolean("mailing_eligible").notNull().default(true),
  lateAddendumStatus: text("late_addendum_status").notNull().default("Main"),
  fulfillmentStatus: text("fulfillment_status").notNull().default("Pending"),
  qcInitials: text("qc_initials").notNull().default(""),
  exportedDate: timestamp("exported_date", { withTimezone: true }),
  batchName: text("batch_name").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
