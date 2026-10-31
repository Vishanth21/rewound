// lib/guard.ts
// Role checks used by pages and route handlers. These are the *first* guard (good errors,
// early exit). The database is the real guard: scope functions, triggers and privileges
// re-check everything, so a bug here can never expose data.
import { redirect } from "next/navigation";
import { auth, type Role, type Session } from "@/lib/auth";

/** For pages: redirect to /login when signed out, to /search when the role is wrong. */
export async function requirePage(roles?: Role[]): Promise<Session> {
  const session = await auth();
  if (!session) redirect("/login");
  if (roles && !roles.includes(session.user.role)) redirect("/search");
  return session;
}

/** For route handlers: returns the session, or a ready-made 401/403 Response. */
export async function requireApi(roles?: Role[]): Promise<Session | Response> {
  const session = await auth();
  if (!session) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (roles && !roles.includes(session.user.role)) {
    return Response.json({ error: "You do not have permission to do that." }, { status: 403 });
  }
  return session;
}

export const isResponse = (x: Session | Response): x is Response => x instanceof Response;
