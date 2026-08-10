import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** Resolved from ALLOWED_USERS via email; null if the signed-in account isn't on the allowlist. */
    role: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string | null;
  }
}
