// POST /api/dev-login  (form: email, password)
// STAND-IN for Member B's Auth.js credentials provider. Checks the password with bcrypt against
// app_user.password_hash and sets the signed session cookie. Replace with B's /api/auth/* flow.
import bcrypt from "bcryptjs";
import { createSession, type Role } from "@/lib/auth";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const back = (error: string) => Response.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url), 303);
  if (!email || !password) return back("Enter your e-mail and password.");

  const { rows } = await pool.query("SELECT user_id, full_name, role, password_hash FROM app_user WHERE lower(email) = lower($1)", [email]);
  const user = rows[0];
  // Compare against a dummy hash when the user does not exist, so timing does not reveal accounts.
  const hash = user?.password_hash ?? "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.yQh0Yb3Qm6Xk0q3x5JcQqPpV5uKy";
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) return back("Wrong e-mail or password.");

  await createSession({ id: user.user_id, role: user.role as Role, name: user.full_name });
  return Response.redirect(new URL("/search", req.url), 303);
}
