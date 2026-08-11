import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required (see .env.example).");
}

export default defineConfig({
  out: "./drizzle",
  // db/schema.ts: the existing crm_state table the running app uses today.
  // db/schema/*.ts: the new normalized Option A tables (docs/schema-design.md),
  // defined alongside it - relations.ts and index.ts are deliberately excluded,
  // since drizzle-kit only needs the pgTable() definitions (including their
  // .references() calls) to generate migrations; relations() only affects the
  // runtime query API, not the SQL schema.
  // db/schema.ts: the existing crm_state table the running app uses today.
  // db/schema/*.ts: the new normalized Option A tables (docs/schema-design.md),
  // defined alongside it - relations.ts and index.ts are deliberately excluded,
  // since drizzle-kit only needs the pgTable() definitions (including their
  // .references() calls) to generate migrations; relations() only affects the
  // runtime query API, not the SQL schema.
  schema: [
    "./db/schema.ts",
    "./db/schema/subscribers.ts",
    "./db/schema/subscriptions.ts",
    "./db/schema/orders.ts",
    "./db/schema/mailings.ts",
    "./db/schema/mailing_components.ts",
    "./db/schema/exceptions.ts",
    "./db/schema/ingestion_events.ts",
    "./db/schema/staging_locations.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
