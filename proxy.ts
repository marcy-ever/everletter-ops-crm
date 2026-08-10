import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname === "/access-denied") {
    return NextResponse.next();
  }

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
  // the sign-in flow), the access-denied page itself, Next's internal
  // static/image paths, and static assets under public/ that don't need
  // auth to be served (the actual customer data lives behind
  // /api/shared-state, which stays protected).
  matcher: [
    "/((?!api/auth|access-denied|_next/static|_next/image|favicon\\.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|json)$).*)",
  ],
};
