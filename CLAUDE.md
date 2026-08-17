# Everletter Ops CRM - Developer Handoff

## Decided Direction / Migration Plan

**Target end state:** a well-designed, stable foundation — architecture and data layer — solid enough that Marcy can hand feature work to her own Codex session without either of them needing to make major infrastructure changes first. Marcy is not a software engineer; Brad (this repo's engineer) is. Judge every refactor/infrastructure change against that bar: does it make the foundation something a non-engineer-led session can safely build features on top of, or does it just move the problem around. Apply real software design principles as code is touched — DRY, KISS, modularity, reusable and independently testable components — not as a blanket rewrite mandate, but whenever a change already has code open and the duplication/coupling in front of it is real, not speculative.

**All current app data is disposable test data.** Nothing needs to be preserved, backed up, or migrated carefully during this build-out — it can be deleted and reimported freely. The uploaded spreadsheet remains the actual source of truth for testing/validation, not whatever currently happens to be in the database. (This assumption stops being true once real customer data is live again — don't carry it forward past that point without checking.)

**Workflow: two Claude sessions, two roles.** This is how this repo's migration was actually built, not a proposal — every section below describes work done under this workflow. Code changes went through a separate execution session/environment ("VM Claude") that received a precisely-scoped task prompt and did the actual implementation — wrote the code, ran tests, opened the PR. A local/orchestrating Claude session (working alongside Brad) was where the design decisions actually got made: discussing direction, reviewing what VM Claude produced, and drafting the next task prompt — not making direct code edits to the repo itself. If you are the local/orchestrating session: don't implement here, draft the prompt. If you are VM Claude executing a task prompt: that prompt is your scope — implement it for real, verify it for real, and report back plainly what you did and didn't get to (see this migration's existing task prompts and PR descriptions for the expected level of detail, and be honest about gaps — e.g. flag when live/interactive verification isn't possible in your environment rather than skipping it silently).

**Marcy's own Codex session is the intended next owner of this repo.** The foundation this workflow built exists specifically so feature work (§9) can be handed to a session that isn't engineer-led without either party needing to make major infrastructure changes first (see the target end state, above). Nothing about the two-role split above is mandatory for whatever comes next — it's context for how the codebase got to its current shape, and a pattern worth keeping if it's still useful, not a process Marcy's own session is obligated to continue.

The migration described below is **done**, not aspirational — both the infrastructure migration and the application-code decomposition it deferred. Sections 1-9 describe the app as it actually runs today — not the original OpenAI Codex/Sites build, and not the vanilla-JS-monolith-plus-React-shell shape this app ran in for most of its life either. A short history note follows this section for context on why the tree looked different for a long stretch of this migration, even though nothing below describes that shape as live anymore.

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

**The application code itself: also migrated, also done.** For most of this project's life, `app/crm/legacy-app.js` was a large, untyped vanilla-JS monolith wrapped by a server-rendered React shell — real product logic (state, views, validation, envelope generation), battle-tested with real operational use, but not typed React components. The plan was always to migrate it incrementally rather than rewrite it up front, and that plan succeeded: all twelve sidebar views are now typed React components under `app/crm/views/`, the shared chrome around them lives in `app/crm/shell/`, and `app/crm/legacy-app.js` itself no longer exists in this repository. See `docs/architecture.md` for the current shape and §9 for how the migration got there.

**CI/CD:** exists and is load-bearing — GitHub Actions builds and pushes a Docker image on every push to `main`, then deploys it to the NAS automatically. This is a real, current fact, not a future decision: **a merge to `main` is a production deploy.** See §7 for the exact flow, and `.github/workflows/build-and-push.yml` for the source of truth.

**History, for context — not a live description:** this app was originally built via OpenAI's Codex/Sites tooling, which is why it ran for a long time as one large vanilla-JS file wrapped by a server-rendered React shell rather than typed React components throughout — that build path favored exactly that shape. The Codex/Sites-specific tooling itself — Cloudflare Workers, Vinext, D1, the `.openai/` config, `worker/`, `vite.config.ts` — was fully removed from the tree early in this migration (commit `feb8bf8` and the Postgres migration described in `docs/schema-design.md`); the vanilla-JS monolith it left behind was migrated to React incrementally afterward, over twelve separate view-migration branches, and then deleted once nothing legacy-rendered was left in it. Nothing below describes either the Codex/Sites tooling or the monolith as live; where either is mentioned again, it's explicitly historical.

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
- TypeScript `5.9.3` throughout — the application shell, every CRM view and its selectors, the API routes, the database schema/access layer, and every `lib/` module. No untyped application JavaScript remains.
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

## 3. Architecture

**The full map — layer boundaries, the import-direction rule, how a view works, and how to add one — is [docs/architecture.md](docs/architecture.md).** Read it before touching `app/crm/views/` or `app/crm/shell/`; this section stays a short orientation, not a second copy of that map.

### Major directories

- `app/` - App Router UI shell, global CSS, auth helper, and API routes.
- `app/api/shared-state/route.ts` - GET/POST API for the CRM dataset and shared overrides. GET reconstructs the dataset shape from the normalized tables (`lib/build-dataset-from-tables.ts` + `lib/build-overrides-from-tables.ts`); POST dispatches through `lib/write-to-tables.ts` inside one Postgres transaction. See "Current data flow" below and `docs/schema-design.md` — don't restate that doc's history here, it stays current on its own.
- `app/api/change-marker/route.ts`, `app/api/audit/route.ts`, `app/api/health/route.ts` - the staleness-marker poll target (§8), the audit-log read side (§8), and the unauthenticated deploy healthcheck (§7), respectively.
- `app/page.tsx` - Static CRM shell: renders `<Sidebar />` (`app/crm/shell/`), the topbar/metric/filter markup, and `<CrmApp />` (mounts every view - see `docs/architecture.md`).
- `app/layout.tsx` - Root HTML layout and metadata.
- `app/globals.css` - All CRM, responsive, mobile, and print-related styling (~2,400 lines — see Known Issues; still undecomposed).
- `app/access-denied/page.tsx` - Plain page shown to authenticated users whose email isn't on the `ALLOWED_USERS` allowlist.
- `app/api/auth/[...nextauth]/route.ts` - Auth.js's catch-all route (sign-in, callback, sign-out, session, etc.), re-exporting `handlers` from `auth.ts`.
- `auth.ts` (repo root) - Auth.js config: Google provider, jwt/session callbacks that attach the resolved role (or `null`) to the session via `lib/allowlist.ts`.
- `proxy.ts` (repo root) - Route protection for the whole app (Next 16 renamed `middleware.ts` to `proxy.ts`; see the Authentication section under §4, and §8 for a real gap in its matcher).
- `lib/allowlist.ts` - Parses `ALLOWED_USERS` (`email:role` pairs) and resolves a role for a given email. Pure/testable; see `docs/auth.md`.
- `app/crm/CrmApp.tsx` - The seam that hosts every CRM view; `app/crm/views/` (one folder per sidebar tab) and `app/crm/shell/` (six modules: nav, view registry, Drive links, banners, shared state, shell rendering/boot) are described in full in `docs/architecture.md`, not repeated here.
- `app/crm/format.ts` - View-only display formatting (`escapeHtml`, `includesText`, `statusClass`, `number`) with no server use, so it stays out of `lib/domain/` deliberately - see that module's header.
- `public/everletterSeed.json` and `public/seed-data.js` - Sanitized empty fallback dataset, loaded synchronously before the real dataset arrives from `/api/shared-state`. Never replace these with production customer data in Git.
- `public/assets/` - Everletter logo, wax seal, character art, envelope corner art, and sample-letter images.
- `db/schema/` - Drizzle table definitions, one file per entity (`subscribers.ts`, `subscriptions.ts`, `orders.ts`, `mailings.ts`, `mailing_components.ts`, `exceptions.ts`, `ingestion_events.ts`, `audit_events.ts`, `staging_locations.ts`), plus `relations.ts` and a barrel `index.ts`. Full design rationale: `docs/schema-design.md`.
- `db/index.ts` - `getDb()`, a real `drizzle-orm/node-postgres` connection backed by `DATABASE_URL`. Throws with a clear message if `DATABASE_URL` is unset — there is no silent fallback.
- `drizzle/` - Generated Postgres migrations (`0000` onward) and Drizzle metadata.
- `tests/` - The real unit and end-to-end test suite, wired into `pnpm test`. See §6, `docs/testing.md`, and `docs/architecture.md`'s own testing section.
- `devops/` - Docker Compose files (`docker-compose.yml` for Postgres, `docker-compose.app.yml` for the app service), the app's `Dockerfile`, the NAS deploy script, and backup/maintenance scripts. See §4/§7 — and §7's own note that `devops/deploy.sh` does **not** run database migrations. Also `restore-ingestion-event.mjs` (`pnpm restore:import`) - restores the normalized tables to a prior `crmDataset` import's exact state; see `docs/data-recovery.md`.

**`lib/domain/`** - pure business rules with no DOM/state/window/localStorage/clock dependency, imported directly by both the browser bundle and server code (see `docs/architecture.md` for the import-direction rule this depends on):

- `lib/domain/ids.ts` - Deterministic, hashed ID generation for subscribers/recipients/subscriptions/mailings.
- `lib/domain/keys.ts` - `mailingKey`/`componentKey`/`exceptionReviewKey` generation and parsing. Existing overrides depend on these staying stable across refactors.
- `lib/domain/mailing-rules.ts` - Cadence/status rules (open status, overdue, due-within-14-days, nearest batch date) and `MAILING_STATUSES`, the canonical status-order list.
- `lib/domain/plans.ts` - Plan normalization and everything derived from a plan (letter count, print mode, envelope quantity).
- `lib/domain/characters.ts` - Character normalization, Drive-config lookup keys, and envelope stock selection.
- `lib/domain/batch-dates.ts` - Per-order batch date generation and Ashley-bin storage labeling.
- `lib/domain/dataset.ts` - The canonical `Dataset`/`DatasetSubscriber`/`DatasetRecipient`/`DatasetOrder`/`DatasetSubscription`/`DatasetMailing`/`DatasetException`/`DatasetSummary` interfaces - the one shape both `buildSeedFromSpreadsheet` (client) and `buildDatasetFromTables` (server) produce.
- `lib/domain/format.ts` - `formatDate`/`titleCase`, used by domain logic (`batch-dates.ts`, `characters.ts`) as well as views.
- `lib/domain/component-fields.ts` - The seven mailing-component fields and their valid status values, for server-side validation - kept in sync with `app/crm/views/qa/qa-selectors.ts`'s `QA_FIELDS` by a dedicated parity test, not merged into one module (see that file's own header).
- `lib/domain/spreadsheet/` - `normalize.ts` (per-cell normalizers), `build-seed.ts` (`buildSeedFromSpreadsheet`, the full client-side seed builder), `exceptions.ts` (`spreadsheetExceptionReasons`).

**`lib/client/`** - browser-only services and derivations (no DOM dependency) that the shell and every view compose into their own rendering; may import `lib/domain/`:

- `lib/client/crm-state.ts` - `createCrmState()`, a factory (deliberately not a module-level singleton - see its header) producing the CRM's client-side state plus its write-through mutators, `updateMailingStatus`/`updateComponentStatus`/`updateEnvelopeStatus`.
- `lib/client/local-overrides.ts` - localStorage load/save for the three override caches (`everletterStatusOverrides`, `everletterComponentOverrides`, `everletterReviewedExceptions`).
- `lib/client/shared-state-client.ts` - `saveSharedState`/`loadSharedState`/`saveSharedDataset`, the `/api/shared-state` HTTP client.
- `lib/client/selectors.ts` - Pure cross-view selectors (`effectiveMailing(s)`, `activeExceptions`, `componentStatus`, the batch-date family, subscriber/recipient lookups) taking their inputs explicitly rather than reading a global - the same shape every view and its own `*-selectors.ts` file uses. See `docs/architecture.md` for exactly when a derivation belongs here versus beside its own view.

**Server-side `lib/`** (may import `lib/domain/`, never `lib/client/` or `app/`):

- `lib/write-to-tables.ts` - Writes a POSTed import or status change into the normalized tables, transactionally.
- `lib/validate-shared-state.ts` - Everything that decides whether a `POST /api/shared-state` payload is safe to write, before the transaction that writes it: shape validation (reusing `lib/domain/keys.ts`'s parsers and `lib/domain/dataset.ts`'s types), a request-size cap, and the catastrophic-deletion guard (refuses a `crmDataset` import that would remove more than 60% of existing mailings without an explicit, server-side-only override). See `docs/data-recovery.md`.
- `lib/build-dataset-from-tables.ts` - Reconstructs the full CRM dataset shape the client expects, by querying the normalized tables directly. The only thing GET reads from now.
- `lib/build-overrides-from-tables.ts` - Reconstructs `componentOverrides` and reviewed-exception keys for GET, since neither has an equivalent field in the dataset shape itself.
- `lib/change-marker.ts` - The single indexed `MAX(id)` query over `audit_events` behind the staleness signal (§8).
- `lib/build-info.ts` - Reads the build-identity env vars Next inlines at build time (§7).

### Current data flow

1. A user uploads the current `.xlsx`, `.xls`, or `.csv` mailing schedule in the Import Sheet view.
2. `app/crm/views/import/import-selectors.ts`'s `readWorkbookFile()` parses and validates it in the browser and builds a structured dataset (subscribers, recipients, subscriptions, orders, mailings, summary, exceptions) via `buildSeedFromSpreadsheet`.
3. Publishing POSTs the complete dataset to `/api/shared-state` as `kind=crmDataset`, `key=current`. The route validates its shape and size (`lib/validate-shared-state.ts`) before opening a transaction, then - still before any write - checks the import against the catastrophic-deletion guard. Inside that same transaction, `lib/write-to-tables.ts`'s `writeImport()` writes it into the normalized tables (all or nothing), and an `ingestion_events` row records what was imported (`docs/data-recovery.md`).
4. Mailing-status, component-status, and reviewed-exception changes each POST their own `kind`/`key`/`value` and are written directly to the relevant table by `lib/write-to-tables.ts`, also transactionally.
5. On GET, the route calls `buildDatasetFromTables()` to reconstruct the same dataset shape the client expects, directly from the normalized tables — nothing cached, nothing denormalized in between — plus `lib/build-overrides-from-tables.ts` for `componentOverrides` and the `reviewed` exception-key list.
6. On load, `app/crm/shell/init-crm-app.ts` initializes CRM state synchronously from the empty committed fallback (`window.EVERLETTER_SEED`), then replaces it wholesale with the real reconstructed dataset once `/api/shared-state` resolves. Status/component-status overrides and reviewed-exception flags are additionally cached to `localStorage` as a client-side fallback — the dataset itself is not.

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
- Code config: the `@import` generated in `app/crm/views/envelope-print/envelope-html.ts`, near the envelope print HTML.
- Risk: envelope appearance depends on network access and font loading at print time (see Known Issues).

### Google Drive (manual workflow; not integrated)

- Purpose: stores print-ready letters and customer envelope files organized by character.
- Account: Everletter's Google Workspace/Drive. Marcy should provide the exact owner/login to the next developer; do not use or mix the unrelated Aarcadian Drive.
- Code config: `driveConfig` in `app/crm/shell/drive-links.ts`, but all private folder URLs/IDs were intentionally removed before the GitHub export. Buttons currently alert when no URL is attached.
- Status: no OAuth, Drive API, or service-account integration exists.

### Squarespace (planned; not integrated)

- Purpose: current storefront, subscription checkout, renewals, and sample-request form. Intended future source for automatic paid-order ingestion.
- Site: `https://www.theeverletter.com/`
- Account: Everletter's Squarespace account; credentials are held by Marcy/Ashley and are not in the repo.
- Code config: none. `app/crm/views/sync/Sync.tsx` and `app/crm/views/Automation.tsx` contain only a Sync Simulator, automation rules, and explanatory UI.
- Status: no webhook, API token, scheduled sync, or product/service mapping is implemented.

### Mailchimp (planned; not integrated)

- Purpose: intended automated delivery of Kid/Adult sample-letter emails and lead tagging.
- Account: not yet documented/connected; Marcy knows Mailchimp and planned to set it up.
- Code config: none. `app/crm/views/samples/Samples.tsx` (the Sample Requests view) is a mock workflow and preview library only.
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
- Full reference — allowlist format and current entries, how to check the resolved role client-side, how to add a user, and what's explicitly **not** built yet (no per-feature restrictions exist): see **[docs/auth.md](docs/auth.md)**.
- Status: **live and verified**, not merely structurally complete. Real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are wired up, and a live sign-in has been verified working end-to-end for multiple allowlisted accounts, including Ashley's own.
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
pnpm test:e2e    # end-to-end files (see package.json), need local Postgres, deliberately serialized
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
2. GitHub Actions' `build-and-push` job computes a build identity (a UTC timestamp formatted at build time, plus the short commit SHA) and builds the app image from `devops/app.Dockerfile` with those passed as build args, pushing it to GHCR as `ghcr.io/marcy-ever/everletter-ops-crm:latest` and `:<commit-sha>`.
3. The `deploy` job — gated on the push event specifically, so a manual `workflow_dispatch` build-only run can never trigger it — SSHes into the NAS using the `FT_SSH_*` repository secrets and runs `~/lyra/everletter-ops-crm/devops/deploy.sh`.
4. `devops/deploy.sh`: copies itself to a stable temp path and re-execs from there first (so the `git reset --hard` two steps later, which replaces the very script file bash is executing, can't make bash jump to a corrupted byte offset mid-run — verified in isolation, not on the NAS itself); fetches; checks whether either compose file changed since the last deploy; `git reset --hard origin/main`s the NAS checkout; then either does a full `down`/`pull`/`up` (compose files changed) or just pulls and recreates the `app` service (otherwise); waits for the `app` container's Docker healthcheck (`app/api/health/route.ts`) to report healthy before logging success, and then logs the running build's own identity (fetched from that same endpoint) into `devops/deploy.txt` — so that file records not just that a deploy happened, but which one.

**Build identity, so a deploy can be verified by eye:** `lib/build-info.ts` reads `NEXT_PUBLIC_BUILD_TIME`/`NEXT_PUBLIC_BUILD_SHA`, both inlined by Next's build step at build time (never read at runtime — a rebuilt image ignores a conflicting runtime env override, verified directly). Shown in `app/page.tsx`'s sidebar footer (`2026-08-16 18:32 UTC · a1b2c3d`) and returned by `GET /api/health` (`buildTime`/`commitSha`, on both the healthy and unhealthy response — the version matters most exactly when health check is failing). `pnpm dev` shows `dev`; a locally built container with no build args (e.g. `pnpm docker:up:full`) shows `local build` — never a fabricated value. Tradeoff worth restating here: `/api/health` is unauthenticated by necessity (a container healthcheck can't hold a session cookie), so this does publish a short commit SHA to anyone who can reach the port — negligible on a private NAS app, but a real exposure decision Brad should get to revisit, not one made silently.

Rollback: no automated rollback exists. The previous image tag (`:<commit-sha>`) stays in GHCR, so a manual rollback means SSHing in and re-pointing the compose invocation at an older tag by hand — not scripted.

**`devops/deploy.sh` never runs database migrations, and nothing enforces or reminds that it doesn't.** Read step 4 above again: fetch, `git reset --hard`, then either a full compose `down`/`pull`/`up` or just `pull`/`up` for the `app` service — at no point does it run `pnpm db:migrate` or the equivalent `drizzle-kit migrate` against the NAS's Postgres. Any PR that adds a `db/schema/` change and a corresponding `drizzle/` migration will deploy the new application code automatically on merge, but the database itself stays on the old schema until someone SSHes into the NAS and runs the migration by hand. This is currently undocumented anywhere else and is the most likely way a future deploy breaks - flag it explicitly whenever a PR touches `db/schema/`, and don't assume a green CI run means the schema is current on the NAS.

Backups: see **[docs/backups.md](docs/backups.md)** for the real, current Postgres backup setup (local rotation plus offsite Backblaze B2) — this file no longer describes an unprotected dataset. No restore drill has ever been run against these backups - see §8.

## 8. Known Issues & Unfinished Work

### Decisions for Marcy, not engineering gaps to close unilaterally

These are real, working systems with a deliberate stopping point — the remaining piece is a product/workflow judgment call only Marcy (and Ashley, day to day) can make, not something a future engineering session should decide on its own. Implement whatever gets decided once it's decided; don't guess at it first.

- **The bulk-action buttons need a decision about whether and how to guard them.** Two separate sets apply a status change to every currently-shown row with a single click and no confirmation dialog. Each row fires an independent, fire-and-forget `saveSharedState()` call (`lib/client/shared-state-client.ts`) — no batching, no undo, no confirmation step:
  - Production Queue: `Queue.tsx`'s `onBulkStatus` prop and `[data-bulk-status]` buttons, wired in `app/crm/CrmApp.tsx`'s `queue` view, which loop every shown row through `updateMailingStatus` (`lib/client/crm-state.ts`).
  - Ashley Bins: `Bins.tsx`'s `onBulkMark` prop and `[data-bin-mark]` buttons, wired in `app/crm/CrmApp.tsx`'s `bins` view, which fire three `updateComponentStatus` calls per row (`lib/client/crm-state.ts`).

  A single accidental click — or a click by someone who doesn't realize what the button does — silently overwrites the status of every currently-shown mailing at once. This has already happened once: Marcy clicked the Production Queue buttons believing they were status *filters*, not bulk-rewrite actions, because the pill-button styling doesn't visually distinguish them from the filter controls elsewhere in the UI. The Ashley Bins instance has the identical shape and hasn't been reported as misclicked yet, but nothing about it is actually safer. Whether to add a confirmation step (e.g. "Set status to X for the N mailings currently shown?"), restyle so the buttons aren't visually confusable with the filter controls next to them, or something else entirely, is a call about how Marcy and Ashley actually use these buttons day to day — high priority given the one real misclick already on record, but the decision is Marcy's to make.
- **Whether the staleness banner is enough, or real live-update is worth building.** The app polls for and displays a "someone else changed something, refresh" banner (see the staleness entry below) but has no SSE/websocket push, no auto-refresh, and no merging of remote changes into local state — a deliberate minimal version, not a first step already underway. Whether that's solving the real problem, or whether live-update is worth the real complexity it would add, is worth deciding once the minimal version has been used for a while and it's clear whether it's solving a felt problem or a theoretical one.
- **An audit-log UI.** The data, the writes, and the read endpoint all exist and are real: every `mailingStatus`/`componentStatus`/`reviewedException` write and every `crmDataset` import records a row in `audit_events` (see below), and `GET /api/audit` returns them newest-first with cursor paging. No screen in the CRM shows this to anyone. Building that screen — what it should show, who should see it, how far back — is Marcy's to design.
- **`ingestion_events` retention is undecided.** Every `crmDataset` import's full payload is kept forever right now (`ingestion_events.raw_payload`) - not urgent (Postgres handles the current volume easily for years), but genuinely unbounded. `docs/data-recovery.md` has a specific recommendation (null out `raw_payload` after 90 days, keep the summary rows forever) but no decision has been made and nothing is implemented. Same open question applies to `audit_events`, with a "keep forever" recommendation in the same doc (it's much smaller and grows more slowly).

### Real, known, unfixed

- **Subscribers' Mark-Printed/Mark-At-Ashley actions never call `render()`, so the shell's metric cards and status strip can go visibly stale after using them, until something else triggers a full render.** `app/crm/CrmApp.tsx`'s `subscribers` view's `onMarkPrinted`/`onMarkAshley` callbacks write `state.componentOverrides`/`state.statusOverrides` (via `updateEnvelopeStatus`/`updateMailingStatus`) but call `notifyViewChanged()` alone, even though the status strip's own breakdown reads exactly those fields (Production Queue's own status-select and bulk-status actions, doing the equivalent write, correctly call `render()`). This is not an oversight in the migration — it's the removed legacy handler's own real behavior, deliberately reproduced rather than "fixed" during this view's migration to React (Phase 1), since "no behavior change" means matching what the code actually did, not what a general rule would predict it should do. See `docs/architecture.md`'s "Two behavioral rules" section for the render()-vs-notifyViewChanged() rule this is the one real exception to.
- **`proxy.ts`'s static-asset exclusion is broader than its own stated purpose.** The auth matcher excludes any path ending in `.svg`/`.png`/`.js`/`.css`/`.json`/etc. so files under `public/` don't need a session cookie to load — but it matches by URL suffix, not by "is this actually under `public/`." Next's file-based routing allows a folder literally named e.g. `export.json`, which would produce a real route at `/api/export.json` that this same rule would let through unauthenticated. Nothing in this codebase currently has a route whose path ends that way, so nothing is exploitable today - but any future API route should be checked against this before assuming `proxy.ts` protects it. See `proxy.ts`'s own comment on its `matcher`.
- **`devops/deploy.sh` never runs database migrations.** See §7 - this is new since the last documentation pass and is the most likely way a future deploy breaks.
- **`pnpm lint`'s baseline count drifts upward as more `<img>` tags move into JSX** (`@next/next/no-img-element` — invisible to this rule when the same markup lived inside a template-literal string, visible the moment it becomes real JSX). Currently 48 problems (1 pre-existing, unrelated error in `app/access-denied/page.tsx`; 47 warnings, the bulk of them pre-existing noise inside the vendored `public/xlsx.full.min.js` bundle). A future PR reporting a lint count slightly above 48 because it JSX-ified another `<img>` is not a regression to chase down — check what changed before assuming it's new sloppiness.
- **A future edit to `spreadsheetExceptionReasons`' reason text could silently change exception severity.** Severity (`lib/domain/spreadsheet/build-seed.ts`) is decided by `reason.includes('Missing') || reason.includes('ship date')` — case-sensitively. `"Ship date is not a 1st/15th batch"` and `"Future mailing already marked mailed"` are Low severity only because of their capital letters; lowercasing either string for readability would silently promote it to High, which pulls its mailings out of Production Queue, Batch Print, and Ashley Bins via `highExceptionMailingIds`. `tests/spreadsheet-exceptions.test.mjs` pins the current behavior (a change here fails those tests first), and the classifier itself carries a comment explaining the trap.
- **`lib/build-dataset-from-tables.ts`'s `buildMailings()` computes `sourceRow: Number(row.lastSourceRow)` on a nullable column, where `Number(null) === 0`.** Investigated directly and found not currently reachable (every write path derives `lastSourceRow` from a real number) - not a live bug, but a real latent gap if that ever changes. See the comment at that line for the full trace.
- **No restore drill has ever been run against the Backblaze B2 backups.** The backup mechanism itself is real and runs daily (`docs/backups.md`), but nobody has verified end to end that a restore from it actually works. Worth doing before this matters for real customer data.
- Some source strings show mojibake such as `Â·`; normalize encoding while preserving intended display.
- Google Fonts load over the network in generated print windows. Printing before fonts finish loading may use fallback fonts.
- Envelope output needs physical-printer QA for feed orientation, scaling at 100%, A7 paper size, margins, and each character's colored stock.
- **`public/xlsx.full.min.js` is a committed, minified browser bundle loaded via a plain `<Script>` tag - and could likely be retired now.** It predates the app being fully bundled by Next's own toolchain; the `xlsx` npm package (already a real dependency, used elsewhere) could probably be imported directly into `app/crm/views/import/import-selectors.ts` instead of reading `window.XLSX` off a separately-loaded global. Not verified end to end, and not done here - a real simplification worth trying, not a confirmed fix.
- No automated accessibility, mobile, or print-layout tests exist. Real integration/API-level end-to-end tests exist (`tests/*.e2e.test.mjs`, see `docs/testing.md`) — browser/UI-level end-to-end tests still don't.
- No monitoring/error reporting service is configured.

### What closed, for real (not a to-do, kept for context on why the app behaves the way it does)

- **The "someone else changed something, refresh" staleness signal.** The app still uses plain HTTP GET/POST for `/api/shared-state` — no websocket or push mechanism — but every real write (`mailingStatus`/`componentStatus`/`reviewedException`/`crmDataset`, via `audit_events`) advances a monotonic change marker (`lib/change-marker.ts`, `MAX(id)` over `audit_events`, answered from an index — verified via `EXPLAIN` at realistic scale, not assumed). `lib/client/staleness.ts` compares that marker (polled every 45s via `GET /api/change-marker`, paused when the tab is hidden, checked immediately on becoming visible again) against the marker this client's own view/own saves are caught up to, and `app/crm/shell/init-crm-app.ts` renders a dedicated staleness banner when they diverge. A user's own save advances their own marker immediately (via the POST response), so making a change never makes that same user's own page look stale. Whether this minimal signal is enough, or real live-update is worth building, is one of the decisions above.
- **Re-importing a spreadsheet is no longer unrecoverable.** `writeImport()` (`lib/write-to-tables.ts`) still deletes any subscriber/subscription/order/mailing/exception row not present in the new import, but `POST /api/shared-state` now validates every payload's shape (`lib/validate-shared-state.ts`), caps request size, refuses an import that would delete more than 60% of existing mailings without an explicit override, and records every `crmDataset` import in `ingestion_events`. `devops/restore-ingestion-event.mjs` restores any prior import exactly. See `docs/data-recovery.md`. No user-facing restore flow exists in the CRM itself, and no confirmation/undo for a routine reimport under the 60% threshold - both left for Marcy's own screen to decide how (or whether) to surface, same category as the audit-log UI above.
- **Failed saves and loads are visible instead of silent.** `saveSharedState`/`loadSharedState` (`lib/client/shared-state-client.ts`) check `response.ok`, distinguish a network failure from a rejected HTTP response, and report every outcome to `lib/client/save-failures.ts`'s `SaveFailureStore`; `app/crm/shell/init-crm-app.ts` renders it into a dedicated save-failure banner, counted rather than enumerated ("12 changes couldn't be saved," not twelve rows), honest about consequence ("reloading this page will lose it"), never auto-cleared by a later success. No retry queue exists (the store's own shape is the seam a future one would build on) and no auto-revert of local state - both deliberate, not oversights.
- **The `exceptions` table's `reviewedException` matching checks all four key segments, not two.** `review_key_subscriber_id`/`review_key_ship_date` columns (`db/schema/exceptions.ts`) snapshot `exceptionReviewKey`'s (`lib/domain/keys.ts`) remaining two segments, populated on every import. `writeReviewedException()` cross-checks `mailingId`/`subscriberId`/`reason`/`shipDate` against stored columns. The subscription-only-fallback case (no `mailing_id`) remains permanently unreachable by a `reviewedException` override - a real, accepted limitation, not a bug. See `docs/schema-design.md`'s dual-write notes.
- **A per-change audit log exists.** Every `mailingStatus`/`componentStatus`/`reviewedException` write and every `crmDataset` import records one row in `audit_events` (`db/schema/audit_events.ts`) — `actor_email`, `kind`, `item_key`, `previous_value`, `new_value` — inside the same transaction as the write it accompanies. A soft-skipped write (a key matching no row) writes no audit row. `GET /api/audit` is the read side. The screen that shows this to a human is the audit-log UI decision above.

Integrations not built:

- Squarespace order/renewal/cancellation/failed-payment sync
- Identity matching for one email with multiple subscriptions beyond current import heuristics
- Mailchimp sample-request automation and conversion tracking
- Google Drive API lookup/attachment/printing
- Gmail automation
- Revenue/lifetime-value and per-character fulfillment cost tracking

Code quality/maintenance:

- `app/globals.css` is still large (~2,400 lines) and should be decomposed carefully - the one piece of the original app.js-era monolith that migrating the twelve views to React never touched, since it styles all of them at once.

Operational caveats:

- The live Postgres data on the NAS will generally be newer/different than the empty committed seed files or any spreadsheet in this repository — same caveat this file made about the old hosted D1 database, just pointed at the current datastore. Don't assume what's in the seed files or a local spreadsheet reflects live state.
- The real app should remain private because it contains names, emails, and mailing addresses.
- Re-importing a spreadsheet can cause old Needs Review flags to return because reviewed flags are tied to generated exception keys.
- The previous "public fake-data demo, separate from production" mentioned in earlier versions of this file could not be re-confirmed against the current tree or infrastructure — if it still exists, get its current status from Brad before relying on this note; it isn't restated here as fact.

## 9. Recent Context and Recommended Next Steps

**Phase 0 (data-layer extraction), the pre-Phase-1 safety work, Phase 1 (all twelve views migrated to React), and Phase 2 (the monolith and its test harness deleted, this documentation pass) are all complete.** The app.js decomposition described throughout this file is not a plan anymore — it's what happened. What's actually next is Marcy's own feature work (§8's "Integrations not built," native manual entry, the decisions listed under §8's "Decisions for Marcy"), not more refactoring of the foundation itself. Don't read the rest of this section as a queue of engineering work still to do; it's a record of how the foundation got here, kept because *why* a convention exists is often as useful as *what* it is.

Most recent completed work, newest first:

- **The app.js decomposition's Phase 2: the monolith deleted, this documentation pass.** `app/crm/legacy-app.js` (by then holding only shell/init chrome — every view had already migrated in Phase 1) was deleted entirely, its still-needed pieces relocated into six new `app/crm/shell/` modules (see `docs/architecture.md`). The `vm`/dynamic-import test sandbox built to reach into that monolith was deleted with it, replaced by two small DOM stubs (`tests/shell-test-helpers.mjs`) and a plain factory call (`createAppState()`) for tests that just need fresh, isolated state. This file and the new `docs/architecture.md` were then brought in line with the resulting tree — the pass you're reading the result of now.
- **The app.js decomposition's Phase 1: all twelve sidebar views migrated to typed React components**, one branch at a time, over steps 6 through 17 (Automation first, as the smallest view with nothing to get wrong; Envelope Print last, deliberately, since its output is physical paper and a mistake there is the least reversible). Two behavioral rules had to be discovered and then followed consistently across every step, since neither is visible from any single file in isolation — see `docs/architecture.md`'s "Two behavioral rules" section. Full step-by-step detail lives in this repository's PR history, not repeated here.
- **A build-identity stamp, so a deploy can be verified by eye.** `lib/build-info.ts` reads two env vars Next inlines at build time (`devops/app.Dockerfile`'s build args, set by `.github/workflows/build-and-push.yml`), shown in `app/page.tsx`'s sidebar footer and returned by `GET /api/health` (on both the healthy and unhealthy response), logged by `devops/deploy.sh` after a deploy's health check confirms healthy. Never fabricated: `pnpm dev` shows `dev`, an unstamped local build shows `local build`. See §7's deploy flow.
- **The "someone else changed something, refresh" staleness signal.** `GET /api/change-marker` (cheap - one indexed `MAX(id)` over `audit_events`) plus a marker field on `GET`/`POST /api/shared-state` feed `lib/client/staleness.ts`, polled every 45s (paused while the tab is hidden, checked immediately on regaining visibility) and rendered into a dedicated staleness banner. The audit log from the entry below is what made this cheap - before it, there was no monotonic timestamp anywhere a status change touched. A user's own save advances their own baseline immediately (from the POST response), so making a change never makes that same user's own page look stale, including under a bulk action's out-of-order responses. See §8 for whether this minimal signal is enough - an open decision, not a closed one.
- **A per-change audit log, and the `exceptions` reviewedException key-verification gap closed.** `audit_events` (`db/schema/audit_events.ts`) records who changed a mailing/component status or dismissed an exception, and when, plus one row per `crmDataset` import - written inside the same transaction as the change it accompanies (`app/api/shared-state/route.ts`), so a rollback can never leave a false audit row behind, and a soft-skip (key matching no row) never produces one either. `GET /api/audit` is the read side (newest-first, bounded/paged); no UI - see §8. Same migration also added `exceptions.review_key_subscriber_id`/`review_key_ship_date`, closing the long-documented gap where `reviewedException` matching could only cross-check 2 of `exceptionReviewKey`'s 4 segments - it now checks all 4. See §8's updated entries, `docs/schema-design.md`'s dual-write notes, and `docs/data-recovery.md` for the audit-log row-size/growth measurement.
- **Failed shared-state saves and loads became visible instead of silent.** `saveSharedState`/`loadSharedState` (`lib/client/shared-state-client.ts`) check `response.ok` and report every outcome - network failure, HTTP rejection, or success - to `lib/client/save-failures.ts`'s store, rendered into a dedicated save-failure banner. See §8.
- **`POST /api/shared-state` safety work.** This was the largest data-integrity gap left in the system: nothing validated a payload's shape or size before `writeImport()`'s destructive delete-what's-missing write, and a bad import had no way back except the nightly backup. Closed: shape/size validation (`lib/validate-shared-state.ts`), a 409 refusal for any import that would delete more than 60% of existing mailings (server-side-only override, no UI), and every `crmDataset` import recorded in `ingestion_events` with a proven restore path (`devops/restore-ingestion-event.mjs`, `docs/data-recovery.md`). See §8 for the retention question this surfaced but didn't resolve. Deliberately sequenced before Phase 1 started - a data-integrity gap this size outranked starting the view migrations.
- **The app.js decomposition's Phase 0 (extraction).** Five steps: a golden-HTML snapshot harness covering all twelve views (the safety net Phase 1's per-view migrations later verified their own output against, then superseded one view at a time); the app.js → ESM move; id/key/mailing-rule unification plus the full pure-business-logic extraction into `lib/domain/`; the state store, shared-state HTTP client, localStorage caches, and cross-view selectors extracted into `lib/client/`; and static nav declaration plus a view-registry dispatch map replacing an if-chain.
- Dead code and stale documentation left behind by Phase 0 were cleaned up in one pass: removed `examples/d1/`, fixed `devops/clear_db.sh` (it truncated a table dropped mid-migration), dropped `.gitignore`/`.dockerignore` entries for removed Cloudflare tooling.
- The full normalized-schema migration: designed (`docs/schema-design.md`), dual-written alongside the old blob, validated, promoted to the live read/write path, and the old `crm_state` table dropped entirely. Self-hosted Postgres on the NAS replaced Cloudflare D1.
- Cloudflare Workers, Vinext, Vite, Wrangler, and OpenAI Sites were removed from the tree; hosting moved to self-hosted Docker Compose on the NAS.
- CI/CD stood up: GitHub Actions builds and pushes a GHCR image and deploys it to the NAS automatically on every merge to `main`.
- The Docker Compose setup was split into a Postgres-only base file and an app-service file, fixing a real bug where a fresh clone's Postgres-only startup failed on the app service's unrelated auth-var requirements.
- The stale starter test suite was replaced with a real one (`pnpm test` now runs actual unit and end-to-end tests and is a real release gate), and leftover starter artifacts were removed.
- Local Postgres backups (rotating) plus offsite Backblaze B2 backups were set up on the NAS, running daily.
- Google OAuth plus the `ALLOWED_USERS` allowlist went from structurally-complete-but-untested to a live-verified sign-in for multiple accounts, including Ashley's own.

**What's actually next** is not on this file's own roadmap to prescribe in detail - it's Marcy's to prioritize, with her own Codex session doing the implementation. What exists to hand off:

1. **The decisions listed under §8's "Decisions for Marcy"** - the bulk-action buttons (highest priority, one real misclick already on record), whether the staleness signal is enough or real live-update is worth building, the audit-log UI, and `ingestion_events`/`audit_events` retention. None of these need more foundation work first; all four are ready to decide and build against what already exists.
2. **Native manual entry/editing**, so spreadsheet upload can eventually be retired as the system of record - the largest piece of product work not yet started.
3. **The unbuilt integrations** (§8): Google Drive (move private folder configuration server-side, connect for real), Squarespace (idempotent ingestion, raw-payload preservation, subscription identity independent of order numbers, mailing schedules created only after successful payment), Mailchimp sample automation.
4. **Observability and operational safeguards**: monitoring/error reporting, a retry queue for failed saves (the store `lib/client/save-failures.ts` added is the seam one would build on), and the restore drill against the real backups that's never been run (§8).
5. **`app/globals.css`'s decomposition** (§8) - lower priority than the above; it's a maintainability improvement, not a product feature, and nothing about it blocks anything else on this list.
