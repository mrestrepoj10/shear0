import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DISCLAIMER } from "@/lib/copy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const REPO = "https://github.com/mrestrepoj10/kern";

const DESCRIPTION = "Shear wall design, per ACI 318-19.";

/**
 * Where the site is served from — the base every relative metadata URL is
 * resolved against (OG/Twitter images, canonicals). It is a *deploy* fact, not
 * a repository fact, so it comes from the environment; the fallback is a
 * localhost origin so a local build produces absolute URLs that at least parse
 * instead of Next warning on every page. Set `NEXT_PUBLIC_SITE_URL` to the real
 * origin (e.g. https://kern.example.com) wherever this is deployed.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // `default` for the root, `template` for everything under it: the tab used to
  // read a bare "design" / "learn" with no idea what app they belonged to.
  title: { default: "kern", template: "%s · kern" },
  description: DESCRIPTION,
  applicationName: "kern",
  // No `url` or `title` here: child routes inherit this whole object, so a
  // root-specific URL/title would make every shared /design or /learn link
  // preview as the homepage. Each falls back to the page's own resolved value.
  openGraph: {
    type: "website",
    siteName: "kern",
    description: DESCRIPTION,
  },
};

/**
 * The browser chrome follows the theme.
 *
 * Both values are the computed `--background`: `oklch(1 0 0)` is #ffffff, and
 * `oklch(0.145 0 0)` is #0a0a0a — 0.145³ = 0.00304862 linear, below the sRGB
 * transfer knee, so 12.92 × that × 255 = 10.04 → 0x0a. Written as hex because
 * `meta[name=theme-color]` is parsed by the OS shell, not the page.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/**
 * The engineering disclaimer, on every page. Deliberately quiet — an engineer
 * should not have to dismiss it — but never absent: kern produces calculations
 * that a licensed engineer has to own.
 */
function Footer() {
  return (
    <footer className="mt-16 border-t border-border">
      {/* `bleed-inline`: the footer is full-bleed, so in landscape on a notched
          phone the disclaimer would otherwise run under the cutout. */}
      <div className="bleed-inline mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 py-4 text-xs text-muted-foreground">
        <span>{DISCLAIMER}</span>
        <span aria-hidden="true">·</span>
        <a
          href={`${REPO}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer"
          className="transition-colors duration-150 hover:text-foreground"
        >
          MIT
        </a>
        <span aria-hidden="true">·</span>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="transition-colors duration-150 hover:text-foreground"
        >
          github
        </a>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-mono bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* First tab stop on every page: five pieces of chrome sit ahead of
              the content otherwise. Hidden until it is focused. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
          >
            skip to content
          </a>
          {/* One provider for every tooltip on the page. 400 ms is long enough
              that reading past a code ref never summons one, and the provider's
              grouping means that once one is open the next opens instantly —
              which is what a screen with fifteen `RefBadge`s needs. */}
          <TooltipProvider delay={400}>
            <Navbar />
            <main id="main" tabIndex={-1} className="flex-1 scroll-mt-16 outline-none">
              {children}
            </main>
            <Footer />
          </TooltipProvider>
          {/* One toaster for the whole app; see `ui/sonner.tsx` for the rules. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
