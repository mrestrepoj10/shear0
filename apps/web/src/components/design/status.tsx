/**
 * Status vocabulary shared by every result surface (summary rows, canvas,
 * charts, trace).
 *
 * Saturation means *failure*, and nothing else. A passing wall used to render
 * ~45 green elements — a colour with 100% coverage carries no information, and
 * ok/ng separated by hue alone measure 1.21:1 under deuteranopia, so on a
 * mixed wall the green was also the thing making the red hard to find. Pass is
 * therefore neutral (`text-foreground`), warning and n/a stay monochrome and
 * differ by a ring, and `--status-ng` is the only accent that reaches the page.
 *
 * Colour is never the only carrier: every status renders its word through
 * `STATUS_LABEL` (badge or `data-status`), and in the charts ng also differs by
 * shape.
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

/** Tailwind text color for a status: failure is coloured, everything else is not. */
export function statusText(status: CheckStatus): string {
  switch (status) {
    case "ng":
      return "text-status-ng";
    case "ok":
      return "text-foreground";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Badge surfaces. `warning` used to be byte-identical to `na` — "passes with
 * warnings" and "nothing to check" are not the same sentence — so it now carries
 * a ring and full-strength text (also lifting it from 4.34:1 to ≈19.8:1).
 */
function statusSurface(status: CheckStatus): string {
  switch (status) {
    case "ng":
      return "bg-status-ng/15 text-status-ng";
    case "ok":
      return "bg-muted text-foreground";
    case "warning":
      return "bg-muted text-foreground ring-1 ring-foreground/20";
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
        "rounded-sm px-1.5 text-xs2 tracking-tight tabular-nums",
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
        "rounded-sm px-1.5 font-mono text-xs2 font-normal text-muted-foreground",
        className,
      )}
    >
      {refer.section}
    </Badge>
  );
}

/** Display cap: past 1.5 the bar is pinned, the number keeps telling the truth. */
export const UTILIZATION_DISPLAY_CAP = 1.5;

/**
 * One check on the ruler — or nothing at all.
 *
 * A check with no ratio (a pass/fail rule, or a capacity of zero) has no meter
 * to draw: the old empty track read as "0% utilised", and `role="meter"` with no
 * `aria-valuenow` announces a measurement it does not have. Both callers render
 * an `h-1` spacer in its place so the row keeps its rhythm.
 */
export function UtilizationBar({
  utilization,
  status,
  className,
}: {
  utilization: number | undefined;
  status: CheckStatus;
  className?: string;
}) {
  if (utilization === undefined || !Number.isFinite(utilization)) return null;

  const fraction =
    Math.max(0, Math.min(utilization, UTILIZATION_DISPLAY_CAP)) / UTILIZATION_DISPLAY_CAP;
  // Failure is the only thing worth a hue here; a passing bar is a dark bar.
  const fill =
    status === "ng"
      ? "bg-status-ng"
      : status === "ok"
        ? "bg-foreground/70"
        : "bg-muted-foreground";

  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuenow={Number(utilization.toFixed(3))}
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
