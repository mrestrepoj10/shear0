"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * Both icons are always in the DOM, stacked in one 16 px box, and the theme
 * class decides which one is at full size and which is scaled down, blurred and
 * transparent — so the swap is a cross-fade rather than one icon being replaced
 * by another between two frames.
 *
 * Note the deliberate interaction with `disableTransitionOnChange` (do-not-touch
 * #14): next-themes injects `* { transition: none !important }` for the frame in
 * which the class flips, which is what keeps the whole page from smearing
 * through the theme change. That suppression also lands on these two icons, so
 * the cross-fade is skipped *during the toggle itself* and the icons swap
 * instantly. That is the correct trade — a smear-free theme change is worth
 * more than 300 ms on one 16 px glyph — and the structure is kept because the
 * transition still runs wherever the class changes without the guard (an OS
 * appearance change under `theme="system"`).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span className="relative size-4">
        <Sun className="absolute inset-0 size-4 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-25 dark:opacity-0 dark:blur-[4px]" />
        <Moon className="absolute inset-0 size-4 scale-25 opacity-0 blur-[4px] transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] dark:scale-100 dark:opacity-100 dark:blur-none" />
      </span>
    </Button>
  );
}
