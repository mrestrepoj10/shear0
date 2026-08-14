"use client";

/**
 * In-plane shear, one row per load case: the design shear against φVn.
 *
 * The engine already did the arithmetic — for ordinary walls the check is
 * `shear.in-plane` (§11.5.4), for special walls `sw.in-plane-shear` (§18.10.4),
 * whose demand is the amplified Ωv-scaled Ve, not the raw Vu. This panel only
 * re-plots `check.demand` against `check.capacity`, so whatever amplification
 * the code path applied is what the bars show.
 *
 * φVn almost never varies by load case — the capacity side of both checks
 * depends on the section, not the demand — so the usual picture is demand bars
 * against a single dashed capacity rule. Capacity bars per case appear only
 * when the capacities actually differ (beyond 0.1%), which keeps the common
 * chart down to one bar per case instead of two.
 */

import { fmt, type CheckStatus, type WallInput, type WallReport } from "@kern/engine";
import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart,
  type BarCategory,
  type BarFocus,
  type BarRule,
} from "@/components/charts/bar-chart";
import { ChartExportButtons } from "@/components/design/chart-export";
import { num, STATUS_LABEL, statusText } from "@/components/design/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const X_AXIS = {
  label: "V  (kip)",
  format: (value: number) => fmt(value, { dp: 0 }),
} as const;

/** φVn spread below this is measurement noise, not a per-case capacity. */
const CAPACITY_TOLERANCE = 0.001;

interface CaseMeta {
  status: CheckStatus;
  Vu: number | undefined;
  phiVn: number | undefined;
  utilization: number | undefined;
}

interface ShearView {
  /** true when the found checks are the sw.* special-wall path */
  special: boolean;
  cases: readonly (CaseMeta & { id: string; label: string })[];
  /** the single φVn all cases share, when they do */
  uniformCapacity: number | null;
  categories: readonly BarCategory<CaseMeta>[];
  rules: readonly BarRule[];
  /** the case with the highest utilization — what the readout shows unfocused */
  governing: (CaseMeta & { id: string; label: string }) | null;
}

function build(report: WallReport): ShearView | null {
  let special = false;
  const cases: (CaseMeta & { id: string; label: string })[] = [];

  for (const group of report.perDemand) {
    const check = group.checks.find(
      (c) => c.id === "sw.in-plane-shear" || c.id === "shear.in-plane",
    );
    if (check === undefined) continue;
    if (check.id === "sw.in-plane-shear") special = true;
    cases.push({
      id: group.demand.id,
      label: group.demand.label ?? group.demand.id,
      status: check.status,
      // The check's demand node keeps the signed V_u for the trace; the bar
      // plots the magnitude the utilization actually compares.
      Vu: check.demand === undefined ? undefined : Math.abs(check.demand.value),
      phiVn: check.capacity?.value,
      utilization: check.utilization?.value,
    });
  }
  if (cases.length === 0) return null;

  const capacities = cases
    .map((c) => c.phiVn)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const first = capacities[0];
  const uniform =
    first !== undefined &&
    capacities.length === cases.length &&
    capacities.every((value) => Math.abs(value - first) <= CAPACITY_TOLERANCE * Math.abs(first));

  const demandLabel = special ? "Ve" : "Vu";
  const categories: BarCategory<CaseMeta>[] = cases.map((c) => {
    const meta: CaseMeta = {
      status: c.status,
      Vu: c.Vu,
      phiVn: c.phiVn,
      utilization: c.utilization,
    };
    return {
      id: c.id,
      label: c.label,
      bars: [
        {
          id: "demand",
          label: demandLabel,
          value: c.Vu ?? Number.NaN,
          token: c.status === "ng" ? ("ng" as const) : ("line" as const),
          meta,
        },
        // capacity bars only when a single rule cannot stand for all of them
        ...(uniform
          ? []
          : [
              {
                id: "capacity",
                label: "φVn",
                value: c.phiVn ?? Number.NaN,
                token: "muted" as const,
                meta,
              },
            ]),
      ],
    };
  });

  const rules: BarRule[] = uniform
    ? [{ value: first, label: "φVn", token: "muted", dashed: true }]
    : [];

  let governing: (CaseMeta & { id: string; label: string }) | null = null;
  for (const c of cases) {
    const u = c.utilization;
    if (u === undefined || !Number.isFinite(u)) continue;
    if (governing === null || u > (governing.utilization ?? Number.NEGATIVE_INFINITY)) {
      governing = c;
    }
  }

  return {
    special,
    cases,
    uniformCapacity: uniform ? first : null,
    categories,
    rules,
    governing: governing ?? cases[0] ?? null,
  };
}

/**
 * `memo` for the same reason as <InteractionChart>: the workspace passes a
 * deferred wall, and rebuilding the bar scene is only worth it once the number
 * being typed has settled.
 */
export const ShearPanel = memo(function ShearPanel({
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const view = useMemo(() => build(report), [report]);
  const [focus, setFocus] = useState<BarFocus<CaseMeta> | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  if (view === null) return null;

  const demandSymbol = view.special ? (
    <>
      V<sub>e</sub>
    </>
  ) : (
    <>
      V<sub>u</sub>
    </>
  );

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            in-plane shear
          </CardTitle>
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-xs2 text-muted-foreground">
              {view.special ? "ACI 318-19 §18.10.4" : "ACI 318-19 §11.5.4"}
            </span>
            <ChartExportButtons containerRef={plotRef} filename="in-plane-shear" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div ref={plotRef}>
          <BarChart<CaseMeta>
            ariaLabel="in-plane shear demand against capacity"
            ariaDescription={
              view.special
                ? "Amplified design shear Ve per load case against the wall's φVn."
                : "Factored shear Vu per load case against the wall's φVn."
            }
            categories={view.categories}
            rules={view.rules}
            x={X_AXIS}
            height={Math.min(320, Math.max(160, 84 + 44 * view.cases.length))}
            onFocusChange={setFocus}
          />
        </div>

        <ChartSummary view={view} />

        <Readout view={view} focus={focus} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
          {view.cases.some((c) => c.status !== "ng") ? (
            <BarKey className="bg-foreground">
              {demandSymbol}
              <span>&nbsp;demand</span>
            </BarKey>
          ) : null}
          {view.cases.some((c) => c.status === "ng") ? (
            <BarKey className="bg-status-ng">
              {demandSymbol}
              <span>&nbsp;demand over capacity</span>
            </BarKey>
          ) : null}
          {view.uniformCapacity === null ? (
            <BarKey className="bg-muted-foreground">φVn</BarKey>
          ) : (
            <RuleKey>φVn — same for every case</RuleKey>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * The picture, in words and numbers — same reasoning as in
 * `interaction-chart.tsx`: `role="img"` flattens the plot's subtree, so the
 * data behind it is written out here, one row per load case.
 */
function ChartSummary({ view }: { view: ShearView }) {
  const symbol = view.special ? "Ve" : "Vu";
  return (
    <div className="sr-only">
      <p>
        In-plane shear check per {view.special ? "ACI 318-19 section 18.10.4" : "ACI 318-19 section 11.5.4"}
        .{" "}
        {view.uniformCapacity === null
          ? "The shear capacity differs between load cases, so each case shows its own capacity bar."
          : `Every load case shares the same capacity, phi Vn = ${num(view.uniformCapacity)} kip, drawn as one dashed rule.`}{" "}
        {view.special ? "The demand is the amplified design shear Ve." : ""}
      </p>
      <table>
        <caption>Design shear against capacity, per load case</caption>
        <thead>
          <tr>
            <th scope="col">load case</th>
            <th scope="col">{symbol} (kip)</th>
            <th scope="col">φVn (kip)</th>
            <th scope="col">{symbol} / φVn</th>
            <th scope="col">result</th>
          </tr>
        </thead>
        <tbody>
          {view.cases.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.label}</th>
              <td>{num(c.Vu)}</td>
              <td>{num(c.phiVn)}</td>
              <td>{num(c.utilization, 3)}</td>
              <td>{STATUS_LABEL[c.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Fixed-height readout so hovering never reflows the page. With no focus it
 * reads the governing case — the row the check is decided by.
 */
function Readout({ view, focus }: { view: ShearView; focus: BarFocus<CaseMeta> | null }) {
  const shown =
    focus?.meta === undefined
      ? view.governing === null
        ? null
        : { label: view.governing.label, meta: view.governing, prefix: "governing — " }
      : { label: focus.categoryLabel, meta: focus.meta, prefix: "" };

  if (shown === null) {
    return (
      <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4 text-muted-foreground">
        no in-plane shear checks to read
        <br />
        hover or focus the chart to read a bar
      </p>
    );
  }

  const sym = view.special ? "e" : "u";
  return (
    <p aria-live="polite" className="min-h-8 font-mono text-xs2 leading-4">
      <span className="text-muted-foreground">{shown.prefix}</span>
      <span className={statusText(shown.meta.status)}>{shown.label}</span>{" "}
      <span className="text-muted-foreground">
        V<sub>{sym}</sub> = {num(shown.meta.Vu)} kip · φV<sub>n</sub> = {num(shown.meta.phiVn)} kip
      </span>
      <br />
      <span className="text-muted-foreground">
        V<sub>{sym}</sub>/φV<sub>n</sub> ={" "}
      </span>
      <span className={statusText(shown.meta.status)}>
        {num(shown.meta.utilization, 3)} — {STATUS_LABEL[shown.meta.status]}
      </span>
    </p>
  );
}

/** A legend key shaped like the bars it stands for. */
function BarKey({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-4 rounded-[2px]", className)} />
      <span className="flex items-baseline">{children}</span>
    </span>
  );
}

/** A legend key shaped like the dashed capacity rule. */
function RuleKey({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          className="text-muted-foreground"
        />
      </svg>
      {children}
    </span>
  );
}
