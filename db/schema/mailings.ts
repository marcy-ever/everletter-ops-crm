import { date, integer, pgTable, text } from "drizzle-orm/pg-core";
import { subscriptions } from "./subscriptions";
import { stagingLocations } from "./staging_locations";

// One row per actual letter-mailing event. Recipient address fields are
// snapshotted at mailing-creation time - a frozen copy of the subscription's
// address at that moment, never updated after creation even if the
// subscription's current address later changes (families can move mid-term;
// historical letters should retain the address they actually shipped to -
// same pattern e-commerce systems use for order shipping addresses vs. a
// customer's current saved address). See docs/schema-design.md.
export const mailings = pgTable("mailings", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id")
    .notNull()
    .references(() => subscriptions.id),
  letterNumber: integer("letter_number").notNull(),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  recipientName: text("recipient_name").notNull(),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  // Set once the physical item is printed and placed in a staging location,
  // pre-mailing - null until then.
  stagingLocationId: integer("staging_location_id").references(() => stagingLocations.id),
});
