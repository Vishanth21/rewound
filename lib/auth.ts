// lib/auth.ts
// STAND-IN for Member B's Auth.js setup (design plan section 13/15). It exposes the same
// shape the pages need, `await auth()` -> { user: { id, role, name } } | null, so B's real
// implementation can replace this file without touching any of Member A's code.
//
// The session is a JWT signed with AUTH_SECRET, stored in an httpOnly, SameSite=Lax cookie.
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type Role = "student" | "instructor" | "admin";
export type Session = { user: { id: number; role: Role; name: string } };

const COOKIE = "ll_session";
const key = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set (see .env.example)");
  return new TextEncoder().encode(secret);
};

export async function auth(): Promise<Session | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { user: { id: Number(payload.sub), role: payload.role as Role, name: String(payload.name) } };
  } catch {
    return null;
  }
}

export async function createSession(user: { id: number; role: Role; name: string }) {
  const token = await new SignJWT({ role: user.role, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setExpirationTime("8h")
    .sign(key());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function destroySession() {
  cookies().delete(COOKIE);
}
