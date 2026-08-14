# Authentication & Roles

This describes the auth system actually implemented in this repo (branch
`feat/auth-google-sso`), not a design discussion. If something here looks
wrong, the code (`auth.ts`, `proxy.ts`, `lib/allowlist.ts`) is the source of
truth - update this doc to match it, not the other way around.

## What this is, and why

Google Sign-In via [Auth.js](https://authjs.dev) (`next-auth@5`), with an
email allowlist and role check layered on top. No passwords, no user
database - anyone with a Google account can complete sign-in, and a
separate, app-level check decides whether that account is actually allowed
in.

This is the same conceptual pattern reviewed in `aaru/svc-conex`
(`aaru/svc.webapp/src/auth`): let Google auth succeed broadly, then gate on
an allowlist afterward, with denial handled as a plain in-app page rather
than blocking at the OAuth provider level. The aaru version is a different
stack entirely (React SPA + Java backend calling a `/auth/verify` endpoint),
so no code is shared - just the approach.

**Status:** structurally complete, not live-tested. `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` in `.env.example` are still placeholders pending
Marcy's Google Cloud OAuth setup. Everything below has been verified via
build/typecheck, `proxy.ts` redirect behavior in dev, and unit tests
(`tests/allowlist.test.mjs`) against real mock session data - not an actual
Google sign-in round trip.

## How the pieces fit together

- `auth.ts` (repo root) - Auth.js config. One provider (Google, reading
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from env - not Auth.js's own
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` convention). The `jwt` callback
  looks up a role for the signed-in email via `lib/allowlist.ts` and stores
  it on the token; the `session` callback copies that onto `session.role`.
  Sign-in itself is never rejected here - an unmatched email just ends up
  with `role: null`.
- `proxy.ts` (repo root) - Next.js 16 renamed the `middleware.ts` file
  convention to `proxy.ts` (same mechanism, new name/file - see
  [the Next.js migration notes](https://nextjs.org/docs/messages/middleware-to-proxy)
  if this looks unfamiliar). Runs on every route except the ones listed in
  its `matcher` (Auth.js's own `/api/auth/*` routes, `/access-denied`
  itself, Next's internal static/image paths, and static files under
  `public/`). Logic:
  - No session at all → redirect to `/api/auth/signin`, preserving the
    original URL as `callbackUrl`.
  - Session exists but `session.role` is falsy (not on the allowlist) →
    redirect to `/access-denied`.
  - Otherwise → let the request through.
- `app/access-denied/page.tsx` - plain page shown for the second case
  above. Not a Google-level block; the account really did sign in
  successfully.
- `app/api/auth/[...nextauth]/route.ts` - the standard Auth.js catch-all
  route (sign-in, callback, sign-out, session, CSRF, etc.), just re-exports
  `handlers` from `auth.ts`.
- `types/next-auth.d.ts` - module augmentation so `session.role` (and
  `token.role`) type-check as `string | null`.

## Allowlist / role configuration

One env var, `ALLOWED_USERS`: a comma-separated list of `email:role` pairs.

```
ALLOWED_USERS=marcy@example.com:owner,ashley@example.com:staff
```

- Not a database table - just enough to gate access and attach a role,
  parsed fresh from the env var on every token refresh.
- Email matching is case-insensitive (both sides are lowercased before
  comparison); role values are stored as-typed.
- Malformed entries (no colon, empty email or role, stray whitespace/commas)
  are silently skipped rather than throwing - see
  `parseAllowedUsers`/`getRoleForEmail` in `lib/allowlist.ts` and the tests
  in `tests/allowlist.test.mjs` for the exact accepted/rejected shapes.
- Read in exactly one place: `getRoleForEmail` in `lib/allowlist.ts`,
  called from `auth.ts`'s `jwt` callback. It defaults to reading
  `process.env.ALLOWED_USERS`, but also accepts the raw string as a second
  argument, which is what makes it testable without mocking env vars.

**Current entries** (`.env.example`, `.env.local`): the *real* values live
in the actual deployment env (or a local, gitignored `.env.local`), not in
the repo. `.env.example` currently documents the shape with placeholder
values:

```
ALLOWED_USERS=owner@example.com:owner,staff@example.com:staff
```

The two people who need real entries are Marcy (role `owner`) and Ashley
(role `staff`) - those role names are placeholders too, illustrative rather
than meaningful yet, since no code branches on them beyond "is this user on
the allowlist at all" (see **Not yet done**, below).

## Checking the current user's role in code

**Server-side** (Server Components, Route Handlers) - call `auth()` from
`auth.ts` and read `.role` off the returned session:

```ts
import { auth } from "@/auth";

export default async function SomePage() {
  const session = await auth();
  const role = session?.role ?? null; // null if unauthenticated OR not on the allowlist
  // ...
}
```

`app/page.tsx` already does exactly this - see below.

**In `proxy.ts`**, the session is available as `req.auth` (populated by the
`auth(...)` wrapper the whole file is built on) - e.g. `req.auth.role`.

**In `app/crm/legacy-app.js`** (client-side, plain browser JS - no direct access to
the server session): `app/page.tsx` embeds the resolved role and email as
data attributes on the app's root element:

```tsx
// app/page.tsx
const session = await auth();
// ...
<div className="ops-shell" data-user-role={session?.role ?? ""} data-user-email={session?.user?.email ?? ""}>
```

Nothing in `app/crm/legacy-app.js` reads these yet. To read them from `app.js`,
follow the same inline-ternary-in-template-literal pattern already used
throughout the file for conditional rendering (e.g. the disabled/label
toggle on the publish button in the Import Sheet view,
`app/crm/legacy-app.js:1585`: `${state.importBusy ? 'disabled' : ''}`). Something
like:

```js
const userRole = document.querySelector('.ops-shell')?.dataset.userRole || '';
// ...later, in an HTML-string-building function:
${userRole === 'owner' ? '<button ...>Owner-only action</button>' : ''}
```

## Adding a new allowed user

Edit the `ALLOWED_USERS` env var (`.env.local` locally; the real deployment
env - NAS `.env.local`, or wherever the production value ends up living -
for production) and add another `email:role` pair, comma-separated. No code
change, no redeploy of anything except picking up the new env var (the
`jwt` callback re-resolves the role from `ALLOWED_USERS` on every token
refresh, not just at first sign-in). No database migration, no admin UI -
this is intentionally just an env var for now.

## NOT YET DONE: per-feature restrictions

The role is resolved, attached to the session, and reachable from
`app/crm/legacy-app.js` (see above) - but **nothing currently checks it to
show/hide or enable/disable any specific button or feature**. Right now,
any allowlisted user (`owner` or `staff`, or any other role someone adds)
gets full, identical access to everything in the CRM once past the
allowlist gate.

This is deliberate: which buttons/features Ashley (or the `staff` role
generally) should be restricted from is a real product decision that Marcy
hasn't specified yet. Whoever implements it later (this may well be Codex,
not a human) should:

1. Get the specific restriction requirements from Marcy first - don't
   guess at what "staff" should or shouldn't see.
2. Read `role` from `app/crm/legacy-app.js` as shown above (or add an equivalent
   server-side check for any restrictions that need to be enforced in
   `app/api/shared-state/route.ts` too, not just hidden in the UI - a
   client-side-only hide is not real enforcement).
3. Gate the relevant UI using the same inline-ternary pattern already used
   throughout `app/crm/legacy-app.js` for conditional rendering, rather than
   introducing a new pattern.
