import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getRoleForEmail } from "@/lib/allowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Google sign-in is allowed to succeed for any valid account here -
    // allowlist enforcement happens below (role stays null if not matched)
    // and in proxy.ts, which redirects role-less sessions to
    // /access-denied. Keeping the two separate means denial gets our own
    // plain page instead of Auth.js's generic OAuth error page.
    async jwt({ token }) {
      if (token.email) {
        token.role = getRoleForEmail(token.email);
      }
      return token;
    },
    async session({ session, token }) {
      session.role = typeof token.role === "string" ? token.role : null;
      return session;
    },
  },
});
