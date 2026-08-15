import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }

  if (!req.auth.role) {
    return NextResponse.redirect(new URL("/access-denied", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // Everything except: NextAuth's own routes (would otherwise infinite-loop
  // the sign-in flow), the access-denied page itself, the unauthenticated
  // deploy healthcheck (api/health - a container healthcheck can't hold a
  // session cookie; see app/api/health/route.ts and
  // devops/docker-compose.app.yml), Next's internal static/image paths,
  // and static assets under public/ that don't need auth to be served
  // (the actual customer data lives behind /api/shared-state, which stays
  // protected).
  //
  // api/health is listed explicitly rather than relying on the extension
  // rule below - a route literally could end in one of those extensions
  // (Next's file-based routing allows a folder name like
  // `app/api/export.json/`, producing a real route at `/api/export.json`)
  // and the exclusion is meant for static assets under public/, not API
  // routes. Making the health exemption explicit means it doesn't depend
  // on a naming coincidence with that unrelated rule.
  //
  // Known, not yet fixed: the extension exclusion below is broader than
  // it needs to be for its own stated purpose. It matches by URL suffix,
  // not by "is this actually under public/", so any API route whose path
  // happens to end in .js/.css/.json/.svg/etc. would also slip past auth
  // unintentionally. Nothing currently does. Flagged for a future pass,
  // not changed here - see this task's PR description.
  matcher: [
    "/((?!api/auth|api/health|access-denied|_next/static|_next/image|favicon\\.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|json)$).*)",
  ],
};
