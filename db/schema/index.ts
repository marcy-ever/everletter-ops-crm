// Barrel for the normalized Option A schema (docs/schema-design.md) - the
// app's live schema. The original crm_state table (once defined in a
// separate db/schema.ts) is gone as of Option B Phase 2's final step.
export * from "./subscribers";
export * from "./subscriptions";
export * from "./orders";
export * from "./mailings";
export * from "./mailing_components";
export * from "./exceptions";
export * from "./ingestion_events";
export * from "./staging_locations";
export * from "./relations";
