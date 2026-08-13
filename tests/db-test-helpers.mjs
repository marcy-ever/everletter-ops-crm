// Small, shared helper for tests/*.e2e.test.mjs files that need to assert
// on how many rows currently exist in a table - not a general test-utils
// module (every e2e test file is otherwise self-contained by convention;
// this exists only because two concrete call sites in
// tests/dual-write-transactional.e2e.test.mjs needed the exact same
// select-and-count, not because a shared module seemed generally useful).
export async function countRows(db, table) {
  const rows = await db.select().from(table);
  return rows.length;
}
