import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mailings } from "./mailings";

export const mailingProofs = pgTable(
  "mailing_proofs",
  {
    id: serial("id").primaryKey(),
    mailingId: text("mailing_id").notNull().references(() => mailings.id),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("mailing_proofs_mailing_id_idx").on(table.mailingId), index("mailing_proofs_captured_at_idx").on(table.capturedAt.desc())],
);
