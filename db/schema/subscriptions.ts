import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { subscribers } from "./subscribers";

// One subscription = one character + one recipient. A subscriber can have
// multiple subscriptions (e.g. a second character, or a different
// recipient), but each individual subscription has exactly one recipient -
// there is deliberately no separate `recipients` table (every subscription
// gets its own recipient, never reused across subscriptions), so the
// recipient's current/latest known address is inlined here directly. This
// is the *current* address, used as the default when generating new
// mailings - see mailings.ts for the per-mailing frozen snapshot.
// See docs/schema-design.md.
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  subscriberId: text("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  character: text("character").notNull(),
  termType: text("term_type").notNull(),
  status: text("status").notNull(),
  // Nullable: same reasoning as orders.orderedAt - a missing order date
  // isn't flagged as bad data by app.js, so there's no honest fallback.
  startedAt: timestamp("started_at", { withTimezone: true }),
  // Nullable: most subscriptions are open-ended (no end date in the
  // spreadsheet). See lib/build-dataset-from-tables.ts's module comment
  // for the gap this closes.
  endedAt: timestamp("ended_at", { withTimezone: true }),
  totalLettersExpected: integer("total_letters_expected").notNull(),
  recipientName: text("recipient_name").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
});
