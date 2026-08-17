# Working with Postgres directly

Practical reference for answering a question about live data - not a schema
design doc (that's [`docs/schema-design.md`](schema-design.md)) and not a
disaster-recovery procedure (that's [`docs/data-recovery.md`](data-recovery.md)).
Assumes nothing about this stack beyond "there's a Postgres somewhere."

## Getting a shell

```bash
devops/devops.sh db-shell
```

Opens an interactive `psql` session inside the running Postgres container,
using the user/database from `.env.local`. Requires Postgres to already be
up (`devops/devops.sh up`).

If the script isn't available (or you need a one-off command instead of an
interactive session), the raw form it wraps:

```bash
docker exec -it everletter-ops-crm_postgres_1 psql -U everletter -d everletter_dev
```

`everletter-ops-crm_postgres_1` is the container name under Docker Compose
v1 (`docker-compose`, hyphenated - what this repo actually runs, see
`devops/docker-compose.yml`). Confirm the real name first if it's ever in
doubt: `docker ps --filter name=postgres`.

## The port gotcha

Compose maps Postgres to **port 5433 on the host**, but the container
listens on the standard **5432** internally
(`devops/docker-compose.yml`: `"5433:5432"`). Which one you need depends on
where you're connecting *from*:

- **Inside the Docker network** (the app container talking to the `postgres`
  service) - port **5432**. `devops/docker-compose.app.yml` builds the app
  container's own `DATABASE_URL` as `postgres://...@postgres:5432/...`.
- **From the host** - anything you run directly on the machine, not inside a
  container - port **5433**. This includes `drizzle-kit migrate`
  (`devops/devops.sh migrate` / `pnpm db:migrate`), `psql` run from the host
  if you have a client installed, and any ad hoc script that connects via
  `DATABASE_URL`.

`.env.example`'s `DATABASE_URL` already points at `localhost:5433`, correctly,
for host-side tools. **This exact mismatch is live in the NAS's
`.env.local` right now** - its `DATABASE_URL` needs to say `5433`, not
`5432`, or a migration run from the NAS's own shell (not from inside a
container) connects to nothing. Check this before running `migrate` there.

## psql basics

Once you have a shell (`devops/devops.sh db-shell`, or the raw `docker exec`
form above):

```
\dt              -- list tables
\d mailings       -- describe one table's columns, types, indexes, FKs
\x                -- toggle expanded display - one column per line instead
                  --   of a wide row wrapping illegibly across the terminal
\x auto           -- same, but only expands when a row is actually wide
\q                -- quit
```

## Real queries against this schema

Every query below was run against a real local Postgres with the test
fixture imported, not written from the schema alone. Table/column names
match `db/schema/` exactly - see that directory (or `\d <table>` above) if
a column here ever looks wrong; this file doesn't restate the schema
design, only how to query it.

**Find a subscriber by email:**

```sql
SELECT id, email, name FROM subscribers WHERE email = 'someone@example.com';
```

**A subscriber's subscriptions and mailings** (there's no separate
`recipients` table - each subscription has exactly one recipient, inlined
directly on the `subscriptions` row itself; see `db/schema/subscriptions.ts`'s
own header for why):

```sql
SELECT id, character, term_type, status, recipient_name
FROM subscriptions
WHERE subscriber_id = 'SUB-XXXXXXXXXXXXXXXXXXXXXXXX';

SELECT m.id, m.letter_number, m.scheduled_date, m.status
FROM mailings m
JOIN subscriptions s ON m.subscription_id = s.id
WHERE s.subscriber_id = 'SUB-XXXXXXXXXXXXXXXXXXXXXXXX'
ORDER BY m.scheduled_date;
```

**Count mailings by status** (useful for a quick sanity check against what
the Production Queue view is showing):

```sql
SELECT status, count(*) FROM mailings GROUP BY status ORDER BY count(*) DESC;
```

**Mailings for a given ship date:**

```sql
SELECT id, status, recipient_name FROM mailings WHERE scheduled_date = '2026-08-15';
```

**Recent `audit_events`** (who changed what, and when - see
`db/schema/audit_events.ts`):

```sql
SELECT occurred_at, actor_email, kind, item_key, previous_value, new_value
FROM audit_events
ORDER BY occurred_at DESC
LIMIT 20;
```

**`ingestion_events` with their summaries** (every spreadsheet import, not
the full `raw_payload` - that column alone can be hundreds of KB per row,
see `docs/data-recovery.md`):

```sql
SELECT id, occurred_at, source, status, summary
FROM ingestion_events
ORDER BY occurred_at DESC
LIMIT 20;
```

**Which migrations have run** - the tracking table lives in its own
`drizzle` schema, not `public`, so it won't show up in a bare `\dt`:

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

Compare the row count against the number of files in `drizzle/` to see
whether the database this connects to is actually current - this is exactly
the check worth running on the NAS given `devops/deploy.sh` never runs
migrations itself (CLAUDE.md §7).

## What's safe, and what isn't

**Reading is safe.** Every query above is a plain `SELECT`; run any of them
against the live NAS database without hesitation.

**Writing by hand isn't safe, even though nothing stops you.** A hand-written
`UPDATE`/`INSERT`/`DELETE` against these tables bypasses every layer this
app normally writes through:

- **No validation.** `lib/validate-shared-state.ts`'s shape checks, the
  catastrophic-deletion guard, the request-size cap - none of that runs. A
  raw SQL statement goes straight to the table.
- **No audit log.** `audit_events` only gets a row when a change goes
  through `POST /api/shared-state` (`app/api/shared-state/route.ts`). A
  hand-edited row leaves no trace of who changed it or what it was before -
  the exact history the audit log exists to guarantee, silently absent for
  this one change.
- **No change marker.** The staleness signal (`lib/change-marker.ts`,
  CLAUDE.md §8) only advances on a real write through the app. Someone with
  the CRM open in another tab has no way to know the row they're looking at
  just changed underneath them - their page won't show a staleness banner,
  because as far as the app can tell, nothing happened.

None of this is enforced at the database level - Postgres will happily take
the write. It's enforced by going through the app instead. **This is the
thing someone will otherwise reach for at 11pm on a mailing day** when a
status looks wrong and a two-line `UPDATE` seems faster than clicking
through the UI: it'll "work," in the sense that the row changes, and it'll
quietly break the one thing (audit history, staleness detection) that would
otherwise help sort out what happened if something *else* goes wrong the
same night.

If a mailing's data is actually corrupted, or a bad import needs undoing,
see **[`docs/data-recovery.md`](data-recovery.md)** for the real, supported
path (`devops/restore-ingestion-event.mjs`, restoring a prior import
exactly) instead of hand-editing rows to compensate.
