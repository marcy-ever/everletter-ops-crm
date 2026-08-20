/**
 * The build identity shown in app/page.tsx's sidebar footer and returned by
 * GET /api/health - "load the page and know which build you're looking at"
 * (see CLAUDE.md's deploy section). NEXT_PUBLIC_BUILD_TIME/
 * NEXT_PUBLIC_BUILD_SHA are set as build ARGs in devops/app.Dockerfile,
 * before `pnpm build` runs - Next's build step statically inlines every
 * NEXT_PUBLIC_-prefixed `process.env.X` reference (server code included,
 * not just client bundles) as a literal at build time, which is exactly
 * the semantics this needs: the value has to identify *the build*, fixed
 * once at build time, not re-read from the running container's
 * environment. Reading it here costs nothing at runtime - it's already a
 * string literal by the time this code runs.
 *
 * NEXT_PUBLIC_BUILD_TIME is pre-formatted
 * (`TZ=America/Denver date '+%Y-%m-%d %H:%M MT'` in
 * .github/workflows/build-and-push.yml) rather than a raw timestamp
 * parsed and formatted here - no date-formatting dependency needed for one
 * string, and no Date object ever gets constructed from it.
 *
 * Never fabricated. `pnpm dev` (next dev) has no build args and never will;
 * `pnpm docker:up:full` builds locally without them too (no `build.args:`
 * in devops/docker-compose.app.yml). Both cases leave
 * NEXT_PUBLIC_BUILD_TIME/NEXT_PUBLIC_BUILD_SHA empty, and this returns an
 * honest, plainly-non-production label instead of guessing - a made-up
 * value would defeat the entire point of a feature whose job is answering
 * "is this really the build I think it is." next dev always sets
 * NODE_ENV=development (Next's own behavior, not something this file
 * sets) - the one reliable, already-available signal for telling "the dev
 * server" apart from "a built container missing its build args," without
 * inventing a second env var just to distinguish them.
 */
export interface BuildInfo {
  // The full rendered/logged string - "2026-08-16 12:32 MT · a1b2c3d" when
  // stamped, "dev" or "local build" otherwise.
  label: string;
  // Present only when both NEXT_PUBLIC_BUILD_TIME and NEXT_PUBLIC_BUILD_SHA
  // are set - never one without the other, since a partial stamp (a time
  // with no commit, or vice versa) is exactly the kind of half-true value
  // this feature exists to avoid.
  buildTime: string | null;
  commitSha: string | null;
}

export function getBuildInfo(): BuildInfo {
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || null;
  const commitSha = process.env.NEXT_PUBLIC_BUILD_SHA || null;
  if (buildTime && commitSha) {
    return { label: `${buildTime} · ${commitSha}`, buildTime, commitSha };
  }
  return { label: process.env.NODE_ENV === "development" ? "dev" : "local build", buildTime: null, commitSha: null };
}
