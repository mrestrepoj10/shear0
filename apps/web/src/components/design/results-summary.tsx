"use client";

/**
 * The check summary: one row per `CheckResult`, wall-level checks first, then a
 * block per load case. Every row reads demand → capacity → utilization straight
 * off the engine's traced nodes, so what is printed here is exactly what the
 * trace report (T2c) will expand.
 */

import type { CheckResult, CheckStatus, Demands, WallReport, Traced } from "@kern/engine";
import { fmt } from "@kern/engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefBadge, StatusBadge, UtilizationBar, statusText } from "@/components/design/status";
import { cn } from "@/lib/utils";

function valueText(node: Traced | undefined): string | null {
  if (node === undefined) return null;
  const value = node.value;
  if (typeof value !== "number") return `${node.symbol} ${String(value)}`;
  if (!Number.isFinite(value)) return `${node.symbol} —`;
  const unit = node.unit === "1" ? "" : ` ${node.unit}`;
  return `${node.symbol} ${fmt(value)}${unit}`;
}

/** The check driving the design: highest finite utilization, ties broken by severity. */
export interface Governing {
  check: CheckResult;
  demand: Demands | null;
  utilization: number;
}

const SEVERITY: Record<CheckStatus, number> = { na: 0, ok: 1, warning: 2, ng: 3 };

/**
 * Counting checks report utilization = required/provided over integers, so a
 * satisfied one sits at exactly 1.00 and would always claim to govern. They
 * still surface as rows (and still drive the verdict when they fail) — they
 * just do not win the "governing check" slot while they pass.
 */
const DISCRETE_CHECKS = new Set(["detailing.curtains"]);

export function governingCheck(report: WallReport): Governing | null {
  const entries: Governing[] = [
    ...report.general.map((check) => ({ check, demand: null })),
    ...report.perDemand.flatMap((group) =>
      group.checks.map((check) => ({ check, demand: group.demand })),
    ),
  ]
    .filter((entry) => entry.check.status !== "na")
    .filter((entry) => entry.check.status !== "ok" || !DISCRETE_CHECKS.has(entry.check.id))
    .map((entry) => ({
      ...entry,
      utilization: entry.check.utilization?.value ?? 0,
    }))
    .filter((entry) => Number.isFinite(entry.utilization));

  if (entries.length === 0) return null;
  return entries.reduce((worst, entry) => {
    const bySeverity = SEVERITY[entry.check.status] - SEVERITY[worst.check.status];
    if (bySeverity !== 0) return bySeverity > 0 ? entry : worst;
    return entry.utilization > worst.utilization ? entry : worst;
  });
}

/**
 * Titles read lowercase like the rest of the chrome; symbol pairs stay upper.
 *
 * The §18.10 checks arrive with prose titles that are accurate but long for a
 * row that also carries a badge, a ref and a number, so they get a shorter form
 * here. Anything unmapped simply lowercases, which is what every Chapter 11
 * title has always done.
 */
const TITLE_OVERRIDES: Record<string, string> = {
  "Special wall web reinforcement": "web reinforcement (18.10.2)",
  "Special wall in-plane shear strength": "in-plane shear strength (Ve)",
  "Special boundary element — requirement": "SBE required?",
  "Special boundary element — detailing": "SBE detailing",
  "Boundary reinforcement — no special boundary element required": "boundary ties — no SBE required",
  "Boundary reinforcement — 18.10.6.5(b) ties required": "boundary ties (18.10.6.5b)",
};

export function checkTitle(title: string): string {
  const mapped = TITLE_OVERRIDES[title];
  if (mapped !== undefined) return mapped;
  return title.toLowerCase().replace(/\bp–m\b/g, "P–M").replace(/\baci\b/g, "ACI");
}

const VERDICT_TEXT: Record<CheckStatus, string> = {
  ok: "all checks pass",
  ng: "check fails",
  warning: "passes with warnings",
  na: "nothing to check",
};

/**
 * A wall carrying no load at all: every check that needs a demand passes on
 * zero, and the strip used to call that "ok — all checks pass". It is not a
 * passing design, it is an unasked question, so it reads as n/a and says what
 * to do. The rows below stay exactly as the engine computed them.
 */
function hasNoLoads(report: WallReport): boolean {
  return report.perDemand.every(
    ({ demand }) =>
      demand.Pu === 0 &&
      demand.Mu === 0 &&
      demand.Vu === 0 &&
      (demand.MuOut ?? 0) === 0 &&
      (demand.VuOut ?? 0) === 0,
  );
}

export function VerdictStrip({ report }: { report: WallReport }) {
  const governing = governingCheck(report);
  const total =
    report.general.length + report.perDemand.reduce((n, group) => n + group.checks.length, 0);
  // A real failure always wins the strip: an ng that does not depend on the
  // demands (detailing, ρ_min) is still an ng, loads or no loads.
  const unloaded = report.status !== "ng" && hasNoLoads(report);
  const status = unloaded ? "na" : report.status;

  return (
    <div className="sticky top-12 z-30 -mx-4 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} className="h-6 px-2 text-xs" />
          <span className={cn("text-sm", statusText(status))}>
            {unloaded ? "no loads applied — enter a load case" : VERDICT_TEXT[report.status]}
          </span>
          <span className="text-xs text-muted-foreground">
            {total} check{total === 1 ? "" : "s"}
          </span>
        </div>
        {governing === null ? null : (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">governing</span>
            <span className="truncate text-foreground">
              {checkTitle(governing.check.title)}
              {governing.demand === null
                ? ""
                : ` · ${governing.demand.label ?? governing.demand.id}`}
            </span>
            <RefBadge refer={governing.check.ref} />
            <span className={cn("tabular-nums", statusText(governing.check.status))}>
              {fmt(governing.utilization, { dp: 2 })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * demand → capacity where the check has both (φVn vs Vu); otherwise the
 * utilization node speaks for itself (ratio checks like spacing and ρ_min).
 */
function ratioLine(check: CheckResult): string {
  const demand = valueText(check.demand);
  const capacity = valueText(check.capacity);
  if (demand !== null && capacity !== null) return `${demand} / ${capacity}`;
  const utilization = check.utilization;
  if (utilization !== undefined && Number.isFinite(utilization.value)) {
    return `${utilization.symbol} = ${fmt(utilization.value, { dp: 3 })}`;
  }
  if (demand !== null) return demand;
  return check.status === "na" ? "not applicable" : "";
}

function CheckRow({ check }: { check: CheckResult }) {
  const utilization = check.utilization?.value;
  const finite = utilization !== undefined && Number.isFinite(utilization);

  return (
    <li className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <StatusBadge status={check.status} />
        <span className="min-w-0 flex-1 truncate text-sm">{checkTitle(check.title)}</span>
        <RefBadge refer={check.ref} />
        <span
          className={cn(
            "w-10 shrink-0 text-right text-xs tabular-nums",
            statusText(check.status),
          )}
        >
          {finite ? fmt(utilization, { dp: 2 }) : "—"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {ratioLine(check)}
        </span>
      </div>
      <UtilizationBar
        utilization={utilization ?? 0}
        status={check.status}
        className="mt-0.5"
      />
    </li>
  );
}

function CheckList({
  title,
  subtitle,
  checks,
}: {
  title: string;
  subtitle?: string;
  checks: CheckResult[];
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
            {title}
          </CardTitle>
          {subtitle === undefined ? null : (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="flex flex-col">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function demandSummary(demand: Demands): string {
  const parts = [
    `Pu ${fmt(demand.Pu)} kip`,
    `Mu ${fmt(demand.Mu)} kip-ft`,
    `Vu ${fmt(demand.Vu)} kip`,
  ];
  return parts.join(" · ");
}

export function ResultsSummary({ report }: { report: WallReport }) {
  return (
    <div className="flex flex-col gap-3">
      <CheckList title="wall" checks={report.general} />
      {report.perDemand.map((group) => (
        <CheckList
          key={group.demand.id}
          title={group.demand.label ?? group.demand.id}
          subtitle={demandSummary(group.demand)}
          checks={group.checks}
        />
      ))}
    </div>
  );
}
