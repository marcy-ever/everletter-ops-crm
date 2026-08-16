# Everletter Ops CRM - Developer Handoff

## Decided Direction / Migration Plan

**Target end state:** a well-designed, stable foundation — architecture and data layer — solid enough that Marcy can hand feature work to her own Codex session without either of them needing to make major infrastructure changes first. Marcy is not a software engineer; Brad (this repo's engineer) is. Judge every refactor/infrastructure change against that bar: does it make the foundation something a non-engineer-led session can safely build features on top of, or does it just move the problem around. Apply real software design principles as code is touched — DRY, KISS, modularity, reusable and independently testable components — not as a blanket rewrite mandate, but whenever a change already has code open and the duplication/coupling in front of it is real, not speculative.

**All current app data is disposable test data.** Nothing needs to be preserved, backed up, or migrated carefully during this build-out — it can be deleted and reimported freely. The uploaded spreadsheet remains the actual source of truth for testing/validation, not whatever currently happens to be in the database. (This assumption stops being true once real customer data is live again — don't carry it forward past that point without checking.)

**Workflow: two Claude sessions, two roles.** Code changes to this repo go through a separate execution session/environment ("VM Claude") that receives a precisely-scoped task prompt and does the actual implementation — writes the code, runs tests, opens the PR. A local/orchestrating Claude session (working alongside Brad) is where the design decisions actually get made: discussing direction, reviewing what VM Claude produced, and drafting the next task prompt — not making direct code edits to this repo itself. If you are the local/orchestrating session: don't implement here, draft the prompt. If you are VM Claude executing a task prompt: that prompt is your scope — implement it for real, verify it for real, and report back plainly what you did and didn't get to (see this migration's existing task prompts for the expected level of detail, and be honest about gaps — e.g. flag when live/interactive verification isn't possible in your environment rather than skipping it silently).

The migration described below is **done**, not aspirational. Sections 1-9 describe the app as it actually runs today — not the original OpenAI Codex/Sites build. A short history note follows this section for context on why some conventions (like `app/crm/legacy-app.js` remaining a vanilla-JS monolith) still look the way they do, even though the infrastructure around them changed completely.

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

**`app/crm/legacy-app.js`:** this is a large, untyped vanilla-JS monolith, but it holds the real product logic (state, views, validation, envelope generation) and has been battle-tested with real operational use. Plan to migrate it into typed React components incrementally over time as workflows are touched, not as an immediate up-front rewrite. This is still true today — the infrastructure migration below didn't touch it.

**Known risks:**

1. **Ashley's own Google sign-in still hasn't specifically been verified.** The credential blocker is resolved — real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are wired up, and a live sign-in has been verified working end-to-end for at least one allowlisted account (see the Authentication section under §4) — but Ashley's own account specifically hasn't been confirmed yet.
2. ~~No backup/versioning of the dataset.~~ **Resolved.** Local rotating dumps plus offsite Backblaze B2 backups now run daily on the NAS — see `docs/backups.md`.
3. ~~Test suite is stale/broken.~~ **Resolved.** `pnpm test` runs a real suite now — unit tests plus end-to-end tests against a real local Postgres — and is a real release gate. See `docs/testing.md`.

**CI/CD:** exists and is load-bearing — GitHub Actions builds and pushes a Docker image on every push to `main`, then deploys it to the NAS automatically. This is a real, current fact, not a future decision: **a merge to `main` is a production deploy.** See §7 for the exact flow, and `.github/workflows/build-and-push.yml` for the source of truth.

**History, for context — not a live description:** this app was originally built via OpenAI's Codex/Sites tooling, which is why `app/crm/legacy-app.js` exists as one large vanilla-JS file wrapped by a server-rendered React shell, rather than typed React components throughout — that build path favored exactly that shape, and rewriting `app.js` wasn't (and still isn't) the priority, per the note above. The Codex/Sites-specific tooling itself — Cloudflare Workers, Vinext, D1, the `.openai/` config, `worker/`, `vite.config.ts` — has been fully removed from the tree (commit `feb8bf8` and the Postgres migration described in `docs/schema-design.md`). Nothing below describes any of that as live infrastructure; where it's mentioned again, it's explicitly historical.

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
- JavaScript (browser-native; a real ES module as of the app.js → ESM move, §9) for most CRM behavior in `app/crm/legacy-app.js`
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
- `app/page.tsx` - Static CRM shell: renders `<Sidebar />` (`app/crm/shell/`), the topbar/metric/filter markup, and script/module loading: `seed-data.js` → `xlsx.full.min.js` (both still plain `beforeInteractive` `<Script>` tags) → `<CrmApp />` (mounts and initializes `app/crm/legacy-app.js`).
- `app/layout.tsx` - Root HTML layout and metadata.
- `app/globals.css` - All CRM, responsive, mobile, and print-related styling (~2,400 lines — see Known Issues).
- `app/access-denied/page.tsx` - Plain page shown to authenticated users whose email isn't on the `ALLOWED_USERS` allowlist.
- `app/api/auth/[...nextauth]/route.ts` - Auth.js's catch-all route (sign-in, callback, sign-out, session, etc.), re-exporting `handlers` from `auth.ts`.
- `auth.ts` (repo root) - Auth.js config: Google provider, jwt/session callbacks that attach the resolved role (or `null`) to the session via `lib/allowlist.ts`.
- `proxy.ts` (repo root) - Route protection for the whole app (Next 16 renamed `middleware.ts` to `proxy.ts`; see the Authentication section under §4).
- `lib/allowlist.ts` - Parses `ALLOWED_USERS` (`email:role` pairs) and resolves a role for a given email. Pure/testable; see `docs/auth.md`.

**`lib/domain/`** - pure business rules with no DOM/state/window/localStorage/clock dependency, imported directly by both the browser bundle (`app/crm/legacy-app.js`) and server code. This is what the app.js decomposition (§9) has been extracting into, one step at a time:

- `lib/domain/ids.ts` - Deterministic, hashed ID generation for subscribers/recipients/subscriptions/mailings.
- `lib/domain/keys.ts` - `mailingKey`/`componentKey`/`exceptionReviewKey` generation and parsing. Existing overrides depend on these staying stable across refactors.
- `lib/domain/mailing-rules.ts` - Cadence/status rules (open status, overdue, due-within-14-days, nearest batch date).
- `lib/domain/plans.ts` - Plan normalization and everything derived from a plan (letter count, print mode, envelope quantity).
- `lib/domain/characters.ts` - Character normalization, Drive-config lookup keys, and envelope stock selection.
- `lib/domain/batch-dates.ts` - Per-order batch date generation and Ashley-bin storage labeling.
- `lib/domain/dataset.ts` - The canonical `Dataset`/`DatasetSubscriber`/`DatasetRecipient`/`DatasetOrder`/`DatasetSubscription`/`DatasetMailing`/`DatasetException`/`DatasetSummary` interfaces - the one shape both `buildSeedFromSpreadsheet` (client) and `buildDatasetFromTables` (server) produce.
- `lib/domain/format.ts` - `formatDate`/`titleCase`, used by domain logic (`batch-dates.ts`, `characters.ts`) as well as views.
- `lib/domain/spreadsheet/` - `normalize.ts` (per-cell normalizers), `build-seed.ts` (`buildSeedFromSpreadsheet`, the full client-side seed builder), `exceptions.ts` (`spreadsheetExceptionReasons`).

**`lib/client/`** - browser-only services and derivations (no DOM dependency) that `app/crm/legacy-app.js` composes into its rendering; may import `lib/domain/`. Extracted from `legacy-app.js` in decomposition step 4:

- `lib/client/crm-state.ts` - `createCrmState()`, a factory (deliberately not a module-level singleton - see its header) producing the CRM's client-side state plus its write-through mutators, `updateMailingStatus`/`updateComponentStatus`/`updateEnvelopeStatus`.
- `lib/client/local-overrides.ts` - localStorage load/save for the three override caches (`everletterStatusOverrides`, `everletterComponentOverrides`, `everletterReviewedExceptions`).
- `lib/client/shared-state-client.ts` - `saveSharedState`/`loadSharedState`/`saveSharedDataset`, the `/api/shared-state` HTTP client.
- `lib/client/selectors.ts` - Pure cross-view selectors (`effectiveMailing(s)`, `activeExceptions`, `componentStatus`, the batch-date family, subscriber/recipient lookups) taking their inputs explicitly rather than reading a global - the shape the eventual React views need too.

**Import direction is a rule every future decomposition step depends on, not just a convention:** `app/` and server-side `lib/` modules (`lib/write-to-tables.ts`, `lib/build-dataset-from-tables.ts`, etc.) may import `lib/domain/`; `lib/client/` may also import `lib/domain/`. `lib/domain/` imports nothing from `app/` or `lib/client/` - no DOM, state, window, or clock dependency, which is what lets the same implementation run in the browser bundle and on the server.

- `lib/write-to-tables.ts` - Writes a POSTed import or status change into the normalized tables, transactionally.
- `lib/validate-shared-state.ts` - Everything that decides whether a `POST /api/shared-state` payload is safe to write, before the transaction that writes it: shape validation (reusing `lib/domain/keys.ts`'s parsers and `lib/domain/dataset.ts`'s types), a request-size cap, and the catastrophic-deletion guard (refuses a `crmDataset` import that would remove more than 60% of existing mailings without an explicit, server-side-only override). See `docs/data-recovery.md`.
- `lib/build-dataset-from-tables.ts` - Reconstructs the full CRM dataset shape `app.js` expects, by querying the normalized tables directly. The only thing GET reads from now.
- `lib/build-overrides-from-tables.ts` - Reconstructs `componentOverrides` and reviewed-exception keys for GET, since neither has an equivalent field in the dataset shape itself.
- `app/crm/legacy-app.js` - Main application (~2,400 lines, down from ~3,000 before the decomposition - see §9). Owns rendering, spreadsheet parsing, validation, mailing calculations, profiles, envelope HTML generation, QA, packet/bin workflows, and simulators. State, the shared-state HTTP client, localStorage caches, and cross-view selectors moved to `lib/client/` (step 4); the twelve-view sidebar is now static (`app/crm/shell/`) and `renderView()` dispatches through a `VIEW_REGISTRY` map instead of an if-chain (step 5). A real ES module - importable/exportable - but still an untyped vanilla-JS monolith otherwise.
- `app/crm/CrmApp.tsx` - `"use client"` component that calls `legacy-app.js`'s exported `initCrmApp()` from a mount effect (browser-only, guarded against double-invocation). Rendered from `app/page.tsx`; the only thing that ever imports `legacy-app.js`.
- `app/crm/format.ts` - View-only display formatting (`escapeHtml`, `includesText`, `statusClass`, `number`) with no server use, so it stays out of `lib/domain/` deliberately - see that module's header.
- `app/crm/shell/nav-items.ts` - The sidebar's single source of truth: all twelve views' `data-view` id, badge, and label, in display order.
- `app/crm/shell/Sidebar.tsx` - Renders `nav-items.ts`; `app/page.tsx` mounts it in place of hand-written nav markup. `app/crm/legacy-app.js`'s `VIEW_REGISTRY` (in the same file as `renderView()`) is kept in agreement with this list's ids by `tests/nav-items.test.mjs` - no nav button without a renderer, no renderer without a button.
- `public/everletterSeed.json` and `public/seed-data.js` - Sanitized empty fallback dataset, loaded synchronously before the real dataset arrives from `/api/shared-state`. Never replace these with production customer data in Git.
- `public/assets/` - Everletter logo, wax seal, character art, envelope corner art, and sample-letter images.
- `db/schema/` - Drizzle table definitions, one file per entity (`subscribers.ts`, `subscriptions.ts`, `orders.ts`, `mailings.ts`, `mailing_components.ts`, `exceptions.ts`, `ingestion_events.ts`, `staging_locations.ts`), plus `relations.ts` and a barrel `index.ts`. Full design rationale: `docs/schema-design.md`.
- `db/index.ts` - `getDb()`, a real `drizzle-orm/node-postgres` connection backed by `DATABASE_URL`. Throws with a clear message if `DATABASE_URL` is unset — there is no silent fallback.
- `drizzle/` - Generated Postgres migrations (six as of this writing, `0000`-`0005`) and Drizzle metadata.
- `tests/` - The real unit and end-to-end test suite, wired into `pnpm test`. See §6 and `docs/testing.md`.
- `devops/` - Docker Compose files (`docker-compose.yml` for Postgres, `docker-compose.app.yml` for the app service), the app's `Dockerfile`, the NAS deploy script, and backup/maintenance scripts. See §4/§7. Also `restore-ingestion-event.mjs` (`pnpm restore:import`) - restores the normalized tables to a prior `crmDataset` import's exact state; see `docs/data-recovery.md`.

### Current data flow

1. A user uploads the current `.xlsx`, `.xls`, or `.csv` mailing schedule in the Import Sheet view.
2. `app/crm/legacy-app.js` parses and validates it in the browser and builds a structured dataset (subscribers, recipients, subscriptions, orders, mailings, summary, exceptions) via `buildSeedFromSpreadsheet`.
3. Publishing POSTs the complete dataset to `/api/shared-state` as `kind=crmDataset`, `key=current`. The route validates its shape and size (`lib/validate-shared-state.ts`) before opening a transaction, then - still before any write - checks the import against the catastrophic-deletion guard. Inside that same transaction, `lib/write-to-tables.ts`'s `writeImport()` writes it into the normalized tables (all or nothing), and an `ingestion_events` row records what was imported (`docs/data-recovery.md`).
4. Mailing-status, component-status, and reviewed-exception changes each POST their own `kind`/`key`/`value` and are written directly to the relevant table by `lib/write-to-tables.ts`, also transactionally.
5. On GET, the route calls `buildDatasetFromTables()` to reconstruct the same dataset shape `app.js` expects, directly from the normalized tables — nothing cached, nothing denormalized in between — plus `lib/build-overrides-from-tables.ts` for `componentOverrides` and the `reviewed` exception-key list.
6. On load, `app/crm/legacy-app.js` initializes its state synchronously from the empty committed fallback (`window.EVERLETTER_SEED`), then replaces it wholesale with the real reconstructed dataset once `/api/shared-state` resolves. Status/component-status overrides and reviewed-exception flags are additionally cached to `localStorage` as a client-side fallback — the dataset itself is not.

There is no `crm_state` table, blob, or "record kinds" list anymore — it was dropped entirely once the normalized tables became the sole source of truth for both directions. The complete history of that migration (why each table looks the way it does, the dual-write rollout, every schema gap found and either closed or deliberately accepted) is in **[docs/schema-design.md](docs/schema-design.md)** — read it before touching `lib/write-to-tables.ts` or `lib/build-dataset-from-tables.ts` rather than re-deriving any of it here.

### Conventions to preserve

- Never commit customer exports, spreadsheets, email addresses, physical addresses, access tokens, or private Drive IDs.
- Treat stable subscriber/subscription identity separately from Squarespace order numbers. Month-to-month renewals create new order numbers, and one email address can own multiple subscriptions.
- Mailing cadence is the 1st and 15th. A roughly three-day cutoff determines whether a new order can join the imminent batch.
- Month-to-month customers receive two letters per payment and normally need two envelopes printed together. Six- and twelve-month orders receive 12 and 24 letters respectively and are usually prepared in advance.
- Character changes restart the letter number at 1 and should remain a Needs Review event because the envelope/bin workflow changes.
- Preserve stable mailing/component key generation when refactoring; existing overrides depend on those keys (`lib/domain/keys.ts` is the canonical spec).
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
- Code config: the `@import` generated in `app/crm/legacy-app.js` near the envelope print HTML.
- Risk: envelope appearance depends on network access and font loading at print time (see Known Issues).

### Google Drive (manual workflow; not integrated)

- Purpose: stores print-ready letters and customer envelope files organized by character.
- Account: Everletter's Google Workspace/Drive. Marcy should provide the exact owner/login to the next developer; do not use or mix the unrelated Aarcadian Drive.
- Code config: `driveConfig` in `app/crm/legacy-app.js`, but all private folder URLs/IDs were intentionally removed before the GitHub export. Buttons currently alert when no URL is attached.
- Status: no OAuth, Drive API, or service-account integration exists.

### Squarespace (planned; not integrated)

- Purpose: current storefront, subscription checkout, renewals, and sample-request form. Intended future source for automatic paid-order ingestion.
- Site: `https://www.theeverletter.com/`
- Account: Everletter's Squarespace account; credentials are held by Marcy/Ashley and are not in the repo.
- Code config: none. `app/crm/legacy-app.js` contains only a Sync Simulator, automation rules, and explanatory UI.
- Status: no webhook, API token, scheduled sync, or product/service mapping is implemented.

### Mailchimp (planned; not integrated)

- Purpose: intended automated delivery of Kid/Adult sample-letter emails and lead tagging.
- Account: not yet documented/connected; Marcy knows Mailchimp and planned to set it up.
- Code config: none. The Sample Requests view in `app/crm/legacy-app.js` is a mock workflow and preview library only.
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
- Full reference — allowlist format and current entries, how to check the resolved role in server code and in `app/crm/legacy-app.js`, how to add a user, and what's explicitly **not** built yet (no per-feature restrictions exist): see **[docs/auth.md](docs/auth.md)**.
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
pnpm test:unit   # unit tests + golden-HTML render snapshots, no external services needed, runs in parallel
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

- **Resolved (minimal signal, not full sync — deliberately):** the app still uses plain HTTP GET/POST for `/api/shared-state` — there's still no websocket or push mechanism, so one person's changes still don't appear on someone else's already-open tab automatically. What's closed is the actual risk: acting on stale data without realizing it. Every real write (`mailingStatus`/`componentStatus`/`reviewedException`/`crmDataset`, via `audit_events` — see the audit-log entry above) advances a monotonic change marker (`lib/change-marker.ts`, `MAX(id)` over `audit_events`, answered from an index — verified via `EXPLAIN` at realistic scale, not assumed). `lib/client/staleness.ts` compares that marker (polled every 45s via `GET /api/change-marker`, paused when the tab is hidden via `document.visibilityState`, checked immediately on becoming visible again) against the marker this client's own view/own saves are caught up to, and `app/crm/legacy-app.js` renders a dedicated `#stalenessBanner` ("Someone else has changed mailing data since this page loaded. Refresh to see the latest changes.", with a working refresh button) when they diverge. The load-bearing design point: a user's own save advances their own marker immediately (via the POST response), so making a change never makes that same user's own page look stale. Full live-update (websockets/polling-based auto-refresh, merging remote changes into local state) remains explicitly out of scope — Brad's own handoff to Marcy's session, and this minimal version is also what will show whether that's solving a felt problem or a theoretical one.
- **Resolved (server-side foundation only - no UI yet):** re-importing a spreadsheet still overwrites current data (`lib/write-to-tables.ts`'s `writeImport()` still deletes any subscriber/subscription/order/mailing/exception row not present in the new import), but that's no longer unrecoverable. `POST /api/shared-state` now validates every payload's shape (`lib/validate-shared-state.ts`), caps request size, refuses an import that would delete more than 60% of existing mailings without an explicit override, and records every `crmDataset` import in `ingestion_events` inside the same transaction as the write. `devops/restore-ingestion-event.mjs` restores any prior import exactly, by replaying its recorded payload through `writeImport()` - see `docs/data-recovery.md` for the full mechanism, the real per-import size, and the retention question that's flagged but not yet decided. What's still missing on purpose: no user-facing restore flow in the CRM itself, and no confirmation/undo for a routine reimport that's well under the 60% threshold - both explicitly left for Marcy's own session to decide how (or whether) to surface.
- **Resolved (visibility only - no retry queue):** status/component-status saves are still asynchronous and optimistic (`saveSharedState()`, `lib/client/shared-state-client.ts` — local state and localStorage still update immediately either way, deliberately unchanged), but a failed save is no longer silent or indistinguishable from a successful one. `saveSharedState`/`loadSharedState` check `response.ok`, distinguish a network failure from a rejected HTTP response, and report every outcome to `lib/client/save-failures.ts`'s `SaveFailureStore`; `app/crm/legacy-app.js` renders its current state into a dedicated `#saveFailureBanner` element (`app/page.tsx`, outside `#viewMount` so it can't touch the render-snapshot suite), counted rather than enumerated ("12 changes couldn't be saved," not twelve rows), honest about consequence ("reloading this page will lose it"), and never auto-cleared by a later success. What's still missing on purpose: no retry queue (the store's shape is the seam a future one would build on, per its own module comment) and no auto-revert of local state.
- **Two separate sets of bulk-action buttons apply a status change to every currently-shown row with a single click and no confirmation dialog.** Each row fires an independent, fire-and-forget `saveSharedState()` call (`lib/client/shared-state-client.ts`) — no batching, no undo, no confirmation step:
  - Production Queue: `renderQueue()`'s `[data-bulk-status]` buttons and click handler (`app/crm/legacy-app.js`), which loops every shown row through `updateMailingStatus` (`lib/client/crm-state.ts`).
  - Ashley Bins: `renderBins()`'s `[data-bin-mark]` buttons and click handler (`app/crm/legacy-app.js`), which fires three `updateComponentStatus` calls per row (`lib/client/crm-state.ts`).

  A single accidental click — or a click by someone who doesn't realize what the button does — can silently overwrite the status of every currently-shown mailing at once. This already happened with the Production Queue buttons: Marcy confirmed she clicked them believing they were status *filters*, not bulk-rewrite actions — the pill-button styling doesn't visually distinguish them from the filter controls elsewhere in the UI. The Ashley Bins instance has the identical shape and hasn't been reported as misclicked yet, but nothing about it is actually safer. **Handoff, high priority, decision rights with Marcy's own session (not this one):** whether and how to guard these — a confirmation step (e.g. "Set status to X for the N mailings currently shown?"), restyling so they're not visually confusable with the filter controls next to them, or something else entirely — is a product/workflow call about how Marcy and Ashley actually use these buttons day to day, not an engineering gap to close unilaterally. Flagged here as unresolved and important, not assigned as a to-do.
- **A future edit to `spreadsheetExceptionReasons`' reason text could silently change exception severity.** Severity (`lib/domain/spreadsheet/build-seed.ts`) is decided by `reason.includes('Missing') || reason.includes('ship date')` — case-sensitively. `"Ship date is not a 1st/15th batch"` and `"Future mailing already marked mailed"` are Low severity only because of their capital letters; lowercasing either string for readability would silently promote it to High, which pulls its mailings out of Production Queue, Batch Print, and Ashley Bins via `highExceptionMailingIds`. `tests/spreadsheet-exceptions.test.mjs` pins the current behavior (a change here fails those tests first), and the classifier itself now carries a comment explaining the trap.
- Ashley's own Google sign-in specifically hasn't been verified yet (see Decided Direction's risk list, above).
- No per-feature/per-role restrictions exist yet, even though the resolved role is available (`session.role`, and `data-user-role` on the page shell for `app/crm/legacy-app.js`). Pending Marcy specifying what Ashley should be restricted from. See `docs/auth.md`.
- Private Google Drive folder IDs aren't in this repository at all, so Drive buttons remain incomplete everywhere the app now runs — unlike under the old Sites deployment, there's no separately-configured "live" version anymore that could differ from this source; the NAS deploy builds directly from this same git history.
- **Resolved.** The `exceptions` table now has `review_key_subscriber_id`/`review_key_ship_date` columns (`db/schema/exceptions.ts`) snapshotting `exceptionReviewKey`'s (`lib/domain/keys.ts`) remaining two segments, populated on every import (`writeImport()`, `lib/write-to-tables.ts`). `writeReviewedException()` cross-checks all four of `mailingId`/`subscriberId`/`reason`/`shipDate` against stored columns now, not two. See `docs/schema-design.md`'s dual-write notes for the original limitation and its resolution, and `tests/audit-events.e2e.test.mjs` for the tests proving a key differing only in `subscriberId` or `shipDate` is correctly rejected. The subscription-only-fallback case (no `mailing_id`) remains permanently unreachable by a `reviewedException` override, unchanged by this.
- **New: a per-change audit log.** Every `mailingStatus`/`componentStatus`/`reviewedException` write and every `crmDataset` import now records one row in `audit_events` (`db/schema/audit_events.ts`) — `actor_email`, `kind`, `item_key`, `previous_value`, `new_value` — inside the same transaction as the write it accompanies, so a rolled-back change can never leave behind a row claiming it happened. A soft-skipped write (a key matching no row) writes no audit row - only a real change is recorded. `actor_email` is resolved via `auth()` (`auth.ts`) in `app/api/shared-state/route.ts`'s POST handler; a request with no session (structurally impossible for a real request behind `proxy.ts`, but real for a direct test call) records the literal string `"unauthenticated"` rather than null or an empty string, so a reader can't confuse "no session" with "the capture broke." `GET /api/audit` (newest-first, bounded `limit`, `before`-cursor paging) is the read side - authenticated the ordinary way via `proxy.ts`'s matcher, not exempted. This closes the "no general audit log" gap §9 used to list; see `docs/data-recovery.md` for the measured row size and growth projection (small and slow-growing, unlike `ingestion_events`) and the same "flagged, not solved" retention treatment.

Integrations not built:

- Squarespace order/renewal/cancellation/failed-payment sync
- Identity matching for one email with multiple subscriptions beyond current import heuristics
- Mailchimp sample-request automation and conversion tracking
- Google Drive API lookup/attachment/printing
- Gmail automation
- Revenue/lifetime-value and per-character fulfillment cost tracking

Code quality/maintenance:

- `app/crm/legacy-app.js` is still a large monolithic script (~2,400 lines, down from ~3,000 before the app.js decomposition's Phase 0 - see §9) with untyped rendering and direct DOM manipulation. State, HTTP, localStorage caches, and cross-view selectors moved to `lib/domain/`/`lib/client/`; the twelve render functions themselves haven't moved yet - that's Phase 1, next.
- `app/globals.css` is similarly large (~2,400 lines) and should be decomposed carefully.
- `lib/build-dataset-from-tables.ts`'s `buildMailings()` computes `sourceRow: Number(row.lastSourceRow)` on a nullable column, where `Number(null) === 0`. Investigated directly and found not currently reachable (every write path derives `lastSourceRow` from a real number) - not a live bug, but a real latent gap if that ever changes. See the comment at that line for the full trace.
- Some source strings show mojibake such as `Â·`; normalize encoding while preserving intended display.
- Google Fonts load over the network in generated print windows. Printing before fonts finish loading may use fallback fonts.
- Envelope output needs physical-printer QA for feed orientation, scaling at 100%, A7 paper size, margins, and each character's colored stock.
- The browser-side xlsx bundle (`public/xlsx.full.min.js`) is committed/minified and should be tracked to its exact source/version and updated intentionally.
- No automated accessibility, mobile, or print-layout tests exist. Real integration/API-level end-to-end tests now exist (`tests/*.e2e.test.mjs`, see `docs/testing.md`) — browser/UI-level end-to-end tests still don't.
- No monitoring/error reporting service is configured.

Operational caveats:

- The live Postgres data on the NAS will generally be newer/different than the empty committed seed files or any spreadsheet in this repository — same caveat this file made about the old hosted D1 database, just pointed at the current datastore. Don't assume what's in the seed files or a local spreadsheet reflects live state.
- The real app should remain private because it contains names, emails, and mailing addresses.
- Re-importing a spreadsheet can cause old Needs Review flags to return because reviewed flags are tied to generated exception keys.
- The previous "public fake-data demo, separate from production" mentioned in earlier versions of this file could not be re-confirmed against the current tree or infrastructure — if it still exists, get its current status from Brad before relying on this note; it isn't restated here as fact.

## 9. Recent Context and Recommended Next Steps

Most recent completed work, newest first:

- **The "someone else changed something, refresh" staleness signal — CLAUDE.md §8's top item since before this migration started, now closed.** `GET /api/change-marker` (cheap - one indexed `MAX(id)` over `audit_events`) plus a marker field on `GET`/`POST /api/shared-state` feed `lib/client/staleness.ts`, polled every 45s (paused while the tab is hidden, checked immediately on regaining visibility) and rendered by `app/crm/legacy-app.js` into a dedicated `#stalenessBanner`. The audit log from the entry below is what made this cheap - before it, there was no monotonic timestamp anywhere a status change touched. A user's own save advances their own baseline immediately (from the POST response), so making a change never makes that same user's own page look stale, including under a bulk action's out-of-order responses. No SSE/websockets/auto-refresh/remote-state-merging - deliberately the minimal signal, not full sync (Brad's explicit handoff to Marcy's session for whether/how to go further). See §8's updated entry.
- **A per-change audit log, and the `exceptions` reviewedException key-verification gap closed.** `audit_events` (`db/schema/audit_events.ts`) records who changed a mailing/component status or dismissed an exception, and when, plus one row per `crmDataset` import - written inside the same transaction as the change it accompanies (`app/api/shared-state/route.ts`), so a rollback can never leave a false audit row behind, and a soft-skip (key matching no row) never produces one either. `GET /api/audit` is the read side (newest-first, bounded/paged); no UI - that's explicitly Marcy's own screen to build. Same migration also added `exceptions.review_key_subscriber_id`/`review_key_ship_date`, closing the long-documented gap where `reviewedException` matching could only cross-check 2 of `exceptionReviewKey`'s 4 segments - it now checks all 4. See §8's updated entries, `docs/schema-design.md`'s dual-write notes, and `docs/data-recovery.md` for the audit-log row-size/growth measurement.
- **Failed shared-state saves and loads became visible instead of silent.** `saveSharedState`/`loadSharedState` (`lib/client/shared-state-client.ts`) now check `response.ok` and report every outcome - network failure, HTTP rejection, or success - to a new `lib/client/save-failures.ts` store, rendered by `app/crm/legacy-app.js` into a dedicated, snapshot-safe `#saveFailureBanner` element. See §8's updated entry.
- **`POST /api/shared-state` safety work — done after Phase 0 finished and before Phase 1 (below) began.** This was the largest data-integrity gap left in the system: nothing validated a payload's shape or size before `writeImport()`'s destructive delete-what's-missing write, and a bad import had no way back except the nightly backup. Closed: shape/size validation (`lib/validate-shared-state.ts`), a 409 refusal for any import that would delete more than 60% of existing mailings (server-side-only override, no UI), and every `crmDataset` import recorded in `ingestion_events` with a proven restore path (`devops/restore-ingestion-event.mjs`, `docs/data-recovery.md`). See §8's updated entry and `docs/data-recovery.md` for the retention question this surfaced but didn't resolve. Deliberately sequenced before Phase 1 starts (item 1 below) rather than after — a data-integrity gap this size outranked starting the view migrations.
- **The app.js decomposition, Phase 0 (extraction), is complete** — five steps: a golden-HTML snapshot harness covering all twelve views, the safety net every later step verifies output against (`tests/render-snapshots.test.mjs`); the app.js → ESM move (`public/app.js` → `app/crm/legacy-app.js`, a real ES module, mounted via `app/crm/CrmApp.tsx`); id/key/mailing-rule unification plus the full pure-business-logic extraction into `lib/domain/`; the state store, shared-state HTTP client, localStorage caches, and cross-view selectors extracted into `lib/client/`; and static nav declaration (`app/crm/shell/`) plus a `VIEW_REGISTRY` dispatch map replacing `renderView()`'s if-chain. `app/crm/legacy-app.js` went from ~2,936 lines to ~2,384 across the whole phase. See §3's directory list for what actually lives where now.
- Dead code and stale documentation left behind by that phase were cleaned up in one pass: removed `examples/d1/`, fixed `devops/clear_db.sh` (it truncated a table dropped mid-migration), dropped `.gitignore`/`.dockerignore` entries for removed Cloudflare tooling, and brought this file's directory list, code citations, and Known Issues back in line with the current tree.
- The full normalized-schema migration: designed (`docs/schema-design.md`), dual-written alongside the old blob, validated, promoted to the live read/write path, and the old `crm_state` table dropped entirely. Self-hosted Postgres on the NAS replaced Cloudflare D1.
- Cloudflare Workers, Vinext, Vite, Wrangler, and OpenAI Sites were removed from the tree; hosting moved to self-hosted Docker Compose on the NAS.
- CI/CD stood up: GitHub Actions builds and pushes a GHCR image and deploys it to the NAS automatically on every merge to `main`.
- The Docker Compose setup was split into a Postgres-only base file and an app-service file, fixing a real bug where a fresh clone's Postgres-only startup failed on the app service's unrelated auth-var requirements.
- The stale starter test suite was replaced with a real one (`pnpm test` now runs actual unit and end-to-end tests and is a real release gate), and leftover starter artifacts (`app/_sites-preview/`, `react-loading-skeleton`, `tests/rendered-html.test.mjs`) were removed.
- Local Postgres backups (rotating) plus offsite Backblaze B2 backups were set up on the NAS, running daily.
- Google OAuth plus the `ALLOWED_USERS` allowlist went from structurally-complete-but-untested to a live-verified sign-in.

Logical next steps, roughly in order:

1. **Begin Phase 1 of the app.js decomposition: the twelve per-view migration branches.** Move each render function out of `app/crm/legacy-app.js` into a typed React component, one at a time, keeping mailing-day behavior stable throughout - not a scheduled rewrite. Step 6 is next: the Automation view, paired with building the `CrmApp.tsx` React-hosting seam the plan deliberately deferred out of step 5 (see that step's PR) until it had one real, tiny consumer to design against instead of zero.
2. **Confirm Ashley's own sign-in** against the real deployment — the one remaining piece of the auth rollout.
3. **Decide what to do about the bulk-action buttons** (Production Queue and Ashley Bins, both described in §8) — high priority (one has already caused a real misclick), but the decision is Marcy's own session's to make, not this one's to implement unilaterally.
4. **Decide whether the staleness signal (§8) is enough, or whether real live-update (websockets/polling-based auto-refresh, merging remote changes into local state) is worth building** — explicitly Brad's handoff to Marcy's session; the minimal version is also the thing that will show whether that's solving a felt problem.
5. **Decide `ingestion_events`/`audit_events` retention** (`docs/data-recovery.md` has recommendations for both - 90-day full-payload retention for `ingestion_events`, keep-forever for the much smaller `audit_events` - but no decision or implementation for either yet).
6. **Build native manual entry/editing** so spreadsheet upload can eventually be retired as the system of record.
7. **Move private Drive folder configuration server-side**, and connect the Drive integration for real.
8. **Connect Squarespace**: idempotent ingestion, raw-payload preservation, subscription identity independent of order numbers, multiple subscriptions per email, mailing schedules created only after successful payment.
9. **Add Mailchimp sample automation**: capture requests, tag Kid/Adult, send samples, record consent/source/time, match later purchases.
10. **Add observability and operational safeguards**: monitoring/error reporting, a retry queue for failed saves (the store `lib/client/save-failures.ts` added is the seam one would build on - see its module comment), and a verified restore drill against the now-real backups.
11. **Decompose `app/globals.css`** into smaller, workflow-scoped stylesheets as each view it styles gets migrated in Phase 1 - not a separate up-front project.

Do not begin by rewriting the UI. The working operational rules encoded in `app/crm/legacy-app.js` are valuable and are already covered by the real test suite (`docs/testing.md`) at the level that suite tests. Migrate one workflow at a time into typed modules while keeping mailing-day behavior stable.
