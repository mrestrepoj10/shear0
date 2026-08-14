/**
 * Status vocabulary shared by every result surface (summary rows, canvas,
 * charts, trace). The two accent variables `--status-ok` / `--status-ng` are the
 * only colors in the app; warning and n/a stay monochrome.
 */

import type { CheckStatus, CodeRef } from "@kern/engine";
import { fmt } from "@kern/engine";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "ok",
  ng: "ng",
  warning: "warn",
  na: "n/a",
};

/** Tailwind text color for a status, driven by the two status variables. */
export function statusText(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "text-status-ok";
    case "ng":
      return "text-status-ng";
    default:
      return "text-muted-foreground";
  }
}

function statusSurface(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "bg-status-ok/10 text-status-ok";
    case "ng":
      return "bg-status-ng/15 text-status-ng";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function StatusBadge({
  status,
  className,
}: {
  status: CheckStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      data-status={status}
      className={cn(
        "rounded-sm px-1.5 text-[11px] tracking-tight tabular-nums",
        statusSurface(status),
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** ACI reference, rendered as the mono badge used everywhere a code ref appears. */
export function RefBadge({ refer, className }: { refer: CodeRef; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={`${refer.standard} §${refer.section}${refer.eq ? ` (Eq. ${refer.eq})` : ""}`}
      className={cn(
        "rounded-sm px-1.5 font-mono text-[11px] font-normal text-muted-foreground",
        className,
      )}
    >
      {refer.section}
    </Badge>
  );
}

/** Display cap: past 1.5 the bar is pinned, the number keeps telling the truth. */
export const UTILIZATION_DISPLAY_CAP = 1.5;

export function UtilizationBar({
  utilization,
  status,
  className,
}: {
  utilization: number;
  status: CheckStatus;
  className?: string;
}) {
  const finite = Number.isFinite(utilization);
  const fraction = finite
    ? Math.max(0, Math.min(utilization, UTILIZATION_DISPLAY_CAP)) / UTILIZATION_DISPLAY_CAP
    : 1;
  const fill =
    status === "ok" ? "bg-status-ok" : status === "ng" ? "bg-status-ng" : "bg-muted-foreground";

  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuenow={finite ? Number(utilization.toFixed(3)) : undefined}
      aria-valuemin={0}
      aria-valuemax={UTILIZATION_DISPLAY_CAP}
      aria-label="utilization"
    >
      <div
        className={cn("h-full transition-[width] duration-150", fill)}
        style={{ width: `${(fraction * 100).toFixed(2)}%` }}
      />
    </div>
  );
}

/** Numbers never render as "Infinity" or "NaN" in the UI. */
export function num(value: number | undefined, dp?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return dp === undefined ? fmt(value) : fmt(value, { dp });
}
