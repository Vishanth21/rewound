import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "LectureLens",
  description: "Semantic search over lecture transcripts",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user.role;
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
                {role === "instructor" && <Link href="/instructor/courses">My courses</Link>}
                {role === "admin" && <Link href="/admin/courses">Courses</Link>}
                {/* Member B adds: My requests, Inbox, Users, Enrollments, Requests, Analytics */}
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
