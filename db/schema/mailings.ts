import { boolean, date, integer, pgTable, text } from "drizzle-orm/pg-core";
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
  // `${orderId}::${character}::${letterNumber}` (letterNumber empty-string
  // if absent) - derived server-side in lib/write-to-tables.ts, NOT app.js's own
  // generated mailingId. app.js's mailingId truncates to 34 chars and
  // routinely collides for the most common case (a Month-to-month
  // subscriber's 2 letters under one order) - see docs/schema-design.md.
  // This derivation uses real, stable business fields instead, so it
  // survives re-imports even if row order in the spreadsheet changes.
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id")
    .notNull()
    .references(() => subscriptions.id),
  // app.js's own generated mailingId (app/crm/legacy-app.js) - NOT unique, can
  // collide (see the `id` comment above). Stored only as a matching aid:
  // an incoming mailingStatus/componentStatus override carries this value
  // (not our stable `id`), so it's needed to look the row back up. Never
  // used as identity - see docs/schema-design.md.
  appMailingId: text("app_mailing_id").notNull(),
  // The spreadsheet row position (app.js's `sourceRow`) this mailing had as
  // of the most recently processed import. This is NOT a stable identifier
  // - it's a position within whichever file was most recently uploaded, and
  // shifts if rows are added/removed/reordered between imports. Refreshed
  // on every import; used only alongside appMailingId to disambiguate which
  // of several same-appMailingId rows an incoming override refers to.
  // Never part of this row's identity. See docs/schema-design.md.
  lastSourceRow: text("last_source_row"),
  // Nullable: some real spreadsheet rows arrive without a letter number.
  // There's no honest fallback value (0/1 would misrepresent real data), and
  // nothing downstream requires it to be present - it's descriptive only.
  letterNumber: integer("letter_number"),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  // Per-row Active/Archived, straight from that row's own "Active?" cell -
  // NOT inherited from the subscription's status. app.js computes this per
  // mailing row, and rows under the same subscription can genuinely
  // disagree (observed in real data: a subscription's Active/Archived flag
  // changed mid-sequence). Named "active" rather than reusing "status" to
  // avoid colliding with the unrelated production-status `status` column
  // above. See lib/build-dataset-from-tables.ts's module comment for the
  // gap this closes.
  active: boolean("active").notNull(),
  // Free-text operational note from the spreadsheet's Notes column (e.g.
  // "Ashley has them"). Nullable: most rows don't have one.
  notes: text("notes"),
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
