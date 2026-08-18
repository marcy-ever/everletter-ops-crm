# Handoff

The document to open first - whether you're Marcy, or a developer or coding
agent (including a Codex session) who has never seen this repository before.
It assumes a competent developer or agent, and a non-engineer product owner
reading over their shoulder. `AGENTS.md`/`CLAUDE.md` are the full reference;
this is the practical, numbered-steps path through the same material.

> **Merging to `main` is a production deploy.** Not a review action, not a
> staging step - a merged PR builds a new image, ships it to the NAS running
> the real app, and starts serving it to Marcy and Ashley within a few
> minutes. There is no separate "promote to production" step to catch a
> mistake before it's live. Keep this in mind for everything below.

## Getting a local dev environment running

These steps work from a fresh clone, in order. Every command below has been
run exactly as written, in a clean directory, to confirm it works - see this
document's own PR for that verification.

**Prerequisites**: Node.js 22.13 or newer, `pnpm` (via Corepack, bundled with
Node), Docker (with `docker-compose`), and `git`.

1. Clone and enter the repository:

   ```bash
   git clone https://github.com/marcy-ever/everletter-ops-crm.git
   cd everletter-ops-crm
   ```

2. Install dependencies exactly as locked:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

   If `corepack enable` (or the first `pnpm` command after it) fails with
   `Cannot find matching keyid` - a real error hit verifying this document,
   not a hypothetical - Corepack's own bundled signing-key list is stale
   relative to npm's current registry and can't verify the "latest" pnpm
   release it's trying to fetch. It can also silently break an
   already-working `pnpm` on the same machine by overwriting its shim with
   the broken auto-fetch wrapper - if that happens, `pnpm --version`
   itself will start failing the same way, everywhere, not just in this
   clone. The fix in both cases is the same: install pnpm directly instead
   of routing through Corepack's version resolution -
   `npm install -g pnpm@11.20.0` (the version this repo's own
   `devops/app.Dockerfile` and CI both use) - then re-run
   `pnpm install --frozen-lockfile`.

3. Create your local environment file and generate a real secret:

   ```bash
   cp .env.example .env.local
   openssl rand -base64 32
   ```

   Paste that output in as `AUTH_SECRET=` in `.env.local`. **Don't use `npx
   auth secret`** even though other Auth.js guides recommend it - in this
   project it resolves to an unrelated package and prints a
   `BETTER_AUTH_SECRET` line for a different library entirely, not what this
   app reads. Leave `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`ALLOWED_USERS`
   as their placeholder values for now - they're only needed for a real
   Google sign-in, not to boot the app or start Postgres.

4. Start local Postgres and apply migrations:

   ```bash
   pnpm docker:up
   set -a; source .env.local; set +a
   pnpm db:migrate
   ```

   The middle line matters and is easy to skip: `drizzle-kit` (what
   `db:migrate` runs) reads `DATABASE_URL` directly from the process
   environment and does **not** load `.env.local` on its own. Skipping it
   fails with `DATABASE_URL is required`, not a silent fallback to some
   default - this trips up almost everyone the first time.

5. Start the app:

   ```bash
   pnpm dev
   ```

   A blank or missing `AUTH_SECRET` is not a soft failure here - Auth.js
   validates it eagerly, and the first request that reaches
   `/api/auth/signin` gets a real HTTP 500, not a degraded page. If step 3
   was done correctly this won't come up.

6. **Signing in.** The app is at `http://localhost:3000`, gated by Google
   OAuth. Completing a real sign-in needs real `GOOGLE_CLIENT_ID`/
   `GOOGLE_CLIENT_SECRET` (Google Cloud Console credentials - Marcy/Brad have
   these, not committed to the repo) and your email present in
   `ALLOWED_USERS`. Without both, sign-in itself still works - Google will
   authenticate you - but the app then sends you to `/access-denied`: a
   plain page confirming you're signed in but not on the allowlist, with a
   sign-out link. That's the expected result, not a broken app, for anyone
   without real credentials and an allowlist entry.

7. **Getting data to work with.** A fresh database is empty - no seed data
   ships with this repo (see `CLAUDE.md`'s data-boundary note on why). Sign
   in, open the **Import Sheet** view, and upload a `.xlsx`/`.xls`/`.csv`
   mailing schedule (synthetic/test data only - never a real customer
   export, see `CLAUDE.md`'s Local Setup section). Publishing writes it into
   the normalized tables for real. To look at what actually landed,
   **[`docs/postgres.md`](postgres.md)** covers getting a database shell and
   real queries against this schema.

8. **Running tests:**

   ```bash
   pnpm test:unit   # no external services needed
   pnpm test:e2e    # needs local Postgres - see the warning below
   pnpm test        # both, in order - the real release gate
   ```

   **`pnpm test:e2e` truncates your local database.** It's designed around
   that (every e2e file starts from a known, empty state), but it means any
   data you imported in step 7 won't survive a test run - re-import
   afterward if you still need it. Full detail on what needs Postgres and
   why: `docs/testing.md`.

## Making and shipping a change

Ordinary GitHub flow: branch, commit, open a PR against `main`, get it
reviewed, merge.

**Read the callout at the top of this document again before merging
anything.** Merging is the deploy trigger, not a separate step after it.

**What happens on merge**, read directly from
`.github/workflows/build-and-push.yml` and `devops/deploy.sh`:

1. GitHub Actions builds the app image (`devops/app.Dockerfile`) and pushes
   it to GHCR, tagged both `:latest` and `:<commit-sha>`.
2. It then SSHes into the NAS and runs `devops/deploy.sh` there.
3. `deploy.sh` pulls the new image, **runs any pending database migrations
   against the NAS's Postgres** (`devops/migrate/migrate.mjs`, from inside
   the freshly pulled image itself - the NAS has no Node toolchain, so this
   can't run any other way), and only then starts the new app container. A
   failed migration fails the whole deploy loudly, before the old container
   is ever replaced.
4. It waits for the new container to report healthy (`GET /api/health`)
   before logging success. A deploy that never goes healthy is a failed
   deploy, not a silently-broken success.

**Verifying a deploy actually landed**: the fastest honest answer to "is
this the version I just merged?" is the build stamp - shown in the CRM
sidebar's own footer, and returned by `GET /api/health` as `buildTime`/
`commitSha`. Both come from the same build-time values
(`lib/build-info.ts`), never fabricated: `pnpm dev` shows `dev`, an
unstamped local build shows `local build`, and only a real CI-built image
shows a real timestamp and commit SHA. If the sidebar or `/api/health`
doesn't show the commit you just merged a few minutes ago, the deploy
either hasn't run yet or failed - check `devops/deploy.txt` on the NAS
(SSH access required - ask Brad if you don't have it) for what happened.

**Rollback is manual.** There's no automated rollback. The previous
image tag (`:<commit-sha>` from the last known-good commit) stays in GHCR,
so recovering means SSHing into the NAS and re-pointing the Compose
invocation at that older tag by hand. Nothing about this is scripted today.

**Changing the database schema:**

```bash
pnpm db:generate
```

Edit `db/schema/`, run the command above, inspect the generated SQL under
`drizzle/` (drizzle-kit writes it, but treat it as a real code change to
review, not a black box), and commit both the schema change and the
generated migration file together. From there, migrations reach production
automatically: the next merge to `main` deploys the new code *and* applies
the new migration, in the deploy sequence described above - no separate
manual step, unlike the way this used to work (see `CLAUDE.md`'s note on
the NAS episode this closed).

**Day-to-day operations** - starting/stopping the local stack, a database
shell, clearing local data, applying migrations by hand, checking health -
all go through one script:

```bash
devops/devops.sh          # prints every subcommand and what it does
```

`pnpm docker:up`/`docker:up:full`/`docker:down` call this same script under
the hood, so the subcommand list (`up`, `up-full`, `down`, `ps`, `logs`,
`restart`, `db-shell`, `db-clear`, `migrate`, `health`) is the complete set
either way - nothing about local Docker operations lives anywhere else.

## Orientation

The rest of what there is to know lives in these documents - each stays
current on its own, so it's linked here rather than restated:

- **[`docs/architecture.md`](architecture.md)** - where code actually lives,
  the layer boundaries and import-direction rule, how a sidebar view works,
  and the concrete steps to add a new one.
- **[`docs/testing.md`](testing.md)** - the real test suite: what each
  script covers, what needs local Postgres, and why `test:e2e` is
  serialized.
- **[`docs/postgres.md`](postgres.md)** - working with the database
  directly: getting a shell, the host-vs-container port difference, real
  queries against this schema, and what's safe to do by hand versus what
  bypasses the app's own validation/audit/staleness layers.
- **[`docs/data-recovery.md`](data-recovery.md)** - restoring a prior
  spreadsheet import exactly, and the safety net around a bad or
  destructive import.
- **[`docs/auth.md`](auth.md)** - the allowlist format, current entries, how
  to add a user, and what per-feature access control does and doesn't exist
  yet.
- **[`docs/backups.md`](backups.md)** - the NAS's Postgres backup setup
  (local rotation plus offsite Backblaze B2).
- **[`docs/schema-design.md`](schema-design.md)** - the full normalized
  schema's design rationale and the migration history that produced it.

`CLAUDE.md`, at the repository root, is the complete reference this document
summarizes into a practical path - read it for anything not covered above.

## What's Marcy's to decide

These are real, working systems with a deliberate stopping point, not
unfinished engineering work - the remaining piece in each case is a
product/workflow call that only Marcy (and Ashley, day to day) can make.
Full detail on each, including exact code locations, is in `CLAUDE.md` §8;
summarized here as decisions with their rights attached, not as a to-do
list:

- **The bulk-action buttons on Production Queue and Ashley Bins** - whether
  and how to guard a single click that silently rewrites the status of
  every currently-shown row, with no confirmation and no undo. Highest
  priority: this has already caused one real misclick.
- **Whether the current staleness banner is enough**, or whether real
  live-update (so one person's change appears on someone else's already-open
  tab automatically, not just a "refresh to see changes" prompt) is worth
  the real complexity of building it.
- **An audit-log UI.** The data exists, the API exists (`GET /api/audit`) -
  no screen shows it to anyone yet. What it should show, and who should see
  it, is a design call.
- **How long to keep `ingestion_events`/`audit_events`.** Both currently
  keep every row forever; `docs/data-recovery.md` has a specific retention
  recommendation for each, but no decision has been made.

## Known rough edges

Real, disclosed limitations worth knowing about before they're a surprise:

- **No monitoring or error-reporting service is configured.** A crash or a
  silent failure in production has no alerting - the build-stamp/health
  check above is the closest thing to a status signal that exists today.
- **No restore drill has ever been run against the Backblaze B2 backups.**
  The backup mechanism itself runs daily and is real, but nobody has
  verified end to end that restoring from it actually works.
- **`app/globals.css` is still large (~2,400 lines) and undecomposed** - the
  one piece of styling that migrating every view to typed React components
  never touched, since it styles all of them at once.
- **The `pnpm lint` baseline count drifts upward** as more `<img>` tags move
  from old template-literal markup into real JSX (a lint rule that's
  invisible to a string literal becomes visible the moment the same markup
  is real JSX). A lint count slightly above the documented baseline in
  `CLAUDE.md` §8 isn't automatically a new problem - check what changed
  before assuming it's a regression.
