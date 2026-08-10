/**
 * ALLOWED_USERS format: comma-separated `email:role` pairs, e.g.
 * "marcy@example.com:owner,ashley@example.com:staff". Not a database table -
 * just enough to gate access and attach a role to the session until there's
 * a real reason to outgrow it.
 */
export function parseAllowedUsers(raw: string | undefined | null): Map<string, string> {
  const allowlist = new Map<string, string>();
  if (!raw) return allowlist;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const email = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const role = trimmed.slice(separatorIndex + 1).trim();
    if (!email || !role) continue;

    allowlist.set(email, role);
  }

  return allowlist;
}

export function getRoleForEmail(
  email: string | null | undefined,
  raw: string | undefined | null = process.env.ALLOWED_USERS,
): string | null {
  if (!email) return null;
  return parseAllowedUsers(raw).get(email.trim().toLowerCase()) ?? null;
}
