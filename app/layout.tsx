import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { withUser } from "@/lib/db";
import NavLinks from "@/app/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rewound",
  description: "Rewound searches across uploaded lectures by meaning and returns timestamped passages similar to your query.",
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
              Rewound
            </Link>
            {session && <NavLinks items={[
              { href: "/search", label: "Search" },
              ...(role === "student" ? [{ href: "/courses", label: "My courses" }] : []),
              ...(role === "student" ? [{ href: "/requests", label: "My requests" }] : []),
              ...(role === "instructor" ? [{ href: "/instructor/courses", label: "My courses" }] : []),
              ...(role === "instructor" || role === "admin" ? [{ href: "/inbox", label: "Inbox", badge: pending }] : []),
              ...(role === "admin" ? [
                { href: "/admin/courses", label: "Courses" },
                { href: "/admin/users", label: "Users" },
                { href: "/admin/enrollments", label: "Enrollments" },
                { href: "/admin/requests", label: "Requests" },
                { href: "/analytics", label: "Analytics" },
              ] : []),
            ]} />}
            {session && (
              <div className="who">
                <span>{session.user.name}</span>
                <span className="role-chip">{role}</span>
                <form action={logout}>
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
