/**
 * The learn-mode calculation trace: one `CheckResult`, every node open.
 *
 * `/design`'s `<TraceReport>` is the same DAG rendered for a working designer —
 * collapsed by default, one check among many, driven by React state. A
 * walkthrough wants the opposite: the whole derivation visible at once, in the
 * server-rendered HTML, with no interaction required to read it. Its props are
 * `{ input, report }` and its expansion policy is internal, so there is no prop
 * to reach for; rather than change a shared design component, this is a thin
 * recursive view over the same `Traced` DAG, reusing `<Tex>`, `<RefBadge>` and
 * `<StatusBadge>` so the rows read identically to /design.
 *
 * It is a **server component**: the engine runs at build time and every symbol,
 * value, formula and substitution is in the static HTML — the point of putting
 * the walkthroughs on a server-rendered route at all. Collapsing is native
 * `<details open>`, so it works with zero JavaScript.
 *
 * The DAG is flattened to a tree once, ahead of render, exactly as
 * `<TraceReport>` and `traceToMarkdown` do: the first path to a node renders in
 * full, later paths render as a one-line back-reference. Without that, a shared
 * node (φ, A_cv, f'_c) would be re-expanded down every path that reaches it.
 */

import { fmt, type CheckResult, type Traced } from "@shear0/engine";
import { ChevronRight } from "lucide-react";
import { Tex } from "@/components/design/tex";
import { RefBadge, StatusBadge, statusText } from "@/components/design/status";
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

/** demand → capacity → utilization → the check's own trace roots, deduplicated. */
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
  return roots.map((entry) =>
    buildView(entry.node, `${check.id}/${entry.node.id}`, 0, seen, entry.role),
  );
}

function countNodes(views: TraceView[]): number {
  return views.reduce((n, view) => n + 1 + countNodes(view.children), 0);
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
// rows
// ---------------------------------------------------------------------------

/**
 * The same `ChevronRight` /design's trace uses, at the same 1.5 stroke: this was
 * a hand-rolled copy of lucide's own path, drawn two weights heavier than every
 * other icon in the app and beside 400-weight mono. lucide renders in a server
 * component, so the page stays zero-JS.
 */
function Chevron({ hidden }: { hidden?: boolean }) {
  if (hidden === true) {
    return <span className="-ml-1 size-4 shrink-0" aria-hidden="true" />;
  }
  return (
    <ChevronRight
      strokeWidth={1.5}
      aria-hidden="true"
      className="-ml-1 size-4 shrink-0 translate-y-0.5 p-0.5 text-muted-foreground transition-transform group-open:rotate-90"
    />
  );
}

function NodeHead({ view }: { view: TraceView }) {
  const { node } = view;
  return (
    <>
      <span className="shrink-0 text-sm2 leading-5">
        <Tex>{node.symbol}</Tex>
      </span>
      <span className="shrink-0 font-mono text-sm2 tabular-nums">= {valueText(node)}</span>
      <span className="min-w-0 flex-1 text-xs2 text-muted-foreground">
        {view.repeated ? "shown above" : node.label}
      </span>
      {view.role === undefined ? null : (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
          {ROLE_LABEL[view.role]}
        </span>
      )}
      {node.ref === undefined ? null : (
        <RefBadge refer={node.ref} focusable={false} className="shrink-0" />
      )}
      {node.status === "ng" || node.status === "warning" ? (
        <StatusBadge status={node.status} className="shrink-0" />
      ) : null}
    </>
  );
}

/** formula, substitution and commentary — the "why" under a row. */
function NodeBody({ node }: { node: Traced<unknown> }) {
  const hasMath = node.formula !== undefined || node.substitution !== undefined;
  if (!hasMath && node.note === undefined) return null;
  return (
    <>
      {hasMath ? (
        // `trace-body`: the display math is the heaviest thing on the page and
        // its box is a consistent 74-140 px, so it is the other half of the
        // deferred-rendering split described in `globals.css`.
        <div className="trace-body mb-1 ml-3 flex flex-col gap-1 overflow-x-auto border-l border-dashed border-border py-1 pl-3 text-sm2">
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
      {node.note === undefined ? null : (
        <p className="mb-1 ml-3 pl-3 text-xs2 text-muted-foreground italic">{node.note}</p>
      )}
    </>
  );
}

function TraceNode({ view }: { view: TraceView }) {
  const { node } = view;
  // `trace-row`: every row on the page is exactly 30 px tall, so it can be
  // handed to `content-visibility` with an intrinsic size that is not a guess.
  // See the block in `globals.css`.
  const rowClass = "trace-row flex min-w-0 items-baseline gap-2 py-1";
  const liClass = cn(view.depth > 0 && "border-l border-border pl-3");

  if (view.children.length === 0) {
    return (
      <li className={liClass}>
        <div className={rowClass}>
          <Chevron hidden />
          <NodeHead view={view} />
        </div>
        {/* a back-reference is one line: its derivation is already on the page */}
        {view.repeated ? null : <NodeBody node={node} />}
      </li>
    );
  }

  return (
    <li className={liClass}>
      {/* open by default: this is learn mode, the whole derivation is the content */}
      <details open className="group">
        <summary
          className={cn(
            rowClass,
            "cursor-pointer list-none rounded marker:content-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <Chevron />
          <NodeHead view={view} />
        </summary>
        <NodeBody node={node} />
        <ul className="ml-3 flex flex-col">
          {view.children.map((child) => (
            <TraceNode key={child.path} view={child} />
          ))}
        </ul>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

export interface TraceWalkthroughProps {
  check: CheckResult;
  /** scope line under the header, e.g. the load combination the check read */
  scope?: string;
}

export function TraceWalkthrough({ check, scope }: TraceWalkthroughProps) {
  const views = buildCheckView(check);
  const total = countNodes(views);
  const utilization = check.utilization?.value;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <StatusBadge status={check.status} />
        <span className="min-w-0 flex-1 text-sm">{check.title.toLowerCase()}</span>
        <RefBadge refer={check.ref} className="shrink-0" />
        <span
          className={cn(
            "shrink-0 text-right font-mono text-xs2 tabular-nums",
            statusText(check.status),
          )}
        >
          {utilization !== undefined && Number.isFinite(utilization)
            ? fmt(utilization, { dp: 2 })
            : "—"}
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="pb-1 font-mono text-2xs text-muted-foreground">
          {scope === undefined ? `${total} steps` : `${scope} · ${total} steps`} · every step open —
          collapse any row to fold its inputs away
        </p>
        <ul className="flex flex-col">
          {views.map((view) => (
            <TraceNode key={view.path} view={view} />
          ))}
        </ul>
      </div>
    </section>
  );
}
