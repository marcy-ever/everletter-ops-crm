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

- **`pnpm test:unit`** - the unit test files (see `package.json`'s
  `test:unit` script for the current list - not repeated here since it
  grows with every module `lib/domain/`/`lib/client/` gains, and a hardcoded
  count/list here would just go stale the same way CLAUDE.md's line-number
  citations did). Pure functions, hand-built fixtures, and the golden-HTML
  render snapshots - no external services. Safe to run anytime, runs in
  parallel.
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

Every one of the twelve views has its own `tests/<view>-view.test.mjs` file
proving its real React component (`app/crm/views/.../<View>.tsx`) renders
markup equivalent to a committed snapshot in `tests/snapshots/*.html` - one
plain, readable file per view, not minified or JSON-wrapped, so a snapshot
diff shows up as a normal diff in review. `renderToStaticMarkup()` renders
the component directly; `tests/html-normalize.mjs`'s documented whitespace
rules make the comparison (byte-identity isn't achievable for JSX output -
see that module's own header) rather than a bespoke normalizer per file.
Input data comes from a synthetic, committed fixture
(`tests/fixtures/synthetic-rows.json`) run through the real
`buildSeedFromSpreadsheet()` - never `testing/Import_20260812_181828.xlsx`,
which is real customer data and can't be committed (see CLAUDE.md's
sanitized-repo data boundary).

**To regenerate a view's snapshot after an intentional rendering change:**
edit `tests/snapshots/<view>.html` directly, or capture fresh output from
that view's own test file and copy it in - there is no single
`UPDATE_SNAPSHOTS`-style regeneration script; each view's own test file
owns its snapshot.

**A snapshot diff in a refactor PR is a finding to explain, never a file to
regenerate away.** The whole point of this suite is to catch rendering
changes a refactor wasn't supposed to make. If the diff is expected (e.g.
an intentional markup change), say so in the PR description; if it isn't,
it just caught a real regression.

This replaced an earlier mechanism, `tests/render-snapshots.test.mjs`,
which drove a real dynamic import of the pre-Phase-2 monolith
(`app/crm/legacy-app.js`, deleted along with that file - see CLAUDE.md's
app.js decomposition history) through a sandboxed `document` stub and
diffed its captured `#viewMount` output. As each of the twelve views
migrated to React (Phase 1), its own `*-view.test.mjs` file took over that
view's snapshot coverage directly against the real component - by the time
Phase 2 deleted the monolith, `render-snapshots.test.mjs`'s own case list
was already empty, so removing the file itself was mechanical, not a
coverage change.

## What `tests/e2e-helpers.mjs` provides

Extracted after the setup/gating preamble was found copy-pasted verbatim
across all three e2e files, with real drift between the copies (one had
`fixedNow` time-pinning, the other didn't) and a real bug (the ENOENT crash
above). One definition now provides:

- `hasDbUrl` / `hasFixture` / `e2eSkipReason()` - the skip gates described
  above.
- `truncateAllTables(db)` - the single definition of which tables get
  truncated before each e2e test's import, kept in sync with `db/schema/` by
  hand in one place instead of drifting across files.
- `loadSpreadsheetRows()` - reads and parses the real test spreadsheet the
  same way every file needs it.

`tests/db-test-helpers.mjs` is a separate, smaller module (`countRows()`)
used only by `write-to-tables-transactional.e2e` - see its own comment for why it
stayed separate from `e2e-helpers.mjs` rather than being folded in.

`tests/shell-test-helpers.mjs` provides the much smaller stubs that
replaced this file's own `loadAppJsSandbox()` (removed along with
`app/crm/legacy-app.js` - Phase 2 of the app.js decomposition, CLAUDE.md):
`installLocalStorageStub()` for the many e2e write-path tests that call
`updateMailingStatus`/`updateComponentStatus`/`updateEnvelopeStatus`
(`lib/client/crm-state.ts`'s mutators write through to `localStorage`
unconditionally), and `installShellDomStub()` (which calls the former
internally) for the smaller set of tests that also need
`document`/`window` - `app/crm/shell/render-shell.ts`'s `renderView()` and
`app/crm/shell/init-crm-app.ts`'s `bootCrmApp()` specifically. Fresh,
isolated `state`/stores no longer need any stub at all -
`app/crm/shell/crm-app-state.ts`'s `createAppState()` is a plain factory a
test calls directly; see that module's own header for how this replaced
`loadAppJsSandbox()`'s cache-busting dynamic import() trick.
