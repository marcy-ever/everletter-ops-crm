import { boolean, date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
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
  // Snapshots of exceptionReviewKey's (lib/domain/keys.ts) other two
  // segments - mailingId is already this row's own mailing_id (via the FK
  // above) and reason is already `type`, but subscriberId and shipDate had
  // no column at all until this pair, so writeReviewedException
  // (lib/write-to-tables.ts) could only cross-check 2 of the key's 4
  // segments. Named with a "review_key_" prefix specifically so neither is
  // ever mistaken for subscription_id above (a real FK to subscriptions,
  // and a completely different value - a subscription id, not the
  // subscriber id app.js's exceptionReviewKey actually encodes) or for a
  // mailing's own current ship date (mailings.scheduled_date can change on
  // re-import; these two columns are a frozen snapshot of what the key
  // looked like when this exception row was last written by an import, not
  // a live join). Nullable: rows written before this column existed, and
  // the subscription-only fallback case (mailing_id null), both legitimately
  // have neither.
  reviewKeySubscriberId: text("review_key_subscriber_id"),
  reviewKeyShipDate: date("review_key_ship_date", { mode: "string" }),
});
