"use client";

/**
 * KaTeX in one place.
 *
 * **SSR decision:** `katex.renderToString` is a pure, deterministic function of
 * its input — no ids, no measurement, no `window` — so the server and the client
 * produce byte-identical markup and the math is rendered *during* SSR rather
 * than after mount. That means no flash of raw LaTeX, no layout shift, and no
 * `useEffect` gate. (The alternative — render after mount with a text fallback —
 * is only needed for libraries that touch the DOM at render time; KaTeX does
 * not.) The stylesheet is imported here so it travels with the only component
 * that needs it.
 */

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Engine symbols are a mix of LaTeX (`\rho_{\ell,min}`), bare Unicode (`α_c`,
 * `√f'_c`) and occasional prose (`ties req'd`). Prose has no business going
 * through a math renderer — it comes out italicised and mis-spaced — so only
 * strings that actually look like math are typeset.
 */
const MATHY = /[\\^{}_]|[α-ωΑ-Ω√∑∫≤≥≠·ℓφρσλβεπΔΩ]/u;

function looksLikeMath(source: string): boolean {
  return MATHY.test(source);
}

function render(source: string, display: boolean): string | null {
  if (!looksLikeMath(source)) return null;
  try {
    return katex.renderToString(source, {
      displayMode: display,
      throwOnError: false,
      // Errors stay monochrome: the app has exactly two colors and neither is
      // for a typesetting failure.
      errorColor: "currentColor",
      strict: false,
      trust: false,
      output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
}

export interface TexProps {
  children: string;
  /** display math (own line, larger operators) rather than inline */
  display?: boolean;
  className?: string;
}

export function Tex({ children, display = false, className }: TexProps) {
  const html = useMemo(() => render(children, display), [children, display]);

  if (html === null) {
    return <span className={cn("font-mono", className)}>{children}</span>;
  }

  return (
    <span
      className={cn(display ? "block" : "inline-block", className)}
      // Input is engine-authored LaTeX, and KaTeX escapes what it emits.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
