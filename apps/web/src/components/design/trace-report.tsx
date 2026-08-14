"use client";

/**
 * The calculation trace report — the no-black-box centerpiece.
 *
 * Every check is an expandable tree over the engine's `Traced` DAG: symbol,
 * value, unit, the formula and the substituted formula as rendered math, the
 * ACI reference, and the inputs that produced it, all the way down to a user
 * input or a referenced code constant. Nothing here computes anything; the row
 * you read is the node the engine actually evaluated.
 *
 * The DAG is flattened to a tree once, ahead of render: the first time a node is
 * reached it renders in full, and any later path to the same node renders as a
 * one-line back-reference. That mirrors `traceToMarkdown`'s "(see above)" and
 * keeps a shared node (φ, A_cv, f'_c …) from exploding the tree.
 */

import {
  fmt,
  traceToMarkdown,
  type CheckResult,
  type CheckStatus,
  type Demands,
  type WallReport,
  type Traced,
  type WallInput,
} from "@kern/engine";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Tex } from "@/components/design/tex";
import { checkTitle } from "@/components/design/results-summary";
import { RefBadge, StatusBadge, statusText } from "@/components/design/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DAG → tree
// ---------------------------------------------------------------------------

type NodeRole = "demand" | "capacity" | "utilization" | undefined;

interface TraceView {
  path: string;
  node: Traced<unknown>;
  depth: number;
  children: TraceView[];
  /** reached earlier in this check — rendered as a back-reference */
  repeated: boolean;
  role: NodeRole;
}

function buildView(
  node: Traced<unknown>,
  path: string,
  depth: number,
  seen: Set<Traced<unknown>>,
  role: NodeRole,
): TraceView {
  if (seen.has(node)) {
    return { path, node, depth, children: [], repeated: true, role };
  }
  seen.add(node);
  return {
    path,
    node,
    depth,
    repeated: false,
    role,
    children: node.inputs.map((child, index) =>
      buildView(child, `${path}/${index}.${child.id}`, depth + 1, seen, undefined),
    ),
  };
}

/**
 * Roots are demand → capacity → utilization → the check's own trace list, with
 * identical nodes kept once (the utilization node is usually in both places).
 */
function buildCheckView(check: CheckResult): TraceView[] {
  const roots: { node: Traced<unknown>; role: NodeRole }[] = [];
  const push = (node: Traced<unknown> | undefined, role: NodeRole) => {
    if (node === undefined) return;
    if (roots.some((entry) => entry.node === node)) return;
    roots.push({ node, role });
  };
  push(check.demand, "demand");
  push(check.capacity, "capacity");
  push(check.utilization, "utilization");
  for (const node of check.trace) push(node, undefined);

  const seen = new Set<Traced<unknown>>();
  return roots.map((entry) => buildView(entry.node, `${check.id}/${entry.node.id}`, 0, seen, entry.role));
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

function valueText(node: Traced<unknown>): string {
  const value = node.value;
  const body =
    typeof value === "number"
      ? Number.isFinite(value)
        ? fmt(value)
        : value > 0
          ? "∞"
          : "−∞"
      : String(value);
  return node.unit === "1" ? body : `${body} ${node.unit}`;
}

const ROLE_LABEL: Record<Exclude<NodeRole, undefined>, string> = {
  demand: "demand",
  capacity: "capacity",
  utilization: "utilization",
};

// ---------------------------------------------------------------------------
// clipboard
// ---------------------------------------------------------------------------

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Insecure origins and older engines: fall back to a detached selection.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyButton({
  markdown,
  label = "copy markdown",
  aria,
  className,
}: {
  markdown: () => string;
  label?: string;
  aria?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onCopy = useCallback(() => {
    void writeClipboard(markdown()).then((ok) => {
      if (ok) setCopied(true);
    });
  }, [markdown]);

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onCopy}
      className={cn("font-mono text-[11px] text-muted-foreground", className)}
      aria-label={aria ?? label}
    >
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

function TraceRow({
  view,
  overrides,
  onToggle,
}: {
  view: TraceView;
  overrides: Record<string, boolean | undefined>;
  onToggle: (path: string, next: boolean) => void;
}) {
  const { node } = view;
  const hasChildren = view.children.length > 0;
  // The check root opens one level; everything deeper starts closed.
  const expanded = overrides[view.path] ?? view.depth === 0;
  const showMath = expanded && (node.formula !== undefined || node.substitution !== undefined);

  return (
    <li className={cn(view.depth > 0 && "border-l border-border pl-3")}>
      <div className="flex min-w-0 items-baseline gap-2 py-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(view.path, !expanded)}
            aria-expanded={expanded}
            className="-ml-1 flex size-4 shrink-0 translate-y-0.5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
            <span className="sr-only">{expanded ? "collapse" : "expand"}</span>
          </button>
        ) : (
          <span className="-ml-1 size-4 shrink-0" aria-hidden="true" />
        )}

        <span className="shrink-0 text-[13px] leading-5">
          <Tex>{node.symbol}</Tex>
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums">= {valueText(node)}</span>

        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {view.repeated ? "shown above" : node.label}
        </span>

        {view.role === undefined ? null : (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {ROLE_LABEL[view.role]}
          </span>
        )}
        {node.ref === undefined ? null : <RefBadge refer={node.ref} className="shrink-0" />}
        {node.status === "ng" || node.status === "warning" ? (
          <StatusBadge status={node.status} className="shrink-0" />
        ) : null}
      </div>

      {showMath ? (
        <div className="mb-1 ml-3 flex flex-col gap-1 overflow-x-auto border-l border-dashed border-border py-1 pl-3 text-[13px]">
          {node.formula === undefined ? null : (
            <Tex display className="text-foreground">
              {node.formula}
            </Tex>
          )}
          {node.substitution === undefined ? null : (
            <Tex display className="text-muted-foreground">
              {node.substitution}
            </Tex>
          )}
        </div>
      ) : null}

      {expanded && node.note !== undefined ? (
        <p className="mb-1 ml-3 pl-3 text-[11px] text-muted-foreground italic">{node.note}</p>
      ) : null}

      {expanded && hasChildren ? (
        <ul className="ml-3 flex flex-col">
          {view.children.map((child) => (
            <TraceRow key={child.path} view={child} overrides={overrides} onToggle={onToggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// per-check card
// ---------------------------------------------------------------------------

function CheckTrace({ check, scope }: { check: CheckResult; scope: string }) {
  // A failing check is the reason you opened this panel — start it open.
  const [open, setOpen] = useState(check.status === "ng");
  const [overrides, setOverrides] = useState<Record<string, boolean | undefined>>({});
  const views = useMemo(() => buildCheckView(check), [check]);
  const markdown = useCallback(() => traceToMarkdown(check), [check]);

  const toggle = useCallback((path: string, next: boolean) => {
    setOverrides((prev) => ({ ...prev, [path]: next }));
  }, []);

  const utilization = check.utilization?.value;

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          <StatusBadge status={check.status} />
          <span className="min-w-0 flex-1 truncate text-sm">{checkTitle(check.title)}</span>
        </button>
        <RefBadge refer={check.ref} className="shrink-0" />
        <span
          className={cn(
            "w-10 shrink-0 text-right font-mono text-[11px] tabular-nums",
            statusText(check.status),
          )}
        >
          {utilization !== undefined && Number.isFinite(utilization)
            ? fmt(utilization, { dp: 2 })
            : "—"}
        </span>
        <CopyButton
          markdown={markdown}
          label="md"
          aria={`copy markdown for ${check.title}`}
          className="shrink-0"
        />
      </div>

      {open ? (
        <div className="px-3 pb-3">
          <p className="pb-1 font-mono text-[10px] text-muted-foreground">{scope}</p>
          <ul className="flex flex-col">
            {views.map((view) => (
              <TraceRow key={view.path} view={view} overrides={overrides} onToggle={toggle} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function demandSummary(demand: Demands): string {
  return [
    `Pu ${fmt(demand.Pu)} kip`,
    `Mu ${fmt(demand.Mu)} kip-ft`,
    `Vu ${fmt(demand.Vu)} kip`,
  ].join(" · ");
}

const STATUS_WORD: Record<CheckStatus, string> = {
  ok: "OK",
  ng: "NG",
  warning: "WARNING",
  na: "N/A",
};

/** The whole calc sheet: a header, then every check's own engine markdown. */
function reportMarkdown(input: WallInput, report: WallReport): string {
  const { geometry, concrete, grade, vertical, horizontal, seismic, sbe } = input;
  const special = input.system === "special";
  const lines: string[] = [
    "# kern — calculation report",
    "",
    `ACI 318-19 · ${special ? "special structural wall (§18.10)" : "ordinary structural wall"} · **${STATUS_WORD[report.status]}**`,
    "",
    `- geometry: ℓw = ${fmt(geometry.lw)} in, h = ${fmt(geometry.h)} in, hw = ${fmt(geometry.hw)} in`,
    `- materials: f'c = ${fmt(concrete.fc * 1000)} psi, λ = ${fmt(concrete.lambda, { dp: 2 })}, fy = ${fmt(grade.fy)} ksi`,
    `- vertical: #${vertical.bar} @ ${fmt(vertical.spacing)} in, ${vertical.curtains} curtain(s)`,
    `- horizontal: #${horizontal.bar} @ ${fmt(horizontal.spacing)} in, ${horizontal.curtains} curtain(s)`,
  ];
  if (special && seismic !== undefined) {
    lines.push(
      `- seismic: SDC ${seismic.sdc}` +
        (seismic.deltaE === undefined ? "" : `, δe = ${fmt(seismic.deltaE, { dp: 2 })} in`) +
        (seismic.Cd === undefined ? "" : `, Cd = ${fmt(seismic.Cd, { dp: 2 })}`) +
        (seismic.ns === undefined ? "" : `, ns = ${fmt(seismic.ns, { dp: 0 })}`) +
        (seismic.hsx === undefined ? "" : `, hsx = ${fmt(seismic.hsx)} in`),
    );
  }
  if (special) {
    lines.push(
      sbe === undefined
        ? "- boundary element: none provided"
        : `- boundary element: b = ${fmt(sbe.width)} in × ℓbe = ${fmt(sbe.length)} in, (${fmt(sbe.longCount, { dp: 0 })}) #${sbe.longBar}, #${sbe.tieBar} hoops @ ${fmt(sbe.tieSpacing)} in, ${fmt(sbe.tieLegsAcrossWidth, { dp: 0 })} legs ⊥ bc1`,
    );
  }
  lines.push(
    "",
    "> Generated by kern. Requires review by a licensed engineer; not engineering advice.",
    "",
    "**wall checks**",
    "",
  );
  for (const check of report.general) {
    lines.push(traceToMarkdown(check), "");
  }
  for (const group of report.perDemand) {
    lines.push(
      `**load case: ${group.demand.label ?? group.demand.id} — ${demandSummary(group.demand)}**`,
      "",
    );
    for (const check of group.checks) lines.push(traceToMarkdown(check), "");
  }
  return lines.join("\n");
}

export function TraceReport({
  input,
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const markdown = useCallback(() => reportMarkdown(input, report), [input, report]);

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
            calculation trace
          </CardTitle>
          <CopyButton markdown={markdown} label="copy full report" />
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <GroupLabel>wall</GroupLabel>
        {report.general.map((check) => (
          <CheckTrace key={check.id} check={check} scope="wall check" />
        ))}
        {report.perDemand.map((group) => (
          <div key={group.demand.id}>
            <GroupLabel>
              {group.demand.label ?? group.demand.id}
              <span className="ml-2 font-normal">{demandSummary(group.demand)}</span>
            </GroupLabel>
            {group.checks.map((check) => (
              <CheckTrace
                key={check.id}
                check={check}
                scope={`${group.demand.label ?? group.demand.id} · ${demandSummary(group.demand)}`}
              />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-border bg-muted/40 px-3 py-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </div>
  );
}
