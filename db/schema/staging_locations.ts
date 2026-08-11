import { pgTable, serial, text } from "drizzle-orm/pg-core";

// Physical storage location where printed items wait between printing and
// mailing. Renamed from "bins" at the schema level (same real-world thing
// Ashley calls "the bin") to avoid ambiguity with other meanings of "bin".
// See docs/schema-design.md.
export const stagingLocations = pgTable("staging_locations", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  notes: text("notes"),
});
