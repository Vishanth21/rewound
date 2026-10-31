// POST /api/logout  (stand-in for Auth.js signOut)
import { destroySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  destroySession();
  return Response.redirect(new URL("/login", req.url), 303);
}
