"use client";

/**
 * Every check on one ruler. The summary cards answer "did this pass?"; this
 * answers "what is close to the edge?" — one hairline bar per check, wall
 * checks first, then a row per load case, governing check emphasized.
 */

import { fmt, type CheckResult, type WallReport } from "@kern/engine";
import { checkTitle, governingCheck } from "@/components/design/results-summary";
import { RefBadge, StatusBadge, UtilizationBar, statusText } from "@/components/design/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Row {
  key: string;
  check: CheckResult;
  scope: string;
  /** absent where the check reports no ratio (a pass/fail rule) */
  utilization: number | undefined;
}

function rows(report: WallReport): Row[] {
  const wall = report.general.map<Row>((check) => ({
    key: `wall:${check.id}`,
    check,
    scope: "wall",
    utilization: check.utilization?.value,
  }));
  const perDemand = report.perDemand.flatMap((group) =>
    group.checks.map<Row>((check) => ({
      key: `${group.demand.id}:${check.id}`,
      check,
      scope: group.demand.label ?? group.demand.id,
      utilization: check.utilization?.value,
    })),
  );
  return [...wall, ...perDemand].filter((row) => row.check.status !== "na");
}

export function UtilizationList({ report }: { report: WallReport }) {
  const all = rows(report);
  const governing = governingCheck(report);
  const governingKey =
    governing === null
      ? null
      : `${governing.demand === null ? "wall" : governing.demand.id}:${governing.check.id}`;

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            utilization
          </CardTitle>
          {/* Not every row is a demand / capacity ratio — spacing and ρ_min
              checks report a ratio of their own — so the subtitle names what
              the column actually holds. */}
          <span className="font-mono text-xs2 text-muted-foreground">
            {all.length} check{all.length === 1 ? "" : "s"} · utilization
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="flex flex-col">
          {all.map((row) => {
            const finite = row.utilization !== undefined && Number.isFinite(row.utilization);
            const isGoverning = row.key === governingKey;
            return (
              <li
                key={row.key}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_120px_3rem] items-center gap-x-3 px-3 py-1.5",
                  isGoverning && "bg-muted/50",
                )}
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  {/* Pass is neutral here, so a failing or warned row cannot be
                      found by colour alone. The badge says the word, exactly as
                      the summary and trace rows do. */}
                  {row.check.status === "ok" ? null : (
                    <StatusBadge status={row.check.status} className="shrink-0 self-center" />
                  )}
                  <span
                    title={checkTitle(row.check.title)}
                    className={cn(
                      "min-w-0 truncate text-sm2",
                      isGoverning ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {checkTitle(row.check.title)}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                    {row.scope}
                  </span>
                  <RefBadge refer={row.check.ref} className="shrink-0" />
                </div>
                {finite ? (
                  <UtilizationBar
                    utilization={row.utilization}
                    status={row.check.status}
                    className={isGoverning ? "h-1.5" : undefined}
                  />
                ) : (
                  <div className="h-1" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    "text-right font-mono text-xs2 tabular-nums",
                    statusText(row.check.status),
                    isGoverning && "font-medium",
                  )}
                >
                  {finite ? fmt(row.utilization as number, { dp: 2 }) : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
