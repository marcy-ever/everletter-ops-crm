# Architecture

Where things live and where a change goes. Written after the app.js
decomposition finished (CLAUDE.md's Decided Direction / Migration Plan) - it
describes the tree as it exists now, not a plan or a history. For *why* it
got this shape, see CLAUDE.md's own §9 and the migration's PR history; this
document only answers "where does this live" and "where does my change go."

## The layers, and the rule between them

Four layers, each with a real, enforced boundary - not a loose convention:

- **`lib/domain/`** - pure business rules. No DOM, no `window`/`document`,
  no client-side state, no clock read internally (`today`/`now` are always
  parameters, never `new Date()` inside the module - see "Two rules" below).
  Runs identically in the browser bundle and on the server, which is the
  entire reason it's split out this way: id/key generation
  (`ids.ts`/`keys.ts`), mailing cadence rules (`mailing-rules.ts`), plan and
  character normalization (`plans.ts`/`characters.ts`), batch-date logic
  (`batch-dates.ts`), the canonical `Dataset` shape (`dataset.ts`), date/text
  formatting (`format.ts`), the seven mailing-component fields
  (`component-fields.ts`), and spreadsheet parsing
  (`spreadsheet/normalize.ts`, `spreadsheet/build-seed.ts`,
  `spreadsheet/exceptions.ts`).
- **`lib/client/`** - browser-only services and cross-view derivations. No
  DOM dependency either (nothing here touches `document`), but these
  *do* model client-side concerns `lib/domain/` has no business knowing
  about: `crm-state.ts` (the CRM's shared state shape and its three
  write-through mutators), `local-overrides.ts` (`localStorage` caching),
  `shared-state-client.ts` (the `/api/shared-state` HTTP client),
  `save-failures.ts`/`staleness.ts` (the two client-side stores behind the
  save-failure and staleness banners), and `selectors.ts` (derivations more
  than one view needs - see "How a view works" below for the exact line
  that decides what belongs here).
- **Server-side `lib/`** (the top-level files, not `lib/domain/`/`lib/client/`):
  `write-to-tables.ts` (writes a POSTed import or status change into the
  normalized tables, transactionally), `validate-shared-state.ts` (shape/size
  validation and the catastrophic-deletion guard, before any write),
  `build-dataset-from-tables.ts`/`build-overrides-from-tables.ts`
  (reconstructs the dataset shape and override state `GET /api/shared-state`
  returns, directly from the normalized tables), `change-marker.ts` (the
  `MAX(id)` staleness-marker query), `build-info.ts` (build-identity), and
  `allowlist.ts` (the `ALLOWED_USERS` parser - see `docs/auth.md`).
- **`app/crm/views/`** - one folder per sidebar tab, each a real React
  component plus its own `*-selectors.ts` (when it has real derivation to
  do - some views, like Automation, don't). This is where product behavior
  actually lives now.
- **`app/crm/shell/`** - the chrome every view sits inside, not owned by any
  one view. Six modules (all added in the app.js decomposition's Phase 2 -
  CLAUDE.md - when the monolith they replaced was deleted):
  - `nav-items.ts` - the sidebar's single source of truth (every view's id,
    badge, and label, in display order).
  - `Sidebar.tsx` - renders `nav-items.ts`.
  - `view-registry.ts` - `VIEW_REGISTRY`, which of the two shell filter
    controls (Status, Batch) each view shows. See "How a view works" below.
  - `drive-links.ts` - the (empty in this sanitized repo) Google Drive
    folder configuration and the shared Drive-link click handler.
  - `banners.ts` - pure functions (snapshot in, HTML string out) for the
    save-failure and staleness banner copy - no DOM, easy to unit test.
  - `crm-app-state.ts` - `createAppState()`, a factory bundling the CRM's
    shared `state` with its write-through mutators and the save-failure/
    staleness stores, plus the one real singleton instance the running app
    uses.
  - `render-shell.ts` - paints the topbar/metric cards/status strip/batch
    filter, and `renderView()` (side-nav active-button tracking, filter
    visibility, the `notifyViewChanged()` signal - see "How a view works").
  - `init-crm-app.ts` - `initCrmApp()`, the one function `app/crm/CrmApp.tsx`
    calls to boot the whole app: binds shell DOM refs, restores
    `localStorage` overrides, wires nav/search/filter listeners, starts
    change-marker polling, loads the real dataset.

**Import direction is a rule every future change depends on, not just a
convention.** `lib/domain/` imports nothing from `lib/client/` or `app/` -
no DOM, state, `window`, or clock dependency, which is what lets the same
implementation run in the browser bundle and on the server. `lib/client/`
may import `lib/domain/`. `app/crm/views/` and `app/crm/shell/` may import
both. Server-side `lib/` (`write-to-tables.ts` etc.) may import
`lib/domain/`, never `lib/client/` or `app/`. Breaking this in either
direction either couples server code to a browser-only assumption, or
duplicates domain logic instead of sharing it.

## How a view works

`app/crm/CrmApp.tsx` is the seam every view is hosted through:

- `state` (`app/crm/shell/crm-app-state.ts`) is the single source of truth
  for the CRM's client-side data - which view is active
  (`state.activeView`), the loaded dataset, filters, overrides. `CrmApp.tsx`
  does not duplicate any of it into React state; it *observes*
  `state.activeView` via `useSyncExternalStore`, combined with
  `getRenderGeneration()` (a counter bumped on every `notifyViewChanged()`
  call) so a mutation to any other part of `state` still triggers a
  re-render, not just an active-view switch.
- `REACT_VIEWS` (`app/crm/CrmApp.tsx`) is a lookup table - view id to a
  function that reads whatever it needs off `state`, computes props (often
  via that view's own `*-selectors.ts`), and returns the element to render.
  This is the one place, for every view, that `state` is read and that
  `new Date()` is called (see "Two rules Phase 1 established," below) -
  the view component itself and its selectors never reach for either.
- `VIEW_REGISTRY` (`app/crm/shell/view-registry.ts`) answers one question
  per view: does it show the Status filter, the Batch filter, both, or
  neither. `app/crm/shell/render-shell.ts`'s `renderView()` reads it to
  toggle those two controls' visibility on every view switch.
- `nav-items.ts` and `VIEW_REGISTRY` are two independently-declared lists
  of the same view ids, and **`tests/nav-items.test.mjs` is the invariant
  that keeps them honest** - it asserts the two key sets are identical, so
  a view can never end up with a nav button and no registry entry, or a
  registry entry with no nav button. Any change that adds, removes, or
  renames a view must update both files, or that test fails.
- **Where a view's own derivation belongs, versus `lib/client/selectors.ts`**:
  a computation only one view needs stays beside that view, in its own
  `*-selectors.ts`. A computation two or more views need becomes a shared
  selector in `lib/client/selectors.ts`. This is not a judgment call made
  fresh each time - `app/crm/views/launch-plan/launch-selectors.ts`'s own
  header states the rule directly, having been the first place it had to be
  drawn for real: Launch Plan's checklist logic is view-specific and stays
  local, but `packetRows`/`packetProblemRows` (which Launch Plan and Batch
  Packet both need) moved to `lib/client/selectors.ts`. Getting this wrong
  in either direction either bloats the shared module with something only
  one view cares about, or forces a second view to duplicate a computation
  the first one already got right.

## Two behavioral rules Phase 1 established

Neither of these is discoverable by reading a single file in isolation -
both came out of comparing new React callback code against the exact
legacy behavior it replaced, across multiple views, and are worth stating
explicitly for whoever writes callback number thirteen.

**1. Call `render()`, not `notifyViewChanged()`, when an action's effect
reaches outside the view's own mount.** Every interactive view's callback
mutates `state` and then signals a re-render - but there are two different
signals, and they are not interchangeable:

- `notifyViewChanged()` (`app/crm/shell/crm-app-state.ts`) tells
  `CrmApp.tsx` "a render may be needed" - sufficient when nothing outside
  the current view's own props changed.
- `render(state, notifyViewChanged)` (`app/crm/shell/render-shell.ts`) does
  that *and* repaints the shell chrome outside any view's mount - the
  topbar, the four metric cards, the per-status meter strip. Necessary
  whenever a write changes something those cards read (most visibly,
  `effectiveMailings().filter((m) => m.status === status)` for the status
  strip).

The rule is not "any write to `state` needs `render()`" - it is "does
*this specific write* change something `renderShell()` reads." Needs
Review's `onReview` (`app/crm/CrmApp.tsx`) calls `render()` because
reviewing an exception changes the "Needs review" metric card count.
Mailing QA's `onFieldChange` calls `notifyViewChanged()` alone, because a
single component-status write never touches shell metrics - but its
`onMarkMailed` (which writes `updateMailingStatus`, changing what the
status strip counts) calls `render()`. **This has to be checked against
what the legacy code actually did for that specific action, not inferred
from the rule** - Subscribers' `onMarkPrinted`/`onMarkAshley` mutate
`state.componentOverrides`/`state.statusOverrides`, which the status strip
*does* read, and by the rule above should call `render()` - but the
removed legacy handler never did, and "no behavior change" means
reproducing what the code actually did, not what the rule would predict.
That gap is real and current - see CLAUDE.md's Known Issues.

**2. Pass the clock in; never call `new Date()` inside a selector.** Every
selector and domain function that needs "today" or "now" takes it as an
explicit parameter (`today: string`, `now: Date`) rather than reading the
clock itself. `app/crm/CrmApp.tsx` is the one place `new Date()` gets
called for a migrated view, once per `REACT_VIEWS` entry that needs it;
`lib/domain/` functions take `today`/`now` the same way
(`todayIso(now)`, `buildSeedFromSpreadsheet(..., now, ...)`,
`spreadsheetExceptionReasons(..., today)`). This is what makes every one of
these functions testable with a fixed, fake date and zero
`globalThis.Date` patching - see any `tests/*-selectors.test.mjs` file for
the pattern in practice.

## How to add a thirteenth view

Concrete steps, in order. `app/crm/views/Automation.tsx` (the smallest
existing view - static content, no derivation, no writes) is the simplest
real example to read alongside this.

1. **Add the nav entry.** `app/crm/shell/nav-items.ts`'s `NAV_ITEMS` array:
   pick a stable `id` (this becomes the `data-view` attribute and the
   `window.location.hash` value - never rename it later, bookmarks depend
   on it), a `badge`, and a `label`.
2. **Add the registry entry.** `app/crm/shell/view-registry.ts`'s
   `VIEW_REGISTRY`: the same `id`, with `showStatusFilter`/`showBatchFilter`
   set to whatever the new view actually needs. `tests/nav-items.test.mjs`
   fails immediately if this step is skipped or the id doesn't match step 1
   exactly - that's the point of the invariant.
3. **Write the derivation, if there is one.** If the view needs to compute
   anything from `state.seed` (filtering, grouping, per-row display data),
   write it as a pure function taking explicit parameters (`seed`,
   `reviewed`, `componentOverrides`, `today`, whatever it needs - never
   `state` itself) in a new `app/crm/views/<view>/<view>-selectors.ts`. If
   an existing view already computes something identical, that's the
   signal to promote it to `lib/client/selectors.ts` instead of writing a
   second copy - see "How a view works," above.
4. **Write the component.** `app/crm/views/<view>/<View>.tsx` (or a bare
   `app/crm/views/<View>.tsx` for a trivial one, like `Automation.tsx`):
   plain props in, JSX out. Any write action becomes a callback prop
   (`onSomething: (...) => void`) - the component itself never touches
   `state` or calls `saveSharedState`/`updateMailingStatus`/etc. directly.
5. **Wire it into `CrmApp.tsx`.** Add a new entry to `REACT_VIEWS` (keyed
   by the same `id`): read whatever `state` fields the view needs, call its
   selector if it has one, and return the component with its props and
   callbacks. Each callback does the real mutation
   (`updateMailingStatus`/`updateComponentStatus`/`updateEnvelopeStatus`/
   `saveSharedState`/a browser action like `window.open`) and then calls
   either `render(state, notifyViewChanged)` or `notifyViewChanged()` alone
   - see "Two rules," above, for which.
6. **Write tests.** A `tests/<view>-selectors.test.mjs` for the pure
   derivation (if any) with hand-built fixtures and a fixed `today`/`now` -
   no database, no DOM. A `tests/<view>-view.test.mjs` proving the
   component's `renderToStaticMarkup()` output is correct (either a fresh
   snapshot in `tests/snapshots/<view>.html`, normalized via
   `tests/html-normalize.mjs`, or direct assertions on the markup if the
   view is new enough to have no legacy output to match) and that every
   real `onClick`/`onChange` prop fires with the right arguments. If the
   view writes to the server, a `tests/<view>-write-path.e2e.test.mjs`
   proving the real write against a real Postgres - see "Testing," below.
7. **Register the new test files.** Add them to `package.json`'s
   `test:unit` (selector/view tests) and `test:e2e` (write-path tests)
   scripts - a test file that exists but isn't in either script never runs
   under `pnpm test`.

## Testing

- **Per-view component tests** (`tests/<view>-view.test.mjs`) render the
  real component via `renderToStaticMarkup()` and compare against a
  committed snapshot in `tests/snapshots/<view>.html`, using
  `tests/html-normalize.mjs`'s documented whitespace-normalization rules -
  byte-identity isn't achievable for JSX output (React discards
  whitespace-only text between elements at compile time that a legacy
  template literal's real newlines produced), so the comparison tolerates
  that specific, well-understood difference and nothing else. The same
  files also walk the component's returned element tree and invoke its
  real `onClick`/`onChange` props directly, proving the wiring without a
  browser or `jsdom`.
- **Per-view selector tests** (`tests/<view>-selectors.test.mjs`) call the
  pure derivation directly with hand-built fixtures and a fixed
  `today`/`now` - no database, no DOM, deterministic by construction (see
  "Two rules," above).
- **The `.tsx`/`.ts` test transform**: Node's native `--experimental-strip-types`
  only erases TypeScript type syntax, it has no JSX compiler.
  `tests/ts-extensionless-loader.mjs` (registered as a loader for every
  test run) fills the gap: it uses the `typescript` package's
  `transpileModule()` (already a pinned dependency for `pnpm typecheck`, no
  new dependency added) to compile `.tsx` files, and separately remaps
  extensionless/`@/`-aliased specifiers the way `tsconfig.json` does, so
  test files can import real application `.ts`/`.tsx` files directly
  instead of needing rewritten copies.
- **E2e write-path tests** (`tests/<view>-write-path.e2e.test.mjs`) prove a
  view's real write path against a real local Postgres:
  `globalThis.fetch` is rewired to call `app/api/shared-state/route.ts`'s
  real `POST`/`GET` handlers directly, in-process (no HTTP server), and
  assertions check the real row written, the real audit-log entry, and
  that the actor's own write never trips their own staleness banner. See
  `docs/testing.md` for how to bring up local Postgres, the full current
  list of e2e files (in `package.json`'s `test:e2e` script - not repeated
  here, it grows with every new write-path test), and the **`test:e2e`
  truncates your local database** warning.
- **Fresh state per test, no shared singleton**: `createAppState()`
  (`app/crm/shell/crm-app-state.ts`) is a plain factory - call it directly
  in a test to get an isolated `state`/mutators/stores instance, never
  reused across test cases and never touching the one real production
  singleton `app/crm/CrmApp.tsx` imports. `tests/crm-app-state-isolation.test.mjs`
  is the test that guards this property directly - a regression here would
  let one test's writes silently leak into another's. Most write-path
  tests need nothing beyond this; a smaller number that also touch
  `document`/`window` (visibility-change wiring, the shell's own nav
  rendering) use `tests/shell-test-helpers.mjs`'s
  `installLocalStorageStub()`/`installShellDomStub()` - see that file's own
  header for which tests need which.
