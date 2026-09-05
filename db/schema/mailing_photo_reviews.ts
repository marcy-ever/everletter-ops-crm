import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mailings } from "./mailings";

export const mailingPhotoReviews = pgTable(
  "mailing_photo_reviews",
  {
    id: serial("id").primaryKey(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    batchDate: date("batch_date", { mode: "string" }).notNull(),
    extractedText: text("extracted_text").notNull(),
    suggestedMailingId: text("suggested_mailing_id").references(() => mailings.id),
    status: text("status").notNull().default("Pending"),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [index("mailing_photo_reviews_status_idx").on(table.status), index("mailing_photo_reviews_batch_date_idx").on(table.batchDate)],
);
