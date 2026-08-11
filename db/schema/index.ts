// Barrel for the normalized Option A schema (docs/schema-design.md). Deliberately
// separate from db/schema.ts, which still holds the crm_state table the running
// app actually reads/writes today - nothing here is wired into the app yet.
export * from "./subscribers";
export * from "./subscriptions";
export * from "./orders";
export * from "./mailings";
export * from "./mailing_components";
export * from "./exceptions";
export * from "./ingestion_events";
export * from "./staging_locations";
export * from "./relations";
