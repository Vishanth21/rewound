import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { authenticate } from "@/app/actions/auth";

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; callbackUrl?: string } }) {
  if (await auth()) redirect("/search");
  return (
    <div className="login-wrap">
      <form className="card login stack" action={authenticate}>
        <div>
          <h1>Sign in</h1>
          <p className="muted small">Search every lecture you can access, by meaning.</p>
        </div>
        {searchParams.error && <div className="alert alert-error">E-mail or password is incorrect. Please try again.</div>}
        {searchParams.callbackUrl && <input type="hidden" name="redirectTo" value={searchParams.callbackUrl} />}
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
