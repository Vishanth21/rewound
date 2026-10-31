import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { withUser } from "@/lib/db";
import "./globals.css";

export const metadata: Metadata = {
  title: "LectureLens",
  description: "Semantic search over lecture transcripts",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user.role;

  // Badge count for the Inbox link. Only approvers have an inbox, and my_pending_requests()
  // is SECURITY DEFINER and already scoped to this user, so the number matches exactly
  // what /inbox lists. Wrapped in try/catch: a header badge must never break the page.
  let pending = 0;
  if (session && (role === "instructor" || role === "admin")) {
    try {
      const rows = await withUser(session.user.id, async (c) =>
        (await c.query("SELECT count(*)::int AS n FROM my_pending_requests()")).rows,
      );
      pending = rows[0]?.n ?? 0;
    } catch {
      pending = 0;
    }
  }

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/search" className="logo">
              Lecture<span>Lens</span>
            </Link>
            {session && (
              <nav className="nav">
                <Link href="/search">Search</Link>
                {role === "student" && <Link href="/requests">My requests</Link>}
                {role === "instructor" && <Link href="/instructor/courses">My courses</Link>}
                {(role === "instructor" || role === "admin") && (
                  <Link href="/inbox" className="nav-badge-link">
                    Inbox
                    {pending > 0 && <span className="badge">{pending}</span>}
                  </Link>
                )}
                {role === "admin" && <Link href="/admin/courses">Courses</Link>}
                {role === "admin" && <Link href="/admin/users">Users</Link>}
                {role === "admin" && <Link href="/admin/enrollments">Enrollments</Link>}
                {role === "admin" && <Link href="/admin/requests">Requests</Link>}
                {role === "admin" && <Link href="/analytics">Analytics</Link>}
              </nav>
            )}
            {session && (
              <div className="who">
                <span>{session.user.name}</span>
                <span className="role-chip">{role}</span>
                <form action="/api/logout" method="post">
                  <button className="link-btn" type="submit">Sign out</button>
                </form>
              </div>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
