// Small, single-purpose helper for tests/*.e2e.test.mjs files that need to
// assert on how many rows currently exist in a table - used by
// tests/dual-write-transactional.e2e.test.mjs's rollback assertions.
//
// The original convention here was that every e2e file stays fully
// self-contained, and this module was the one deliberate, narrow exception
// (two call sites needing the identical select-and-count). That convention
// broke down for a different, larger kind of duplication: the env-loading,
// sandboxed-app.js, and truncate/skip-gating preamble that was
// copy-pasted verbatim across all three e2e files, had already drifted
// (one copy of the sandbox loader had time-pinning, the other didn't), and
// had a real bug (a missing .env.local crashed instead of skipping). That
// setup/gating duplication is now factored into tests/e2e-helpers.mjs. This
// module stays separate rather than folding into it - it's a one-line DB
// assertion helper, not part of getting a test into a runnable state, and
// only one file needs it.
export async function countRows(db, table) {
  const rows = await db.select().from(table);
  return rows.length;
}
