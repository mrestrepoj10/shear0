import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "kern",
  description: "Shear wall design, per ACI 318-19.",
};

const REPO = "https://github.com/mrestrepoj10/kern";

/**
 * The engineering disclaimer, on every page. Deliberately quiet — an engineer
 * should not have to dismiss it — but never absent: kern produces calculations
 * that a licensed engineer has to own.
 */
function Footer() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-4 text-xs text-muted-foreground">
        <span>for engineering review — verify every result with a licensed engineer</span>
        <span aria-hidden="true">·</span>
        <a
          href={`${REPO}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground"
        >
          MIT
        </a>
        <span aria-hidden="true">·</span>
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-foreground">
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
          <Navbar />
          <main id="main" tabIndex={-1} className="flex-1 scroll-mt-16 outline-none">
            {children}
          </main>
          <Footer />
          {/* One toaster for the whole app; see `ui/sonner.tsx` for the rules. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
