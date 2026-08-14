# Everletter Ops CRM - Developer Handoff

## Decided Direction / Migration Plan

**Target end state:** a well-designed, stable foundation — architecture and data layer — solid enough that Marcy can hand feature work to her own Codex session without either of them needing to make major infrastructure changes first. Marcy is not a software engineer; Brad (this repo's engineer) is. Judge every refactor/infrastructure change against that bar: does it make the foundation something a non-engineer-led session can safely build features on top of, or does it just move the problem around. Apply real software design principles as code is touched — DRY, KISS, modularity, reusable and independently testable components — not as a blanket rewrite mandate, but whenever a change already has code open and the duplication/coupling in front of it is real, not speculative.

**All current app data is disposable test data.** Nothing needs to be preserved, backed up, or migrated carefully during this build-out — it can be deleted and reimported freely. The uploaded spreadsheet remains the actual source of truth for testing/validation, not whatever currently happens to be in the database. (This assumption stops being true once real customer data is live again — don't carry it forward past that point without checking.)

**Workflow: two Claude sessions, two roles.** Code changes to this repo go through a separate execution session/environment ("VM Claude") that receives a precisely-scoped task prompt and does the actual implementation — writes the code, runs tests, opens the PR. A local/orchestrating Claude session (working alongside Brad) is where the design decisions actually get made: discussing direction, reviewing what VM Claude produced, and drafting the next task prompt — not making direct code edits to this repo itself. If you are the local/orchestrating session: don't implement here, draft the prompt. If you are VM Claude executing a task prompt: that prompt is your scope — implement it for real, verify it for real, and report back plainly what you did and didn't get to (see this migration's existing task prompts for the expected level of detail, and be honest about gaps — e.g. flag when live/interactive verification isn't possible in your environment rather than skipping it silently).

The migration described below is **done**, not aspirational. Sections 1-9 describe the app as it actually runs today — not the original OpenAI Codex/Sites build. A short history note follows this section for context on why some conventions (like `public/app.js` remaining a vanilla-JS monolith) still look the way they do, even though the infrastructure around them changed completely.

**Kept, as decided:**

- Next.js, React, TypeScript, Drizzle ORM — all solid and portable. No replacement was needed.

**Dropped (forced by the Codex/Sites path, not chosen on merit) — all removed as of commit `feb8bf8`:**

- OpenAI Sites as the deploy platform (proprietary, not portable).
- Cloudflare Workers as the runtime.
- Vinext (`0.0.50`), Vite, the Cloudflare Vite plugin, and Wrangler.
- Cloudflare D1 as the datastore.

**Replaced with, now live:**

- **Hosting:** self-hosted via Docker Compose on the owner's NAS ("FranklinsTower", per Brad — see §4/§7). Deploys automatically on merge to `main` via GitHub Actions.
- **Persistence:** self-hosted Postgres via Docker. Fully normalized relational schema (`db/schema/`), not the single JSON blob D1 held — see `docs/schema-design.md` for the complete design and migration history.

**`public/app.js`:** this is a large, untyped vanilla-JS monolith, but it holds the real product logic (state, views, validation, envelope generation) and has been battle-tested with real operational use. Plan to migrate it into typed React components incrementally over time as workflows are touched, not as an immediate up-front rewrite. This is still true today — the infrastructure migration below didn't touch it.

**Known risks:**

1. **Ashley's own Google sign-in still hasn't specifically been verified.** The credential blocker is resolved — real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are wired up, and a live sign-in has been verified working end-to-end for at least one allowlisted account (see the Authentication section under §4) — but Ashley's own account specifically hasn't been confirmed yet.
2. ~~No backup/versioning of the dataset.~~ **Resolved.** Local rotating dumps plus offsite Backblaze B2 backups now run daily on the NAS — see `docs/backups.md`.
3. ~~Test suite is stale/broken.~~ **Resolved.** `pnpm test` runs a real suite now — unit tests plus end-to-end tests against a real local Postgres — and is a real release gate. See `docs/testing.md`.

**CI/CD:** exists and is load-bearing — GitHub Actions builds and pushes a Docker image on every push to `main`, then deploys it to the NAS automatically. This is a real, current fact, not a future decision: **a merge to `main` is a production deploy.** See §7 for the exact flow, and `.github/workflows/build-and-push.yml` for the source of truth.

**History, for context — not a live description:** this app was originally built via OpenAI's Codex/Sites tooling, which is why `public/app.js` exists as one large vanilla-JS file wrapped by a server-rendered React shell, rather than typed React components throughout — that build path favored exactly that shape, and rewriting `app.js` wasn't (and still isn't) the priority, per the note above. The Codex/Sites-specific tooling itself — Cloudflare Workers, Vinext, D1, the `.openai/` config, `worker/`, `vite.config.ts` — has been fully removed from the tree (commit `feb8bf8` and the Postgres migration described in `docs/schema-design.md`). Nothing below describes any of that as live infrastructure; where it's mentioned again, it's explicitly historical.

## 1. Project Overview

Everletter is a subscription mail service that sends two physical story letters per month. This private operations CRM is for Marcy and her business partner Ashley. It replaces an error-prone Smartsheet/Excel mailing schedule and coordinates customer lookup, 1st/15th mailing batches, envelope printing, assembly, quality checks, and Ashley's physical storage bins.

The app currently provides:

- Production Queue with current, future, and historical batch filtering
- Needs Review rules for missing/bad dates, incomplete addresses, duplicate-looking records, and unusual character/letter sequences
- Subscriber search and profiles
- Browser-side Excel/CSV import and publication to shared storage
- Character-specific A7 envelope generation and batch printing
- Mailing QA, Batch Packet, and Ashley Bins workflows
- Shared mailing/component status changes
- Sample letter previews
- Squarespace sync and automation simulators that document intended future behavior
- Responsive/mobile layouts focused on customer lookup and quick status changes

Current maturity: **working operational prototype / early production system**. A private hosted version exists (self-hosted via Docker Compose on the owner's NAS — see §4/§7) and has been used with real imported data. Core spreadsheet import, shared status persistence, filtering, profiles, envelope printing, QA, and bin tracking work. It is not yet a finished system of record: the main customer dataset is still produced from spreadsheet imports rather than native entry, and Squarespace/Mailchimp/Drive integrations are not implemented. The data layer itself is no longer the gap it once was — the full normalized-schema migration described in `docs/schema-design.md` is complete.

Important data boundary: this GitHub repository is intentionally sanitized. It contains no real customer spreadsheet data and no private Google Drive folder IDs. The live customer dataset lives in self-hosted Postgres on the NAS (see §4/§7) — not in this repository, and not in any cloud-hosted database. The committed seed files (`public/everletterSeed.json`, `public/seed-data.js`) are empty fallbacks — no real data, just automation-rule text and a zeroed summary — used only before any real dataset has loaded.

## 2. Tech Stack

Runtime and languages:

- Node.js `>=22.13.0`
- TypeScript `5.9.3` for the application shell, API route, database schema/access layer, and the `lib/` modules
- JavaScript (browser-native, non-module) for most CRM behavior in `public/app.js`
- CSS in `app/globals.css`
- SQL migrations for Postgres, generated and applied via Drizzle Kit

Framework and build:

- React `19.2.6`
- React DOM `19.2.6`
- Next.js `16.2.6` (App Router), built and run by Next's own toolchain — no separate build plugin or alternate runtime layer sits in front of it anymore. `pnpm build`'s own banner confirms Turbopack specifically (`▲ Next.js 16.2.6 (Turbopack)`), Next 16's default; nothing in `package.json` passes a Turbopack flag explicitly.

Data and import:

- Postgres 17, self-hosted via Docker (`devops/docker-compose.yml`) — a fully normalized relational schema (`db/schema/`), not a single blob. See `docs/schema-design.md` for the complete design and the two-phase migration that got here.
- `pg` (node-postgres) plus Drizzle ORM `0.45.2` / Drizzle Kit `0.31.10` for the connection and schema/migrations.
- SheetJS/xlsx `0.18.5`; a browser bundle is committed at `public/xlsx.full.min.js`.

Styling/tooling:

- Tailwind/PostCSS packages are installed, but the product UI is primarily hand-written CSS rather than Tailwind utilities.
- ESLint `9.39.4` with Next configuration.
- Node's built-in test runner (`node --test`), wired to a real test suite — see `docs/testing.md`.

Package manager: **pnpm** is the sole authority (`pnpm-lock.yaml` and `pnpm-workspace.yaml`). No `package-lock.json` exists.

The non-obvious architectural choice is deliberate but transitional: the React/TSX layer provides the server-rendered shell, while most product behavior and rendering live in one large browser script. This made rapid prototyping and print-window generation easy, but new substantial work should gradually move into typed modules/components without rewriting working workflows all at once.

## 3. Architecture

### Major directories

- `app/` - App Router UI shell, global CSS, auth helper, and API routes.
- `app/api/shared-state/route.ts` - GET/POST API for the CRM dataset and shared overrides. GET reconstructs `app.js`'s dataset shape from the normalized tables (`lib/build-dataset-from-tables.ts` + `lib/build-overrides-from-tables.ts`); POST dispatches through `lib/write-to-tables.ts` inside one Postgres transaction. See "Current data flow" below and `docs/schema-design.md` — don't restate that doc's history here, it stays current on its own.
- `app/page.tsx` - Static CRM shell, sidebar navigation, filters, and script loading (`seed-data.js` → `xlsx.full.min.js` → `app.js`).
- `app/layout.tsx` - Root HTML layout and metadata.
- `app/globals.css` - All CRM, responsive, mobile, and print-related styling (~2,400 lines — see Known Issues).
- `app/access-denied/page.tsx` - Plain page shown to authenticated users whose email isn't on the `ALLOWED_USERS` allowlist.
- `app/api/auth/[...nextauth]/route.ts` - Auth.js's catch-all route (sign-in, callback, sign-out, session, etc.), re-exporting `handlers` from `auth.ts`.
- `auth.ts` (repo root) - Auth.js config: Google provider, jwt/session callbacks that attach the resolved role (or `null`) to the session via `lib/allowlist.ts`.
- `proxy.ts` (repo root) - Route protection for the whole app (Next 16 renamed `middleware.ts` to `proxy.ts`; see the Authentication section under §4).
- `lib/allowlist.ts` - Parses `ALLOWED_USERS` (`email:role` pairs) and resolves a role for a given email. Pure/testable; see `docs/auth.md`.
- `lib/ids.ts` - Deterministic, hashed ID generation for subscribers/recipients/subscriptions/mailings. Mirrored (not imported — `public/app.js` is a non-bundled browser script) by an identical implementation inline in `app.js`; kept in sync by tests that run the real `app.js` in a sandbox and diff its output against this module.
- `lib/keys.ts` - `mailingKey`/`componentKey`/`exceptionReviewKey` generation and parsing. Same mirrored/tested-in-sync relationship with `app.js` as `lib/ids.ts`. Existing overrides depend on these staying stable across refactors.
- `lib/mailing-rules.ts` - Cadence/status rules (open status, overdue, due-within-14-days, nearest batch date). Same mirrored relationship with `app.js`.
- `lib/write-to-tables.ts` - Writes a POSTed import or status change into the normalized tables, transactionally.
- `lib/build-dataset-from-tables.ts` - Reconstructs the full CRM dataset shape `app.js` expects, by querying the normalized tables directly. The only thing GET reads from now.
- `lib/build-overrides-from-tables.ts` - Reconstructs `componentOverrides` and reviewed-exception keys for GET, since neither has an equivalent field in the dataset shape itself.
- `public/app.js` - Main application (~3,000 lines). Owns state, views, spreadsheet parsing, validation, mailing calculations, status changes, profiles, envelope HTML generation, QA, packet/bin workflows, simulators, and DOM event binding.
- `public/everletterSeed.json` and `public/seed-data.js` - Sanitized empty fallback dataset, loaded synchronously before the real dataset arrives from `/api/shared-state`. Never replace these with production customer data in Git.
- `public/assets/` - Everletter logo, wax seal, character art, envelope corner art, and sample-letter images.
- `db/schema/` - Drizzle table definitions, one file per entity (`subscribers.ts`, `subscriptions.ts`, `orders.ts`, `mailings.ts`, `mailing_components.ts`, `exceptions.ts`, `ingestion_events.ts`, `staging_locations.ts`), plus `relations.ts` and a barrel `index.ts`. Full design rationale: `docs/schema-design.md`.
- `db/index.ts` - `getDb()`, a real `drizzle-orm/node-postgres` connection backed by `DATABASE_URL`. Throws with a clear message if `DATABASE_URL` is unset — there is no silent fallback.
- `drizzle/` - Generated Postgres migrations (six as of this writing, `0000`-`0005`) and Drizzle metadata.
- `tests/` - The real unit and end-to-end test suite, wired into `pnpm test`. See §6 and `docs/testing.md`.
- `devops/` - Docker Compose files (`docker-compose.yml` for Postgres, `docker-compose.app.yml` for the app service), the app's `Dockerfile`, the NAS deploy script, and backup/maintenance scripts. See §4/§7.
- `examples/d1/` - Leftover Cloudflare D1 starter template code, not used by the CRM and not wired into anything. Safe to remove; hasn't been yet.

### Current data flow

1. A user uploads the current `.xlsx`, `.xls`, or `.csv` mailing schedule in the Import Sheet view.
2. `public/app.js` parses and validates it in the browser and builds a structured dataset (subscribers, recipients, subscriptions, orders, mailings, summary, exceptions) via `buildSeedFromSpreadsheet`.
3. Publishing POSTs the complete dataset to `/api/shared-state` as `kind=crmDataset`, `key=current`. The route runs it through `lib/write-to-tables.ts`'s `writeImport()`, which writes it into the normalized tables inside one Postgres transaction — all or nothing.
4. Mailing-status, component-status, and reviewed-exception changes each POST their own `kind`/`key`/`value` and are written directly to the relevant table by `lib/write-to-tables.ts`, also transactionally.
5. On GET, the route calls `buildDatasetFromTables()` to reconstruct the same dataset shape `app.js` expects, directly from the normalized tables — nothing cached, nothing denormalized in between — plus `lib/build-overrides-from-tables.ts` for `componentOverrides` and the `reviewed` exception-key list.
6. On load, `public/app.js` initializes its state synchronously from the empty committed fallback (`window.EVERLETTER_SEED`), then replaces it wholesale with the real reconstructed dataset once `/api/shared-state` resolves. Status/component-status overrides and reviewed-exception flags are additionally cached to `localStorage` as a client-side fallback — the dataset itself is not.

There is no `crm_state` table, blob, or "record kinds" list anymore — it was dropped entirely once the normalized tables became the sole source of truth for both directions. The complete history of that migration (why each table looks the way it does, the dual-write rollout, every schema gap found and either closed or deliberately accepted) is in **[docs/schema-design.md](docs/schema-design.md)** — read it before touching `lib/write-to-tables.ts` or `lib/build-dataset-from-tables.ts` rather than re-deriving any of it here.

### Conventions to preserve

- Never commit customer exports, spreadsheets, email addresses, physical addresses, access tokens, or private Drive IDs.
- Treat stable subscriber/subscription identity separately from Squarespace order numbers. Month-to-month renewals create new order numbers, and one email address can own multiple subscriptions.
- Mailing cadence is the 1st and 15th. A roughly three-day cutoff determines whether a new order can join the imminent batch.
- Month-to-month customers receive two letters per payment and normally need two envelopes printed together. Six- and twelve-month orders receive 12 and 24 letters respectively and are usually prepared in advance.
- Character changes restart the letter number at 1 and should remain a Needs Review event because the envelope/bin workflow changes.
- Preserve stable mailing/component key generation when refactoring; existing overrides depend on those keys (`lib/keys.ts` is the canonical spec).
- Keep customer-data configuration out of static/public assets. Use server-side secrets/config or normalized database records.

## 4. Infrastructure & Services

### GitHub

- Purpose: primary source-control repository, and (as of the CI/CD workflow below) the trigger for production deployment.
- Repository: `https://github.com/marcy-ever/everletter-ops-crm`
- Account/owner: GitHub user/organization `marcy-ever`; Marcy owns the credentials.
- Code config: `.git/config` locally; remote name is `origin`. `.github/workflows/build-and-push.yml` is a real, committed GitHub Actions workflow.
- Important: pushing to `main` **does** trigger production deployment now. This is a change from earlier in this migration — don't assume manual-only deploys.

### Self-hosted Docker Compose (NAS)

- Purpose: runs Postgres (always) and, optionally, the containerized app itself — locally for full-stack verification, and on the NAS as the actual production deploy target.
- Host: the NAS, referred to as "FranklinsTower" per Brad's report (matches the `FT_SSH_*` secret naming in `.github/workflows/build-and-push.yml`). This host is not directly accessible from this repository or its tooling, and its live running state isn't independently verifiable from here — treat any claim about what's currently running there as Brad's report, not something observed.
- Code config: `devops/docker-compose.yml` (Postgres only — the `postgres` service and the `postgres-data` volume) and `devops/docker-compose.app.yml` (the app service). The two are split deliberately so a Postgres-only local startup never has to satisfy the app service's auth vars — see that file's header comment for the full rationale, and §6 for the commands. `package.json`'s `docker:up`/`docker:up:full`/`docker:down` scripts wire these up.
- Data: lives in the `everletter-ops-crm_postgres-data` Docker volume, not in this repository.

### GitHub Container Registry (GHCR)

- Purpose: hosts the built application image the NAS pulls.
- Image: `ghcr.io/marcy-ever/everletter-ops-crm`, tagged `:latest` and `:<commit-sha>`.
- Code config: `devops/app.Dockerfile` (multi-stage build — `pnpm build` in a builder stage, then a slim `node:22-alpine` runner using Next's standalone output). Built and pushed by `.github/workflows/build-and-push.yml`.

### CI/CD

- Purpose: build the app image and deploy it, automatically, on every merge to `main`.
- Provider: GitHub Actions, `.github/workflows/build-and-push.yml`. On every push to `main` (a manual `workflow_dispatch` run only exercises the build/push step, gated separately from the deploy job so it can never trigger a NAS deploy on its own): builds and pushes the GHCR image, then SSHes into the NAS (`FT_SSH_HOST`/`FT_SSH_USER`/`FT_SSH_PORT`/`FT_SSH_PRIVATE_KEY` repository secrets) and runs `devops/deploy.sh` there.
- This supersedes any earlier note that no CI/CD system exists or should be assumed — one exists and is load-bearing for production. **A merge to `main` is a production deploy**, not a review-only action.

### Backups (Postgres → Backblaze B2)

- Purpose: disaster recovery for the NAS's Postgres data — distinct from the "all app data is disposable test data" development assumption stated at the top of this file. Once real customer data is live, this is what actually protects it.
- Code config: `devops/backup.sh` (`pg_dump` → gzip → local rotating copy, plus an `rclone` upload to Backblaze B2), scheduled to run daily via DSM Task Scheduler on the NAS.
- Full setup, account ownership, and the DSM-specific gotchas hit getting `rclone` working: **[docs/backups.md](docs/backups.md)**.
- No real restore drill has been verified or is described in the doc — worth doing before this matters for real data.

### Google Fonts

- Purpose: envelope typography for each Everletter character and adult envelopes.
- Account: none required; fonts are loaded at print-window runtime from `fonts.googleapis.com`/`fonts.gstatic.com`.
- Code config: the `@import` generated in `public/app.js` near the envelope print HTML.
- Risk: envelope appearance depends on network access and font loading at print time (see Known Issues).

### Google Drive (manual workflow; not integrated)

- Purpose: stores print-ready letters and customer envelope files organized by character.
- Account: Everletter's Google Workspace/Drive. Marcy should provide the exact owner/login to the next developer; do not use or mix the unrelated Aarcadian Drive.
- Code config: `driveConfig` in `public/app.js`, but all private folder URLs/IDs were intentionally removed before the GitHub export. Buttons currently alert when no URL is attached.
- Status: no OAuth, Drive API, or service-account integration exists.

### Squarespace (planned; not integrated)

- Purpose: current storefront, subscription checkout, renewals, and sample-request form. Intended future source for automatic paid-order ingestion.
- Site: `https://www.theeverletter.com/`
- Account: Everletter's Squarespace account; credentials are held by Marcy/Ashley and are not in the repo.
- Code config: none. `public/app.js` contains only a Sync Simulator, automation rules, and explanatory UI.
- Status: no webhook, API token, scheduled sync, or product/service mapping is implemented.

### Mailchimp (planned; not integrated)

- Purpose: intended automated delivery of Kid/Adult sample-letter emails and lead tagging.
- Account: not yet documented/connected; Marcy knows Mailchimp and planned to set it up.
- Code config: none. The Sample Requests view in `public/app.js` is a mock workflow and preview library only.
- Status: no API key, audience ID, journey, webhook, or email send exists.

### Gmail / Google Workspace (manual workflow; not integrated)

- Purpose: Everletter business email and current manual receipt of sample requests.
- Known address: `ashley@theeverletter.com`; other mailbox details should be confirmed with Marcy.
- Account: Everletter Google Workspace.
- Code config: none.
- Status: no Gmail API or SMTP integration exists.

### Authentication

- Purpose: restrict the real CRM to authorized users.
- Provider: Auth.js (`next-auth@5`) with Google OAuth, plus an `ALLOWED_USERS` email/role allowlist enforced in `proxy.ts` (Next 16's rename of `middleware.ts`). No passwords, no user database.
- Full reference — allowlist format and current entries, how to check the resolved role in server code and in `public/app.js`, how to add a user, and what's explicitly **not** built yet (no per-feature restrictions exist): see **[docs/auth.md](docs/auth.md)**.
- Status: **live and verified**, not merely structurally complete (see Decided Direction, above). Real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are wired up, and a live sign-in has been verified working end-to-end for at least one allowlisted account. Ashley's own sign-in specifically hasn't been confirmed yet.
- A blank `AUTH_SECRET` is not a soft failure — Auth.js validates it eagerly, and any request that reaches `/api/auth/signin` with it unset gets a real HTTP 500 (`MissingSecret`), verified directly while fixing the local-setup docs. See §5/§6.

### DNS and custom domain

- No custom CRM domain or DNS configuration is present in this repository. The app is exposed via the NAS's Docker port mapping — container port 3000 to host port 3100 (`devops/docker-compose.app.yml`). Whether port 3100 is reachable only on the local network or is also forwarded/proxied for external access is NAS-side configuration outside this repo and not verifiable from the tree — confirm with Brad. The marketing site/domain remains in Squarespace and is not configured here.

### Payments/SMS/other APIs

- Stripe/Squarespace payment data is not directly integrated.
- No SMS service exists.
- No object storage (R2 or otherwise) is configured for this app.

## 5. Environment Variables & Secrets

All required and optional variables are documented in `.env.example` — copy it to `.env.local` (gitignored) for local development. Do not invent or commit secrets.

- `DATABASE_URL` - read directly by the app and by `drizzle-kit` (source `.env.local` into your shell first — `drizzle-kit` doesn't auto-load it). Defaults to local Postgres (`postgres://everletter:everletter@localhost:5433/everletter_dev`), matching `devops/docker-compose.yml`'s defaults.
- `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` - read by `devops/docker-compose.yml` (via `--env-file .env.local`) to configure the Postgres container. Keep in sync with `DATABASE_URL` by hand — dotenv files don't support variable interpolation. `POSTGRES_PASSWORD` is required and fails loudly (Compose's `:?` guard) if unset; the other two have dev-safe fallbacks.
- `AUTH_SECRET` - required for `pnpm dev` and `pnpm docker:up:full`, **not** for `pnpm docker:up` (Postgres only — no app process runs, so nothing reads it). Validated eagerly by Auth.js: leaving it blank isn't a graceful degrade, it's a real HTTP 500 the first time anything hits `/api/auth/signin` — verified directly. Generate one with `openssl rand -base64 32` (see `.env.example`'s comment for why `npx auth secret`, sometimes recommended elsewhere, is the wrong command in this project).
- `AUTH_URL` - the Auth.js callback URL, same requirement as `AUTH_SECRET`. `http://localhost:3000` is correct for local `pnpm dev`/`docker:up:full`; a real deployment needs its actual reachable URL.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` - Google Cloud Console OAuth 2.0 Web application credentials. Needed to complete a real Google sign-in, but — unlike `AUTH_SECRET`/`AUTH_URL` — not validated eagerly; the app process itself starts fine with placeholders, verified directly.
- `ALLOWED_USERS` - comma-separated `email:role` pairs, the allowlist gate. See `docs/auth.md`.
- `AUTH_TRUST_HOST` - optional; defaults to `false` in `devops/docker-compose.app.yml`. Not in `.env.example` since it's optional with a working default.

No Cloudflare/Wrangler/Miniflare bindings exist anywhere in this stack anymore. `DB`/`ASSETS`/`IMAGES` and any `WRANGLER_*`/`MINIFLARE_*`/`CODEX_SANDBOX` variable belonged to the removed Worker runtime and have no equivalent now.

## 6. Local Setup

### Clone and install

1. Install Git, Node.js 22.13 or newer, and pnpm.
2. Clone and enter the repository:

   ```bash
   git clone https://github.com/marcy-ever/everletter-ops-crm.git
   cd everletter-ops-crm
   ```

3. Install exactly from the pnpm lockfile:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```

4. Copy `.env.example` to `.env.local` (gitignored) and generate a real `AUTH_SECRET` — required before `pnpm dev` will do anything but 500 on sign-in (see §5):

   ```bash
   cp .env.example .env.local
   openssl rand -base64 32   # paste the output in as AUTH_SECRET= in .env.local
   ```

   Leave `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`ALLOWED_USERS` as their `.env.example` placeholders for now — they're only needed to complete a real sign-in, not to boot the app or start Postgres.

5. Start local Postgres and apply migrations:

   ```bash
   pnpm docker:up
   set -a; source .env.local; set +a
   pnpm db:migrate
   ```

   `docker:up` reads `.env.local` itself (via Compose's `--env-file` flag) and starts only the `postgres` service (`devops/docker-compose.yml`), working with **zero** auth vars set, deliberately — see §5. `docker:up`/`docker:up:full`/`docker:down` all pass an explicit `--project-directory .` and `-p everletter-ops-crm`, so the project name (and its data volume) stay stable regardless of where the compose files themselves live.

   `db:migrate` is different: `drizzle-kit` reads `process.env.DATABASE_URL` directly (`drizzle.config.ts:3-6`) and throws immediately if it's unset — it does **not** load `.env.local` on its own, verified directly. The `source .env.local` step above is required before `db:migrate` (and before running any other `drizzle-kit` command by hand); skipping it fails with `DATABASE_URL is required`, not a silent fallback.

6. Start local development:

   ```bash
   pnpm dev
   ```

### Full containerized stack (optional)

```bash
pnpm docker:up:full
```

Builds and runs the app itself in Docker too (both compose files together: `-f devops/docker-compose.yml -f devops/docker-compose.app.yml`), reachable at `http://localhost:3100`. Unlike `docker:up`, this **does** need every auth var actually filled in — `AUTH_SECRET`/`AUTH_URL`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`ALLOWED_USERS` all fail loudly if unset or blank. Meant for full-stack/NAS-parity verification, not day-to-day iteration (`pnpm dev` against the same `docker:up` Postgres is faster for that). `pnpm docker:down` tears down whatever's currently up.

### Build, lint, typecheck, and database migration

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm db:generate
pnpm db:migrate
```

Only run `pnpm db:generate` after intentionally changing something under `db/schema/`, then inspect the generated migration in `drizzle/`, commit it, and run `pnpm db:migrate` to apply it to your local Postgres. Both `drizzle-kit` commands need `DATABASE_URL` exported into the shell first (`set -a; source .env.local; set +a` — see step 5 above); neither loads `.env.local` on its own.

### Tests

```bash
pnpm test:unit   # six unit test files, no external services needed, runs in parallel
pnpm test:e2e    # three end-to-end files, need local Postgres, deliberately serialized
pnpm test        # test:unit then test:e2e - the real release gate
```

This is a real, current test suite — not the stale starter tests this file used to describe. Full details (which tests need Postgres and how to bring it up, why `test:e2e` is serialized, what the shared e2e helper module provides, and — important — **that running `test:e2e` truncates your local dev database**): **[docs/testing.md](docs/testing.md)**. Don't restate that doc's content here; it stays current on its own.

### Local data caution

- Do not import production spreadsheets into a screen recording, shared test environment, or Git-tracked fixture.
- Use synthetic data for development.
- Browser localStorage keys include `everletterStatusOverrides`, `everletterComponentOverrides`, and `everletterReviewedExceptions`. They are fallback/cache state and can make two local test runs appear inconsistent.

## 7. Deployment

Deployment is **automatic** on merge to `main` — this is a change from earlier in this migration; don't assume a manual step is required or possible to skip.

Real flow, read directly from `.github/workflows/build-and-push.yml` and `devops/deploy.sh` (the NAS itself is not accessible from here, and no live run has been observed to succeed — everything below is what the committed code does, not observed production behavior; confirm current live state with Brad):

1. A commit lands on `main` (merge or direct push).
2. GitHub Actions' `build-and-push` job builds the app image from `devops/app.Dockerfile` and pushes it to GHCR as `ghcr.io/marcy-ever/everletter-ops-crm:latest` and `:<commit-sha>`.
3. The `deploy` job — gated on the push event specifically, so a manual `workflow_dispatch` build-only run can never trigger it — SSHes into the NAS using the `FT_SSH_*` repository secrets and runs `~/lyra/everletter-ops-crm/devops/deploy.sh`.
4. `devops/deploy.sh`: copies itself to a stable temp path and re-execs from there first (so the `git reset --hard` two steps later, which replaces the very script file bash is executing, can't make bash jump to a corrupted byte offset mid-run — verified in isolation, not on the NAS itself); fetches; checks whether either compose file changed since the last deploy; `git reset --hard origin/main`s the NAS checkout; then either does a full `down`/`pull`/`up` (compose files changed) or just pulls and recreates the `app` service (otherwise).

Rollback: no automated rollback exists. The previous image tag (`:<commit-sha>`) stays in GHCR, so a manual rollback means SSHing in and re-pointing the compose invocation at an older tag by hand — not scripted.

Backups: see **[docs/backups.md](docs/backups.md)** for the real, current Postgres backup setup (local rotation plus offsite Backblaze B2) — this file no longer describes an unprotected dataset.

## 8. Known Issues & Unfinished Work

Highest priority:

- **No live-update mechanism between users.** The app uses plain HTTP GET/POST for `/api/shared-state` — there's no websocket or push mechanism, so if Marcy and Ashley are both using the CRM at the same time, one person's changes (status updates, imports, reviewed exceptions) won't appear for the other until they manually refresh the page. This risks someone acting on stale data without realizing it. TODO for whoever picks this up next (likely Codex): at minimum, a lightweight "this page may be stale, refresh to see recent changes" indicator would prevent acting on outdated information — doesn't require full realtime sync, just a signal. A full live-update experience (websockets or polling-based) would be a bigger undertaking to consider once that minimal version is in place.
- **Re-importing a spreadsheet still overwrites current data with no history, versioned rollback, or user-facing export/restore flow.** This survived the migration off the JSON blob — `lib/write-to-tables.ts`'s `writeImport()` still deletes any subscriber/subscription/order/mailing/exception row not present in the new import (verified directly: `db.delete(...).where(notInArray(...))` for each entity), the same "current import replaces everything" behavior the blob had, just now expressed as real deletes across normalized tables instead of overwriting one JSON value. This is a distinct problem from the dataset-loss risk the NAS backups (see §4) now cover — daily `pg_dump` snapshots protect against losing the database entirely, not against undoing one bad reimport or reviewing what an import actually changed.
- **Status/component-status saves are asynchronous and optimistic, with no retry or user-visible failure indicator.** `saveSharedState()` (`public/app.js:173-181`) fires the POST and silently swallows any failure (`.catch(() => {})`, "keep local changes usable if the shared endpoint is briefly unavailable") — a failed save looks identical to a successful one from the UI, and there's no retry queue.
- **Two separate sets of unguarded bulk-action buttons apply a status change to every currently-shown row with a single click and no confirmation dialog.** Each row fires an independent, fire-and-forget POST (`saveSharedState`, `public/app.js:173-181`) — no batching, no undo, no confirmation step:
  - Production Queue's "Update shown rows" status buttons (`public/app.js:935-942` for the buttons, `974-979` for the click handler that loops every shown row through `updateMailingStatus`, `public/app.js:286-291`).
  - Ashley Bins' "Update shown rows" mark-ready/mark-needs-check buttons (`public/app.js:2433-2438` for the buttons, `2485-2501` for the click handler, which fires three `updateComponentStatus` calls per row).

  A single accidental click — or a click by someone who doesn't realize what the button does — can silently overwrite the status of every currently-shown mailing at once. This already happened with the Production Queue buttons: Marcy confirmed she clicked them believing they were status *filters*, not bulk-rewrite actions — the pill-button styling doesn't visually distinguish them from the filter controls elsewhere in the UI. The Ashley Bins instance has the identical shape and hasn't been reported as misclicked yet, but nothing about it is actually safer. TODO for whoever picks this up next (likely Codex): add a confirmation step before either fires (e.g. "Set status to X for the N mailings currently shown?"), and consider restyling both so they're not visually confusable with filters — especially before real operational data is being tracked day to day, a misclick currently has no safety net at all.
- Stable keys (`mailingKey`/`componentKey`/`exceptionReviewKey`) are derived in browser code, mirrored (not imported — `app.js` is a non-bundled script) by `lib/keys.ts` for the server side. A key-generation change on either side that isn't kept in sync can orphan existing overrides.
- Ashley's own Google sign-in specifically hasn't been verified yet (see Decided Direction's risk list, above).
- No per-feature/per-role restrictions exist yet, even though the resolved role is available (`session.role`, and `data-user-role` on the page shell for `public/app.js`). Pending Marcy specifying what Ashley should be restricted from. See `docs/auth.md`.
- Private Google Drive folder IDs aren't in this repository at all, so Drive buttons remain incomplete everywhere the app now runs — unlike under the old Sites deployment, there's no separately-configured "live" version anymore that could differ from this source; the NAS deploy builds directly from this same git history.
- The `exceptions` table has no columns to fully verify a `reviewedException` override key. The client's key (`exceptionReviewKey`, `public/app.js`) encodes `mailingId`/`subscriberId`/`reason`/`shipDate`, but server-side matching only cross-checks `mailingId` and `reason` — there's no column for `subscriberId`/`shipDate`. This is a known, documented schema limit (see `docs/schema-design.md`'s dual-write notes), not a shortcut anyone's forgotten about. TODO for whoever picks this up next (likely Codex): decide whether to add `subscriberId`/`shipDate` snapshot columns to `exceptions`, or explicitly accept this as a permanent limitation of `reviewedException` matching.
- `devops/clear_db.sh` truncates a `crm_state` table that no longer exists (dropped along with the rest of the JSON-blob storage — see `docs/schema-design.md`) — it will fail as committed. Verified directly against the current schema; not yet fixed.

Integrations not built:

- Squarespace order/renewal/cancellation/failed-payment sync
- Identity matching for one email with multiple subscriptions beyond current import heuristics
- Mailchimp sample-request automation and conversion tracking
- Google Drive API lookup/attachment/printing
- Gmail automation
- Revenue/lifetime-value and per-character fulfillment cost tracking

Code quality/maintenance:

- `public/app.js` is a very large monolithic script (~3,000 lines) with untyped state and direct DOM rendering.
- `app/globals.css` is similarly large (~2,400 lines) and should be decomposed carefully.
- `examples/d1/` remains — leftover Cloudflare D1 starter template code, unused by the CRM.
- Some source strings show mojibake such as `Â·`; normalize encoding while preserving intended display.
- Google Fonts load over the network in generated print windows. Printing before fonts finish loading may use fallback fonts.
- Envelope output needs physical-printer QA for feed orientation, scaling at 100%, A7 paper size, margins, and each character's colored stock.
- The browser-side xlsx bundle (`public/xlsx.full.min.js`) is committed/minified and should be tracked to its exact source/version and updated intentionally.
- API input has minimal validation and no payload-size limit. A malformed or oversized dataset could cause operational problems.
- No automated accessibility, mobile, or print-layout tests exist. Real integration/API-level end-to-end tests now exist (`tests/*.e2e.test.mjs`, see `docs/testing.md`) — browser/UI-level end-to-end tests still don't.
- No monitoring/error reporting service is configured.

Operational caveats:

- The live Postgres data on the NAS will generally be newer/different than the empty committed seed files or any spreadsheet in this repository — same caveat this file made about the old hosted D1 database, just pointed at the current datastore. Don't assume what's in the seed files or a local spreadsheet reflects live state.
- The real app should remain private because it contains names, emails, and mailing addresses.
- Re-importing a spreadsheet can cause old Needs Review flags to return because reviewed flags are tied to generated exception keys.
- The previous "public fake-data demo, separate from production" mentioned in earlier versions of this file could not be re-confirmed against the current tree or infrastructure — if it still exists, get its current status from Brad before relying on this note; it isn't restated here as fact.

## 9. Recent Context and Recommended Next Steps

Most recent completed work:

- The full normalized-schema migration: designed (`docs/schema-design.md`), dual-written alongside the old blob, validated, promoted to the live read/write path, and the old `crm_state` table dropped entirely. Self-hosted Postgres on the NAS replaced Cloudflare D1.
- Cloudflare Workers, Vinext, Vite, Wrangler, and OpenAI Sites were removed from the tree; hosting moved to self-hosted Docker Compose on the NAS.
- CI/CD stood up: GitHub Actions builds and pushes a GHCR image and deploys it to the NAS automatically on every merge to `main`.
- The Docker Compose setup was split into a Postgres-only base file and an app-service file, fixing a real bug where a fresh clone's Postgres-only startup failed on the app service's unrelated auth-var requirements.
- The stale starter test suite was replaced with a real one (`pnpm test` now runs actual unit and end-to-end tests and is a real release gate), and leftover starter artifacts (`app/_sites-preview/`, `react-loading-skeleton`, `tests/rendered-html.test.mjs`) were removed.
- Local Postgres backups (rotating) plus offsite Backblaze B2 backups were set up on the NAS, running daily.
- Google OAuth plus the `ALLOWED_USERS` allowlist went from structurally-complete-but-untested to a live-verified sign-in.

Logical next steps, roughly in order:

1. **Confirm Ashley's own sign-in** against the real deployment — the one remaining piece of the auth rollout.
2. **Fix the unguarded bulk-action buttons** (Production Queue and Ashley Bins, both described in §8) — add a confirmation step and visually distinguish them from filter controls. One of the two has already caused a real mistake.
3. **Add the "page may be stale" signal** described in §8, as a lightweight first step toward real live-update between Marcy and Ashley.
4. **Decide the `exceptions` reviewedException key-verification gap** — add the missing snapshot columns, or explicitly accept the current limitation as permanent (§8).
5. **Fix or remove `devops/clear_db.sh`** — it references a dropped table and will fail as committed.
6. **Harden the API and import path**: add real input validation and a payload-size limit to `/api/shared-state` (§8), and give reimports at least a minimal history/rollback story instead of the current delete-and-replace behavior — the NAS backups (§4) cover total data loss, not undoing one bad import.
7. **Build native manual entry/editing** so spreadsheet upload can eventually be retired as the system of record.
8. **Move private Drive folder configuration server-side**, and connect the Drive integration for real.
9. **Connect Squarespace**: idempotent ingestion, raw-payload preservation, subscription identity independent of order numbers, multiple subscriptions per email, mailing schedules created only after successful payment.
10. **Add Mailchimp sample automation**: capture requests, tag Kid/Adult, send samples, record consent/source/time, match later purchases.
11. **Add observability and operational safeguards**: monitoring/error reporting, an audit log, failed-save retry visibility (§8), and a verified restore drill against the now-real backups.
12. **Incrementally migrate `public/app.js` and decompose `app/globals.css`** into typed modules/components, one touched workflow at a time — not a scheduled rewrite, per the Decided Direction section above.

Do not begin by rewriting the UI. The working operational rules encoded in `public/app.js` are valuable and are already covered by the real test suite (`docs/testing.md`) at the level that suite tests. Migrate one workflow at a time into typed modules while keeping mailing-day behavior stable.
