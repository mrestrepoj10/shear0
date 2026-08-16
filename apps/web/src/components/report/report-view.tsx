"use client";

/**
 * The calc sheet: the report spec rendered through `@json-render/react`.
 *
 * The registry maps the report catalog onto the pieces the design page already
 * has (KaTeX, status badges, utilization bars), so a quantity reads here
 * exactly as it reads in the trace panel. The page is built to be printed —
 * the toolbar is `print:hidden`, sections avoid page breaks inside a check —
 * so "Export PDF" is `window.print()` for the browser route and a link to
 * `/api/report/pdf` for the rendered document.
 *
 * `<Renderer>` must sit inside `<JSONUIProvider>`: every element the renderer
 * walks is checked for a `visible` condition, and that lookup calls
 * `useVisibility()`, which throws outside the provider. Our specs carry no
 * conditions and no state, but the check runs regardless — so the provider is
 * mandatory, not optional, and rendering without it threw
 * "useVisibility must be used within a VisibilityProvider" on the server and
 * turned the whole route into a 500.
 */

import type { Spec } from "@json-render/core";
import { JSONUIProvider, defineRegistry, Renderer } from "@json-render/react";
import type { CheckStatus } from "@shear0/engine";
import { StatusBadge, UtilizationBar, num } from "@/components/design/status";
import { Tex } from "@/components/design/tex";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { reportCatalog } from "@/lib/report/catalog";
import { cn } from "@/lib/utils";

const { registry } = defineRegistry(reportCatalog, {
  components: {
    Report: ({ children }) => (
      <div className="flex flex-col gap-6 print:gap-4">{children}</div>
    ),
    ReportHeader: ({ props }) => (
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-mono text-lg font-medium tracking-tight">{props.title}</h1>
          <StatusBadge status={props.status as CheckStatus} className="text-xs" />
        </div>
        <p className="font-mono text-xs2 text-muted-foreground">{props.subtitle}</p>
        <p className="font-mono text-2xs text-muted-foreground">
          generated {props.generatedAt} ·{" "}
          <a href={props.link} className="underline underline-offset-2 break-all">
            {props.link}
          </a>
        </p>
      </header>
    ),
    Section: ({ props, children }) => (
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
          {props.title}
        </h2>
        {children}
      </section>
    ),
    KeyValueGrid: ({ props }) => (
      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {(props.rows as [string, string][]).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-xs2 text-muted-foreground">{label}</dt>
            <dd className="text-right font-mono text-xs2 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    ),
    CheckBlock: ({ props, children }) => (
      <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10 break-inside-avoid print:ring-foreground/25">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">{props.title}</h3>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xs text-muted-foreground">
              {props.section}
              {props.eq === null ? "" : ` (Eq. ${props.eq})`}
            </span>
            <StatusBadge status={props.status as CheckStatus} />
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-1">{children}</div>
      </div>
    ),
    Quantity: ({ props }) => (
      <div
        className="flex items-baseline justify-between gap-3"
        style={{ paddingLeft: `${Math.min(props.depth as number, 6) * 12}px` }}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <Tex className="text-xs2">{props.symbol as string}</Tex>
          <span className="truncate font-mono text-2xs text-muted-foreground">
            {props.label as string}
            {props.note === null ? "" : ` — ${props.note}`}
          </span>
        </span>
        <span
          className={cn(
            "font-mono text-xs2 tabular-nums whitespace-nowrap",
            props.status === "ng" ? "text-status-ng" : undefined,
          )}
        >
          {props.value as string}
        </span>
      </div>
    ),
    Formula: ({ props }) => (
      <div
        className="flex flex-col gap-0.5 py-0.5 text-muted-foreground"
        style={{ paddingLeft: `${(Math.min(props.depth as number, 6) + 1) * 12}px` }}
      >
        <Tex className="text-xs2">{props.formula as string}</Tex>
        <Tex className="text-2xs">{props.substitution as string}</Tex>
      </div>
    ),
    Utilization: ({ props }) => (
      <div className="flex items-center gap-3 pb-1">
        <UtilizationBar
          utilization={props.value as number}
          status={props.status as CheckStatus}
          className="max-w-64"
        />
        <span className="font-mono text-2xs text-muted-foreground">
          utilization {num(props.value as number, 3)}
        </span>
      </div>
    ),
  },
});

export function ReportView({ spec, encoded }: { spec: Spec; encoded: string }) {
  const pdfHref = `/api/report/pdf?w=${encoded}`;
  const designHref = `/design?w=${encoded}`;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16">
      <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" render={<a href={designHref} />}>
          ← back to design
        </Button>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(window.location.href)
              .then(() => notify({ id: "report-link", title: "link copied" }));
          }}
        >
          copy link
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          print
        </Button>
        <Button size="sm" render={<a href={pdfHref} download="shear0-calc-sheet.pdf" />}>
          download pdf
        </Button>
      </div>

      <JSONUIProvider registry={registry}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
