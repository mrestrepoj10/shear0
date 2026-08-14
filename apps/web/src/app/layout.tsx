import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Navbar } from "@/components/navbar";

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
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
