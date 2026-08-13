# Everletter Ops CRM - Developer Handoff

## Decided Direction / Migration Plan

The sections below (1-9) describe the app **as built**, which was shaped by the OpenAI Codex/Sites build path rather than chosen on merit. The following direction has since been decided and should guide future work:

**Keep as-is:**

- Next.js, React, TypeScript, Drizzle ORM — all solid and portable. No replacement planned.

**Drop (forced by the Codex/Sites path, not chosen on merit):**

- OpenAI Sites as the deploy platform (proprietary, not portable).
- Cloudflare Workers as the runtime.
- Vinext (`0.0.50`) — too immature/low-version to depend on long-term.

**Replace with:**

- **Hosting:** self-hosted via Docker Compose on the owner's NAS, replacing OpenAI Sites/Cloudflare Workers.
- **Persistence:** self-hosted Postgres via Docker, replacing Cloudflare D1. Drizzle is already dialect-agnostic, so this is a config/driver change, not a rewrite.

**`public/app.js`:** this is a large, untyped vanilla-JS monolith, but it holds the real product logic (state, views, validation, envelope generation) and has been battle-tested with real operational use. Plan to migrate it into typed React components incrementally over time as workflows are touched, not as an immediate up-front rewrite.

**Known risks to prioritize (in rough order):**

1. **App-level auth enforcement is live and verified.** Google OAuth (Auth.js) plus an email allowlist gate every route (see the Authentication section under Infrastructure & Services). Real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are wired up, and a live sign-in has been verified working end-to-end.
2. **No backup/versioning of the dataset.** The whole CRM dataset is a single JSON blob (`crmDataset::current`) that is overwritten on every import, with no history or restore path.
3. **Ashley (co-owner) should now be able to log in.** The credential blocker described in #1 is resolved (live sign-in verified for at least one allowlisted account); Ashley's own sign-in specifically hasn't been tested yet.
4. **Test suite is stale/broken.** `pnpm test` runs starter-template tests unrelated to the CRM; it is not a real release gate right now.

**CI/CD:** GitLab is under consideration for later but not decided yet. No CI/CD system should be assumed or built against until this is settled.

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

Current maturity: **working operational prototype / early production system**. A private hosted version exists and has been used with real imported data. Core spreadsheet import, shared status persistence, filtering, profiles, envelope printing, QA, and bin tracking work. It is not yet a finished system of record: the main customer dataset is still produced from spreadsheet imports, the D1 schema is denormalized, authentication is hosting-controlled rather than app-controlled, and Squarespace/Mailchimp/Drive integrations are not implemented.

Important data boundary: this GitHub repository is intentionally sanitized. It contains no real customer spreadsheet data and no private Google Drive folder IDs. The live customer dataset is stored in the hosted D1 database. The committed seed files are empty fallbacks.

## 2. Tech Stack

Runtime and languages:

- Node.js `>=22.13.0`
- TypeScript `5.9.3` for the application shell, API route, worker, database schema, and build configuration
- JavaScript (browser-native, non-module) for most CRM behavior in `public/app.js`
- CSS in `app/globals.css`
- SQL/SQLite migrations for Cloudflare D1

Framework and build:

- React `19.2.6`
- React DOM `19.2.6`
- Next.js-compatible App Router APIs via Next `16.2.6`
- Vinext `0.0.50`, which builds the Next/React app for a Cloudflare Worker runtime
- Vite `8.0.13`
- Cloudflare Vite plugin `1.37.1`
- Wrangler `4.92.0`

Data and import:

- Cloudflare D1 (SQLite) for hosted shared state
- Drizzle ORM `0.45.2` and Drizzle Kit `0.31.10` for schema/migration definitions
- SheetJS/xlsx `0.18.5`; a browser bundle is committed at `public/xlsx.full.min.js`

Styling/tooling:

- Tailwind/PostCSS packages are installed, but the product UI is primarily hand-written CSS rather than Tailwind utilities
- ESLint `9.39.4` with Next configuration
- Node's built-in test runner

Package manager: **pnpm** is the sole authority (`pnpm-lock.yaml` and `pnpm-workspace.yaml`). The historical `package-lock.json` has been removed.

The non-obvious architectural choice is deliberate but transitional: the React/TSX layer provides the server-rendered shell, while most product behavior and rendering live in one large browser script. This made rapid prototyping and print-window generation easy, but new substantial work should gradually move into typed modules/components without rewriting working workflows all at once.

## 3. Architecture

### Major directories

- `app/` - App Router UI shell, global CSS, auth helper, and API routes.
- `app/api/shared-state/route.ts` - GET/POST API for the current dataset and shared overrides. The Cloudflare D1 (`cloudflare:workers`) backing was removed along with the Worker/Sites runtime; this is currently a non-persistent stub (GET returns empty state, POST returns 503) pending the Postgres/Drizzle migration.
- `app/page.tsx` - Static CRM shell, sidebar navigation, filters, and script loading.
- `app/layout.tsx` - Root HTML layout and metadata.
- `app/globals.css` - All CRM, responsive, mobile, and print-related styling.
- `app/_sites-preview/` - Leftover starter preview code. It is not part of the current page and should be removed with its unused dependency.
- `app/access-denied/page.tsx` - Plain page shown to authenticated users whose email isn't on the `ALLOWED_USERS` allowlist.
- `app/api/auth/[...nextauth]/route.ts` - Auth.js's catch-all route (sign-in, callback, sign-out, session, etc.), re-exporting `handlers` from `auth.ts`.
- `auth.ts` (repo root) - Auth.js config: Google provider, jwt/session callbacks that attach the resolved role (or `null`) to the session via `lib/allowlist.ts`.
- `proxy.ts` (repo root) - Route protection for the whole app (Next 16 renamed `middleware.ts` to `proxy.ts`; see the Authentication section under Infrastructure & Services).
- `lib/allowlist.ts` - Parses `ALLOWED_USERS` (`email:role` pairs) and resolves a role for a given email. Pure/testable; see `tests/allowlist.test.mjs`.
- `public/app.js` - Main application. It owns state, views, spreadsheet parsing, validation, mailing calculations, status changes, profiles, envelope HTML generation, QA, packet/bin workflows, simulators, and DOM event binding.
- `public/everletterSeed.json` and `public/seed-data.js` - Sanitized empty fallback dataset. Never replace these with production customer data in Git.
- `public/assets/` - Everletter logo, wax seal, character art, envelope corner art, and sample-letter images.
- `db/schema.ts` - Drizzle definition of the current `crm_state` table.
- `db/index.ts` - Was the Drizzle/D1 binding helper (`cloudflare:workers` env.DB). Now a stub that throws, pending a real `drizzle-orm/node-postgres` connection.
- `drizzle/` - Generated D1 (SQLite-dialect) migration and Drizzle metadata. Will be regenerated once the schema/dialect moves to Postgres.
- `tests/rendered-html.test.mjs` - Starter-template tests. These are stale and do not represent the CRM; see Known Issues.
- `examples/` - Starter D1 example code, not used by the CRM. It can be removed after confirming no tooling requires it.

### Current data flow

1. A user uploads the current `.xlsx`, `.xls`, or `.csv` mailing schedule in the Import Sheet view.
2. `public/app.js` parses and validates it in the browser and builds a structured dataset containing subscribers, recipients, subscriptions, orders, mailings, summaries, and exceptions.
3. Publishing POSTs the complete JSON dataset to `/api/shared-state` as `kind=crmDataset`, `key=current`.
4. D1 stores that JSON in one `crm_state` row. Mailing statuses, component statuses, and reviewed exceptions are stored as additional key/value rows.
5. On load, the browser merges hosted values with localStorage fallbacks and the empty committed seed.

Current D1 record kinds:

- `crmDataset::current` - full imported CRM JSON
- `mailingStatus::<mailingKey>` - production status overrides
- `componentStatus::<componentKey>` - envelope/letter/insert/location/QA state
- `reviewedException::<exceptionKey>` - reviewed flags

### Conventions to preserve

- Never commit customer exports, spreadsheets, email addresses, physical addresses, access tokens, or private Drive IDs.
- Treat stable subscriber/subscription identity separately from Squarespace order numbers. Month-to-month renewals create new order numbers, and one email address can own multiple subscriptions.
- Mailing cadence is the 1st and 15th. A roughly three-day cutoff determines whether a new order can join the imminent batch.
- Month-to-month customers receive two letters per payment and normally need two envelopes printed together. Six- and twelve-month orders receive 12 and 24 letters respectively and are usually prepared in advance.
- Character changes restart the letter number at 1 and should remain a Needs Review event because the envelope/bin workflow changes.
- Preserve stable mailing/component key generation when refactoring; existing D1 overrides depend on those keys.
- Keep customer-data configuration out of static/public assets. Use server-side secrets/config or normalized database records.

## 4. Infrastructure & Services

### GitHub

- Purpose: primary source-control repository.
- Repository: `https://github.com/marcy-ever/everletter-ops-crm`
- Account/owner: GitHub user/organization `marcy-ever`; Marcy owns the credentials. Log in at GitHub.
- Code config: `.git/config` locally; remote name is `origin`. No GitHub Actions workflow is currently committed.
- Important: GitHub is source-of-truth for code, but it is not currently connected to automatic production deployment.

### OpenAI Sites

- Purpose: current private hosting/deployment control plane. It builds/runs the app as a Cloudflare Worker and provisions/binds D1.
- Live private URL: `https://everletter-ops-crm.marcy12s.chatgpt.site`
- Sites project ID: `appgprj_6a5aa9f98dc08191860bdf5becfcba2c`
- Account: Marcy's OpenAI/ChatGPT workspace/account. Access through the Sites-enabled Codex/OpenAI workspace used to create the app. Exact login credentials are not stored in the repo.
- Code config: `.openai/hosting.json`, `build/sites-vite-plugin.ts`, `vite.config.ts`, and `worker/index.ts`.
- Deployment is manual through the Sites tooling; pushing GitHub alone does not update the live site.

### Cloudflare Workers runtime (managed by OpenAI Sites)

- Purpose: executes the Vinext server bundle and serves static assets.
- Account: currently managed through OpenAI Sites, not a separately documented Everletter Cloudflare account.
- Code config: `worker/index.ts`, `vite.config.ts`, and generated `dist/` output.
- Bindings expected by the worker: `ASSETS`, `IMAGES`, and `DB`. Sites supplies these in hosted environments.

### Cloudflare D1 (managed by OpenAI Sites)

- Purpose: durable production storage for the imported CRM dataset and shared workflow overrides.
- Account: Sites-managed under the same OpenAI Sites project. A standalone Everletter-owned Cloudflare/D1 account has been discussed but not created/migrated.
- Code config: logical binding `DB` in `.openai/hosting.json`; schema in `db/schema.ts`; migration in `drizzle/0000_black_forgotten_one.sql`; access in `app/api/shared-state/route.ts` and `db/index.ts`.
- No database ID or credential is committed. Local development uses a placeholder D1 ID and project-local Miniflare/Wrangler state.

### Google Fonts

- Purpose: envelope typography for each Everletter character and adult envelopes.
- Account: none required; fonts are loaded at print-window runtime from `fonts.googleapis.com`/`fonts.gstatic.com`.
- Code config: the `@import` generated in `public/app.js` near the envelope print HTML.
- Risk: envelope appearance depends on network access and font loading at print time.

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
- Full reference - allowlist format and current entries, how to check the resolved role in server code and in `public/app.js`, how to add a user, and what's explicitly **not** built yet (no per-feature restrictions exist): see **[docs/auth.md](docs/auth.md)**.
- Status: structurally complete but not live-tested. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are still placeholders in `.env.example` pending Marcy setting up the Google Cloud OAuth project.
- Superseded: the old OpenAI Sites/ChatGPT-header-based approach (`app/chatgpt-auth.ts`, never actually called by the page) has been removed. The previous known limitation (Ashley unrecognized in the required ChatGPT workspace) no longer applies - Google OAuth plus the allowlist replaces it entirely.

### DNS and custom domain

- No custom CRM domain or DNS configuration is present. The production CRM uses the `chatgpt.site` URL. The marketing site/domain remains in Squarespace and is not configured in this repo.

### Payments/SMS/other APIs

- Stripe/Squarespace payment data is not directly integrated.
- No SMS service exists.
- No R2 object storage is configured (`r2` is `null` in `.openai/hosting.json`).

## 5. Environment Variables & Secrets

The application currently requires **no user-supplied `.env` variables** for the sanitized local build. Do not invent or commit secrets.

Hosted bindings (provided by Sites/Cloudflare, not ordinary env vars):

- `DB` - D1 database binding used by `/api/shared-state`.
- `ASSETS` - static asset fetcher used by the Worker.
- `IMAGES` - Cloudflare image transformation binding used by Vinext image optimization.

Build/tool variables used or defaulted by the project:

- `CODEX_SANDBOX` - optional; when equal to `seatbelt`, Vite uses polling for file watching.
- `WRANGLER_WRITE_LOGS` - optional tooling control; defaults to `false` in `vite.config.ts`.
- `WRANGLER_LOG_PATH` - optional Wrangler log path; npm scripts currently set it and `vite.config.ts` also defaults it to `.wrangler/logs`.
- `MINIFLARE_REGISTRY_PATH` - optional local Miniflare state location; defaults to `.wrangler/registry`.

No secret values currently live in this GitHub checkout. `.env*`, PEM files, customer data, and deployment tokens are ignored. Sites credentials and database resource identifiers live in the hosting control plane. Future integrations should use names such as `SQUARESPACE_API_TOKEN`, `MAILCHIMP_API_KEY`, and Drive OAuth/service-account variables only after the integration design is chosen; those names are suggestions, not current requirements.

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

4. Copy `.env.example` to `.env.local` (gitignored) and adjust `DATABASE_URL` if needed; the default matches `devops/docker-compose.yml`.
5. Start local Postgres and apply migrations:

   ```bash
   pnpm docker:up
   pnpm db:migrate
   ```

   `docker:up`/`docker:down` run `devops/docker-compose.yml` with an explicit `--project-directory .` and `-p everletter-ops-crm`, so the project name (and its data volume) stay stable regardless of where the compose file itself lives.

6. Start local development:

   ```bash
   pnpm dev
   ```

### Build, lint, and database migration

```bash
pnpm build
pnpm lint
pnpm db:generate
pnpm db:migrate
```

Only run `pnpm db:generate` after intentionally changing `db/schema.ts`, then inspect the generated migration, commit it, and run `pnpm db:migrate` to apply it to your local Postgres (started via `pnpm docker:up`).

### Tests

The declared command is:

```bash
pnpm test
```

However, the committed tests are stale starter-template tests and are expected to fail against the actual CRM. Replace them before treating the test command as a release gate. For current changes, at minimum run `pnpm build`, manually test spreadsheet import with synthetic data, verify shared-state GET/POST against local D1, and verify envelope print preview/printing.

### Local data caution

- Do not import production spreadsheets into a screen recording, shared test environment, or Git-tracked fixture.
- Use synthetic data for development.
- Browser localStorage keys include `everletterStatusOverrides`, `everletterComponentOverrides`, and `everletterReviewedExceptions`. They are fallback/cache state and can make two local test runs appear inconsistent.

## 7. Deployment

Deployment is **manual**. GitHub push is not connected to a CI/CD pipeline and does not deploy production.

Current Sites deployment flow:

1. Start from a clean, reviewed commit in this GitHub repository.
2. Run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```

3. Confirm `.openai/hosting.json` still targets the intended Sites project and binds D1 as `DB`.
4. Use the OpenAI Sites hosting tooling to:
   - obtain/reuse a source-repository write credential for the existing Sites project;
   - push the exact validated source commit to the Sites-managed source repository without storing the credential in Git config or a remote URL;
   - package `dist/`, `.openai/hosting.json`, and `drizzle/` migrations with the Sites packaging helper;
   - save a site version for that commit;
   - deploy the version privately;
   - wait until deployment reports `succeeded`.
5. Verify `https://everletter-ops-crm.marcy12s.chatgpt.site` using an authorized account.

There is no safe standalone shell command in this repository that can publish to the existing Sites project; deployment requires the Sites connector/control-plane credentials. A developer using Claude Code will either need access to that same Sites tooling/account or should design an explicit migration to an Everletter-owned Cloudflare account. Do not create a second production database casually: the current live customer data is in the Sites-managed D1 database.

Before deploying this sanitized GitHub version, resolve the private operational Drive configuration. The GitHub copy intentionally has blank Drive URLs, while the existing live deployment may still have private links from an earlier source version. Deploying GitHub unchanged could remove those links from the live UI. The D1 dataset itself is not replaced by a code deployment.

## 8. Known Issues & Unfinished Work

Highest priority:

- The spreadsheet is still the upstream system of record. The stated product direction is to move completely away from spreadsheets and use normalized CRM records.
- D1 stores the entire dataset as one JSON value plus override rows. There are no normalized customer, recipient, subscription, order, mailing, note, event, or audit tables.
- Imports overwrite `crmDataset::current`; there is no import history, rollback UI, versioned backup, or user-facing export/restore flow.
- Status saves are asynchronous and optimistic. Failures are logged/alerted inconsistently, and there is no visible retry queue or conflict handling.
- No live-update mechanism between users. The app uses plain HTTP GET/POST for `/api/shared-state` - there's no websocket or push mechanism, so if Marcy and Ashley are both using the CRM at the same time, one person's changes (status updates, imports, reviewed exceptions) won't appear for the other until they manually refresh the page. This risks someone acting on stale data without realizing it. TODO for whoever picks this up next (likely Codex): at minimum, a lightweight "this page may be stale, refresh to see recent changes" indicator would prevent acting on outdated information - doesn't require full realtime sync, just a signal. A full live-update experience (websockets or polling-based) would be a bigger undertaking to consider once that minimal version is in place.
- Stable keys are derived in browser code. A key-generation change can orphan existing overrides.
- Google OAuth (Auth.js) plus an email allowlist now enforce access on every route (`auth.ts`, `proxy.ts`, `lib/allowlist.ts`) - but real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` haven't been set yet, so this hasn't been exercised with a live sign-in. Marcy and Ashley are both in `ALLOWED_USERS`; Ashley's access is unblocked as soon as real credentials land.
- No per-feature/per-role restrictions exist yet, even though the resolved role is available (`session.role`, and `data-user-role` on the page shell for `public/app.js`). Pending Marcy specifying what Ashley should be restricted from.
- Private Google Drive folder IDs were removed from GitHub; Drive buttons are therefore incomplete in this source.

Integrations not built:

- Squarespace order/renewal/cancellation/failed-payment sync
- Identity matching for one email with multiple subscriptions beyond current import heuristics
- Mailchimp sample-request automation and conversion tracking
- Google Drive API lookup/attachment/printing
- Gmail automation
- Revenue/lifetime-value and per-character fulfillment cost tracking

Code quality/maintenance:

- `public/app.js` is a very large monolithic script with untyped state and direct DOM rendering.
- `app/globals.css` is similarly large and should be decomposed carefully.
- Starter files remain: `app/_sites-preview/`, `react-loading-skeleton`, and `examples/`.
- `tests/rendered-html.test.mjs` asserts starter content that no longer exists.
- Some source strings show mojibake such as `Â·`; normalize encoding while preserving intended display.
- Google Fonts load over the network in generated print windows. Printing before fonts finish loading may use fallback fonts.
- Envelope output needs physical-printer QA for feed orientation, scaling at 100%, A7 paper size, margins, and each character's colored stock.
- The browser-side xlsx bundle is committed/minified and should be tracked to its exact source/version and updated intentionally.
- API input has minimal validation and no payload-size limit. A malformed or oversized dataset could cause operational problems.
- The API creates schema at request time even though a migration exists.
- No automated accessibility, mobile, print-layout, integration, or end-to-end tests exist.
- No monitoring/error reporting service is configured.

Operational caveats:

- The live D1 dataset may be newer than any spreadsheet or seed in GitHub.
- The public fake-data demo is a separate deployment and must never be pointed at production D1.
- The real app should remain private because it contains names, emails, and mailing addresses.
- Re-importing a spreadsheet can cause old Needs Review flags to return because reviewed flags are tied to generated exception keys.

## 9. Recent Context and Recommended Next Steps

Most recent completed work:

- GitHub was chosen as the primary source of truth for code.
- A clean repository was created and pushed to `marcy-ever/everletter-ops-crm` without customer data or private Drive IDs.
- The live app already had spreadsheet upload, shared D1 persistence, batch printing, QA, Batch Packet, Ashley Bins, playful branding, mobile-focused behavior, and envelope generation.
- Marcy was still safely updating the spreadsheet and publishing it through Import Sheet until direct order entry/sync exists.

Logical next steps, in order:

1. **Secure ownership and access:** confirm repository collaborators, enable branch protection, document Sites ownership, and decide whether to retain Sites-managed infrastructure or migrate to an Everletter-owned Cloudflare account.
2. **Back up live data before structural work:** add authenticated export of the current D1 dataset and overrides; capture timestamped/versioned import snapshots; document restore steps.
3. **Fix the engineering baseline:** replace stale tests, remove starter artifacts, choose pnpm only, fix encoding, add API validation, and add a small synthetic fixture suite.
4. **Finish authentication for Marcy and Ashley:** structurally done (Google OAuth via Auth.js + `ALLOWED_USERS` allowlist, enforced by `proxy.ts` on every route) - remaining work is Marcy setting up real Google Cloud OAuth credentials, then a live sign-in check on desktop and phone before broadening use.
5. **Design normalized D1 schema:** customers, recipients, subscriptions, external orders/payments, mailings, component statuses, notes, exceptions, audit events, imports, and integration cursors. Preserve migration/rollback strategy.
6. **Build native manual entry/editing:** allow adding and correcting customers/subscriptions/orders directly in CRM so spreadsheet uploads can be retired safely.
7. **Migrate existing D1 JSON:** write and test a one-time, reversible migration from `crmDataset::current` and override rows into normalized tables.
8. **Move private operational configuration server-side:** store Drive folder mappings or file references outside public JS; decide whether to use Drive OAuth, service accounts, or curated links.
9. **Connect Squarespace:** scheduled daily sync is acceptable initially. Make ingestion idempotent, preserve raw external payloads, identify subscriptions independently of order numbers, support multiple subscriptions per email, and create mailing schedules only after successful payment.
10. **Add Mailchimp sample automation:** capture website sample requests, tag Kid/Adult, send the selected sample, record consent/source/time, and match later purchases.
11. **Add observability and operational safeguards:** audit log, import/sync dashboard, failed-save retry, monitoring, and routine backup/restore drills.

Do not begin by rewriting the UI. The working operational rules encoded in `public/app.js` are valuable and should first be covered with synthetic tests. Then migrate one workflow at a time into typed modules while keeping mailing-day behavior stable.
