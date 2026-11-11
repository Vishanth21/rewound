"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; badge?: number };

export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Main navigation">
      {items.map(({ href, label, badge }) => {
        const active = href === "/search"
          ? pathname === href || pathname.startsWith("/lectures/")
          : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            className={`${badge ? "nav-badge-link" : ""}${active ? " active" : ""}`.trim()}
            aria-current={active ? "page" : undefined}
          >
            {label}
            {badge ? <span className="badge">{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
