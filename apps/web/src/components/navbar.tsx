import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/design", label: "design" },
  { href: "/learn", label: "learn" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-6 px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          kern
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a
            href="https://github.com/mrestrepoj10/kern"
            target="_blank"
            rel="noreferrer"
            className="px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            github
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
