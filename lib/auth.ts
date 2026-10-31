import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { pool } from "@/lib/db";
import type { Role } from "@/lib/auth-types";

const CredentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

// Used for unknown emails as well, so the response time does not reveal whether
// an account exists.
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8Yq0HhXn7EqJkYiJ3Z2g3REdA9pWwK";

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = CredentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { rows } = await pool.query(
          `SELECT user_id, full_name, role, password_hash
             FROM app_user
            WHERE lower(email) = lower($1)`,
          [parsed.data.email],
        );
        const user = rows[0];
        const validPassword = await bcrypt.compare(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !validPassword) return null;

        return {
          id: String(user.user_id),
          name: String(user.full_name),
          role: user.role,
        };
      },
    }),
  ],
});

export const { handlers, signIn, signOut } = nextAuth;
export async function auth(): Promise<Session | null> {
  const session = await nextAuth.auth();
  if (!session?.user) return null;
  return {
    user: {
      id: Number(session.user.id),
      role: session.user.role,
      name: session.user.name ?? "",
    },
  };
}

export type { Role } from "@/lib/auth-types";
export type Session = { user: { id: number; role: Role; name: string } };
