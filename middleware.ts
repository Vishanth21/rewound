import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (pathname === "/login") {
    return user ? NextResponse.redirect(new URL("/search", req.url)) : NextResponse.next();
  }
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const role = user.role;
  const isAdminPage = pathname === "/analytics" || pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminPage && role !== "admin") return NextResponse.redirect(new URL("/search", req.url));
  if (pathname === "/requests" && role !== "student") return NextResponse.redirect(new URL("/search", req.url));
  if ((pathname === "/inbox" || pathname.startsWith("/inbox/")) && role !== "instructor" && role !== "admin") {
    return NextResponse.redirect(new URL("/search", req.url));
  }
  if ((pathname === "/instructor/courses" || pathname.startsWith("/instructor/courses/")) && role !== "instructor" && role !== "admin") {
    return NextResponse.redirect(new URL("/search", req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
