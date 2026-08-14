# Testing

This describes the test setup actually implemented in this repo, not a
design discussion. If something here looks wrong, `package.json`'s scripts
and `tests/e2e-helpers.mjs` are the source of truth - update this doc to
match them, not the other way around.

## What this is, and why

`pnpm test` used to run exactly one stale starter-template test
(`tests/rendered-html.test.mjs`, asserting a Codex/Sites "loading skeleton"
page and importing a Worker build artifact removed in commit `feb8bf8`) and
none of the ten real tests written during the Option B schema migration (see
`docs/schema-design.md`). It has been rewired so `pnpm test` actually runs
all of them and fails the way a release gate should.

## Running the scripts

- **`pnpm test:unit`** - the six unit test files (`allowlist`, `ids`,
  `keys`, `mailing-rules`, `build-dataset-from-tables`,
  `build-overrides-from-tables`). Pure functions and hand-built fixtures, no
  external services. Safe to run anytime, runs in parallel.
- **`pnpm test:e2e`** - the three end-to-end files
  (`build-dataset-from-tables.e2e`, `write-to-tables-transactional.e2e`,
  `shared-state-get.e2e`). Needs real local Postgres and, for two of the
  three, the real local test spreadsheet (see below). **Serialized**
  (`node --test --test-concurrency=1`) deliberately, not as a style choice:
  node:test runs separate files in parallel by default, but all three files
  truncate and reimport the same shared local Postgres tables, and there's
  only one physical database, not one per file - two of these files
  truncating/writing concurrently would corrupt each other's results (e.g.
  a discrepancy count computed mid-truncate by another file). Don't invoke
  these files directly with `node --test` without `--test-concurrency=1` if
  running more than one together.
- **`pnpm test`** - `test:unit` then `test:e2e`. This is the actual release
  gate.
- **`pnpm typecheck`** - `tsc --noEmit`. Deliberately separate from `test`:
  type-checking and test-running are different failure modes, and `pnpm
  build` already runs its own TypeScript check as part of `next build`.

The flags every script needs (`--experimental-strip-types` for native TS
support, plus `--experimental-loader=./tests/ts-extensionless-loader.mjs` so
extensionless/`@/`-aliased imports resolve the same way they do in
application code - see that file's own comment) are written directly into
`test:unit`/`test:e2e` in `package.json`, not assumed to be set in a
developer's shell. Every script is runnable from a clean checkout with no
remembered flags. The flag string is repeated between the two scripts
rather than factored out via `package.json`'s `config` object: that
indirection expands through `$VAR`, which only works in POSIX shells and
silently breaks under `cmd.exe` - repeating a stable, one-line flag string
is the more portable choice for a project without a documented
Windows-only-runs-via-WSL policy.

## Bringing up what `test:e2e` needs

```bash
pnpm docker:up
pnpm db:migrate
pnpm test:e2e
```

`pnpm docker:up` starts local Postgres (`devops/docker-compose.yml`).
`pnpm db:migrate` applies `drizzle/` migrations to it. `DATABASE_URL` (and
anything else in `.env.local`) is picked up automatically by the test files
themselves - no need to `source .env.local` first, unless you're also
running `drizzle-kit` commands directly, which don't read `.env.local` on
their own.

The real test spreadsheet (`build-dataset-from-tables.e2e` and
`shared-state-get.e2e` need it; `write-to-tables-transactional.e2e` doesn't) is
gitignored and developer-local: `testing/Import_20260812_181828.xlsx`. Ask
Marcy/Brad for a copy if you don't have one - never commit a real customer
export (see CLAUDE.md's data-boundary notes).

## The e2e skip behavior

`tests/e2e-helpers.mjs`'s `e2eSkipReason()` is the single place that decides
whether e2e tests can run. Missing `DATABASE_URL`, a missing `.env.local`,
or a missing spreadsheet fixture all produce a clean **skip**, not a
failure, with the specific reason shown directly in the test output (e.g.
`# SKIP e2e prerequisites missing: DATABASE_URL is not set (...)`) - never a
silent no-op and never a crash. A missing `.env.local` used to crash the
whole file with an uncaught `ENOENT` before any skip logic ran, which is
exactly backwards from every file's own documented behavior; that's fixed
now that `e2eSkipReason()` checks for the file's existence before reading
it.

**A green `pnpm test` where every e2e test silently skipped is not a real
pass.** If you're relying on `test:e2e` actually exercising the normalized
tables (e.g. before merging a change to `lib/write-to-tables.ts` or
`lib/build-dataset-from-tables.ts`), check the output for `# pass` vs. `#
skipped` counts, not just the exit code.

## ⚠️ `test:e2e` truncates your local database

Every e2e test truncates the normalized tables
(`tests/e2e-helpers.mjs`'s `truncateAllTables()`) and reimports from the
spreadsheet fixture before asserting anything. **Running `pnpm test:e2e`
destroys whatever is currently in your local Postgres and replaces it with
the test fixture's data.**

This is only acceptable because everything in local/dev Postgres is
disposable test data, freely re-importable from the spreadsheet - see
CLAUDE.md's "Decided Direction" section ("all data can be deleted and
reimported, the truth data is the spreadsheet"). **If that assumption ever
stops being true for the database `DATABASE_URL` points at** - i.e., it's
pointed at anything resembling a real, hand-edited, or otherwise
non-reimportable dataset - do not run `pnpm test:e2e` against it.

## Golden-HTML view snapshots

`tests/render-snapshots.test.mjs` is part of `test:unit` (unconditional, no
skip logic, no Postgres or spreadsheet fixture needed) and covers something
nothing else in this suite touches: what `app/crm/legacy-app.js`'s render
functions actually output. The pre-existing tests prove the data layer
(import → normalized tables → reconstruction); this suite proves what each
of the twelve views renders from a given `state`. It's step 1 of the
planned `app.js` decomposition - the safety net every later refactor step
diffs against - and is itself test infrastructure only; it makes no
production code changes.

How it works: `tests/e2e-helpers.mjs`'s `loadAppJsSandbox(fixedNow, {
captureRenders: true })` dynamic-imports the real `app/crm/legacy-app.js`
(a real ES module as of step 2 of the decomposition plan, §9) with a
`document` stub installed on `globalThis` that records `innerHTML` writes
per selector (see that file's own comment for why `captureRenders` defaults
to `false` and is fully backward compatible with every other caller). Each
test case builds an explicit `state` (never relies on defaults), calls the real
`renderView()`, and diffs the captured `#viewMount` HTML against a
committed snapshot in `tests/snapshots/*.html` - one plain, readable file
per case, not minified or JSON-wrapped, so a snapshot diff shows up as a
normal diff in review. Input data comes from a synthetic, committed fixture
(`tests/fixtures/synthetic-rows.json`) run through the real
`buildSeedFromSpreadsheet()` - never `testing/Import_20260812_181828.xlsx`,
which is real customer data and can't be committed (see CLAUDE.md's
sanitized-repo data boundary).

**To regenerate snapshots after an intentional rendering change:**

```bash
UPDATE_SNAPSHOTS=1 pnpm test:unit
```

**A snapshot diff in a refactor PR is a finding to explain, never a file to
regenerate away.** The whole point of this suite is to catch rendering
changes a refactor wasn't supposed to make. Regenerating on red without
first understanding *why* the HTML changed defeats the harness - if the
diff is expected (e.g. an intentional markup change), say so in the PR
description; if it isn't, it just caught a real regression.

Two known, deliberately-unpinned edge cases are documented directly in
`tests/render-snapshots.test.mjs`'s module comment and at the relevant test
case: `number()`'s use of `.toLocaleString()` is locale-dependent (harmless
in practice while fixture counts stay under 1,000, since thousands
separators are the only thing that varies), and `batchDatesForOrder()` (used
only by the Sync Simulator view) has a real, pre-existing timezone bug -
it round-trips through `.toISOString()` with no `getTimezoneOffset()`
correction, unlike every sibling date function in the file, so under a
positive-UTC-offset `TZ` its generated dates shift back one calendar day.
Confirmed via direct `TZ=Asia/Tokyo` reproduction. Not fixed here - no
production code changes is a hard constraint of this suite - but flagged
as a real finding for whoever picks up the next decomposition step.

## What `tests/e2e-helpers.mjs` provides

Extracted after the setup/gating preamble was found copy-pasted verbatim
across all three e2e files, with real drift between the copies (one had
`fixedNow` time-pinning on the sandboxed `app.js` loader, the other didn't)
and a real bug (the ENOENT crash above). One definition now provides:

- `hasDbUrl` / `hasFixture` / `e2eSkipReason()` - the skip gates described
  above.
- `truncateAllTables(db)` - the single definition of which tables get
  truncated before each e2e test's import, kept in sync with `db/schema/` by
  hand in one place instead of drifting across files.
- `loadSpreadsheetRows()` - reads and parses the real test spreadsheet the
  same way every file needs it.
- `loadAppJsSandbox(fixedNow?)` - dynamic-imports the real
  `app/crm/legacy-app.js` (with `document`/`window`/`localStorage`/`fetch`
  stubs installed on `globalThis` first) so tests call its actual functions
  (`buildSeedFromSpreadsheet`, etc.) instead of a reimplementation. `fixedNow`
  is optional: pass it to pin the sandbox's `Date` to an exact instant
  (needed by `build-dataset-from-tables.e2e`, which compares client-side and
  server-reconstructed "now"-dependent fields and would otherwise be flaky
  across a real day boundary - see `lib/mailing-rules.ts`'s module comment);
  omit it to get the real clock.

`tests/db-test-helpers.mjs` is a separate, smaller module (`countRows()`)
used only by `write-to-tables-transactional.e2e` - see its own comment for why it
stayed separate from `e2e-helpers.mjs` rather than being folded in.
