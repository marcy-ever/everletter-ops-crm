# Database Schema Redesign — Design Notes

**Status: decided, not yet implemented.** This documents the target schema and the two implementation paths discussed, so this can be picked back up later without re-deriving the design.

## Why

The current `crm_state` table is a single EAV/blob table: rows keyed by `(kind, item_key)` where `value` is often the *entire* CRM dataset serialized as one JSON blob (`crmDataset::current`), plus override rows for mailing/component status and reviewed exceptions. No foreign keys, no real queryability, no per-entity history. This doc replaces that with a normalized relational schema.

## Decided Entities

### `subscribers`
The paying account holder, identified primarily by email. One subscriber can have multiple subscriptions.
- `id`, `email`, `name`, `created_at`

### `subscriptions`
One subscription = one character + one recipient. A subscriber can have multiple subscriptions (e.g. a second character, or a different recipient), but each individual subscription has exactly one recipient — recipients are **not** a separate reusable entity (see Decisions below).
- `id`, `subscriber_id` (FK), `character`, `term_type` (month-to-month / 6mo / 12mo), `status`, `started_at`, `total_letters_expected` (2 / 12 / 24)
- Recipient fields, inlined (current/latest known address — used as the default when generating new mailings): `recipient_name`, `address_line1`, `address_line2`, `city`, `state`, `zip`

### `orders`
The Squarespace-side transactional record. Month-to-month subscriptions produce a new order roughly monthly; longer terms may have just one order for the whole term.
- `id`, `subscription_id` (FK), `external_order_number` (Squarespace's), `amount`, `ordered_at`

### `mailings`
One row per actual letter-mailing event.
- `id`, `subscription_id` (FK), `letter_number`, `scheduled_date` (1st or 15th), `status`
- Recipient address fields, **snapshotted at mailing-creation time** (frozen copy of the subscription's address at that moment — never updated after creation, even if the subscription's address changes later): `recipient_name`, `address_line1`, `address_line2`, `city`, `state`, `zip`
- `staging_location_id` (FK, nullable — set once the physical item is printed and placed in a staging location, pre-mailing)

### `mailing_components`
Per-mailing parts and their individual production status.
- `id`, `mailing_id` (FK), `component_type` (envelope / letter / insert), `status` (printed / assembled / QA'd / etc.), `updated_at`

### `exceptions`
Needs-review flags. Nullable FKs rather than a polymorphic pattern, since a flag can relate to either level.
- `id`, `subscription_id` (FK, nullable), `mailing_id` (FK, nullable), `type` (bad_address / missing_date / duplicate / unusual_sequence), `reviewed` (bool), `created_at`, `reviewed_at`

### `ingestion_events`
Generic audit trail for how data entered the system — **not spreadsheet-specific**, by design (see Decisions below).
- `id`, `source` (`manual_spreadsheet` | `squarespace_sync`), `occurred_at`, `raw_payload` (jsonb, for audit/rollback), `status` (success / partial / failed), `summary`

### `staging_locations`
Physical storage location where printed items wait between printing and mailing. (Renamed from "bins" — see Decisions.)
- `id`, `label`, `notes`

## Design Decisions & Rationale

- **No separate `recipients` table.** Every subscription gets its own recipient; recipients are never reused across subscriptions. A separate table would force a mandatory join on nearly every query (printing, mailing-list generation) for no benefit. Recipient fields are inlined directly on `subscriptions`.
- **Address snapshot on `mailings`, not just `subscriptions`.** Families can move mid-subscription (e.g. month 6 of a 24-letter term). `subscriptions` holds the *current* address (used as the default for new mailings); `mailings` holds a *frozen* copy taken at the moment each mailing record is created, so historical letters retain the address they actually shipped to. Same pattern e-commerce systems use for order shipping addresses vs. a customer's current saved address.
- **`ingestion_events` is source-agnostic, not "spreadsheet imports."** Today the only ingestion path is manual spreadsheet upload. The Squarespace integration (currently just a TODO in Marcy/Codex's backlog — nothing designed yet) would be a second ingestion source feeding the same normalized tables. One audit table covers both, present and future, rather than needing a separate mechanism built later.
- **"Bins" → `staging_locations`.** Same real-world thing Ashley calls "the bin," renamed at the schema level to avoid ambiguity with other meanings of "bin" (trash, storage bucket, etc.) — no functional difference.
- **ORM: Drizzle** (already in use). Recommend splitting `db/schema.ts` into `db/schema/` with one file per entity (`subscribers.ts`, `subscriptions.ts`, `mailings.ts`, etc.), using Drizzle's `relations()` helper alongside table defs for typed relational queries (`db.query.subscriptions.findMany({ with: { mailings: true } })`) instead of manual joins.

## Open Items (not decided)

- Exact column types/lengths/constraints — not finalized at the field level.
- Squarespace integration shape — nothing designed; when that work resumes, check whether Marcy/Codex have already drafted a webhook/sync payload shape before finalizing `ingestion_events` and `orders` details.

## Implementation Path — Two Options

**Option A (recommended starting point): schema only.** Define the Drizzle tables above, generate the migration, get them created in Postgres. `crm_state` keeps working exactly as today — nothing reads from or writes to the new tables yet. Low-risk, independently verifiable.

**Option B: full cutover.** Everything in A, plus rewriting the import logic (spreadsheet upload currently overwrites one JSON blob — would need to become real inserts/updates across the normalized tables) and rewriting `/api/shared-state`'s GET to reassemble the same JSON shape `app.js` expects, by querying the new tables. This is a real rewrite of the core data-access layer — application/business logic, not infrastructure, and meaningfully bigger than anything done so far in this migration.

Decision when this resumes: do A first, treat B as a distinct, separately-scoped follow-up (possibly for Marcy/Codex once the target schema already exists and is proven).