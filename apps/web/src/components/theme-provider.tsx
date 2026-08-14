"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";

/** The computed `--background` of each theme, as the OS shell wants it. */
const THEME_COLOR = { light: "#ffffff", dark: "#0a0a0a" } as const;

/**
 * `viewport.themeColor` selects by `prefers-color-scheme`, which tracks the OS
 * — not the `.dark` class next-themes manages. When the user picks the theme
 * the OS is not in, the browser chrome would stay the OS's color; this pins
 * every `theme-color` meta to the resolved theme instead.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme === "dark" ? THEME_COLOR.dark : THEME_COLOR.light;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = color;
    }
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...props}>
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}
