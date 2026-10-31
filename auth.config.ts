import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/auth-types";

// Keep this configuration safe to import in middleware: database and bcrypt code
// belongs only in auth.ts, which runs in the Node.js server runtime.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as Role;
        session.user.name = token.name ?? "";
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
