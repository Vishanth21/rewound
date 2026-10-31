// STAND-IN for Member B's /login page (design plan section 14). Posts to the stand-in
// /api/dev-login route; B replaces both with the Auth.js credentials flow.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (await auth()) redirect("/search");
  return (
    <div className="login-wrap">
      <form className="card login stack" action="/api/dev-login" method="post">
        <div>
          <h1>Sign in</h1>
          <p className="muted small">Search every lecture you can access, by meaning.</p>
        </div>
        {searchParams.error && <div className="alert alert-error">{searchParams.error}</div>}
        <label>
          <span>E-mail</span>
          <input type="email" name="email" autoComplete="username" required autoFocus />
        </label>
        <label>
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
