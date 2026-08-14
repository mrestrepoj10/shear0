"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const links = [
  { href: "/design", label: "design" },
  { href: "/learn", label: "learn" },
];

/**
 * A client component for exactly one reason: the nav had no idea which page you
 * were on. `usePathname` gives it `aria-current="page"` and the resting-state
 * colour that goes with it — /learn/sbe-detailing still lights "learn", so the
 * section stays marked while you are inside it.
 */
export function Navbar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-6 px-4">
        <Link
          href="/"
          className="py-1.5 text-sm font-semibold tracking-tight"
          {...(pathname === "/" ? { "aria-current": "page" as const } : {})}
        >
          kern
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                {...(active ? { "aria-current": "page" as const } : {})}
                className={cn(
                  "py-1.5 transition-colors duration-150 hover:text-foreground",
                  active && "text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/mrestrepoj10/kern"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            github
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
