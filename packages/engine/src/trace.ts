import type { Unit } from "./units";
import { fmt } from "./units";

export interface CodeRef {
  standard: "ACI 318-19" | "ACI 318M-19";
  section: string;
  eq?: string;
}

export type CheckStatus = "ok" | "ng" | "warning" | "na";

export interface Traced<T = number> {
  id: string;
  symbol: string;
  label: string;
  value: T;
  unit: Unit;
  formula?: string;
  substitution?: string;
  ref?: CodeRef;
  inputs: Traced<any>[];
  status?: CheckStatus;
  note?: string;
}

export interface CheckResult {
  id: string;
  title: string;
  ref: CodeRef;
  demand?: Traced;
  capacity?: Traced;
  utilization?: Traced;
  status: CheckStatus;
  trace: Traced<any>[];
}

export function aci(section: string, eq?: string): CodeRef {
  return eq === undefined
    ? { standard: "ACI 318-19", section }
    : { standard: "ACI 318-19", section, eq };
}

/**
 * Rewrite every CodeRef in a finished report to the edition actually in force.
 * Checks build refs through aci(), which has no unit-system context; section
 * numbering is identical across editions, so only the standard name changes.
 * Mutates in place — nodes can be shared between checks, and re-stamping the
 * same standard is idempotent.
 */
export function stampEdition(checks: CheckResult[], standard: CodeRef["standard"]): void {
  const seen = new Set<Traced<any>>();
  const walk = (node: Traced<any>): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.ref) node.ref.standard = standard;
    for (const input of node.inputs) walk(input);
  };
  for (const c of checks) {
    c.ref.standard = standard;
    for (const node of c.trace) walk(node);
    if (c.demand) walk(c.demand);
    if (c.capacity) walk(c.capacity);
    if (c.utilization) walk(c.utilization);
  }
}

// Provenance is tracked out-of-band so that Traced stays a plain serializable
// object (traces get snapshotted, exported to markdown, and sent over the wire).
// validateTrace runs in tests, in-process, where these sets are live.
const INPUT_NODES = new WeakSet<Traced<any>>();
const CONSTANT_NODES = new WeakSet<Traced<any>>();

export function input<T = number>(
  id: string,
  symbol: string,
  label: string,
  value: T,
  unit: Unit,
  note?: string,
): Traced<T> {
  const node: Traced<T> = { id, symbol, label, value, unit, inputs: [] };
  if (note !== undefined) node.note = note;
  INPUT_NODES.add(node);
  return node;
}

export function constant<T = number>(
  id: string,
  symbol: string,
  label: string,
  value: T,
  unit: Unit,
  ref: CodeRef,
  note?: string,
): Traced<T> {
  const node: Traced<T> = { id, symbol, label, value, unit, ref, inputs: [] };
  if (note !== undefined) node.note = note;
  CONSTANT_NODES.add(node);
  return node;
}

export interface DeriveArgs<T = number> {
  id: string;
  symbol: string;
  label: string;
  value: T;
  unit: Unit;
  formula: string;
  substitution: string;
  ref?: CodeRef;
  inputs: Traced<any>[];
  status?: CheckStatus;
  note?: string;
}

export function derive<T = number>(args: DeriveArgs<T>): Traced<T> {
  if (!args.formula) throw new Error(`derive(${args.id}): formula is required`);
  if (!args.substitution) throw new Error(`derive(${args.id}): substitution is required`);
  const node: Traced<T> = {
    id: args.id,
    symbol: args.symbol,
    label: args.label,
    value: args.value,
    unit: args.unit,
    formula: args.formula,
    substitution: args.substitution,
    inputs: args.inputs,
  };
  if (args.ref !== undefined) node.ref = args.ref;
  if (args.status !== undefined) node.status = args.status;
  if (args.note !== undefined) node.note = args.note;
  return node;
}

export interface CheckResultArgs {
  id: string;
  title: string;
  ref: CodeRef;
  demand?: Traced;
  capacity?: Traced;
  utilization?: Traced;
  trace: Traced<any>[];
  status?: CheckStatus;
}

const UTILIZATION_TOL = 1e-9;

export function checkResult(args: CheckResultArgs): CheckResult {
  const roots = [args.demand, args.capacity, args.utilization, ...args.trace].filter(
    (n): n is Traced<any> => n !== undefined,
  );
  const nodes = reachable(roots);
  let sub: CheckStatus = "ok";
  for (const n of nodes) {
    if (n.status === "ng") {
      sub = "ng";
      break;
    }
    if (n.status === "warning") sub = "warning";
  }
  const overUtilized =
    args.utilization !== undefined && args.utilization.value > 1 + UTILIZATION_TOL;
  const status: CheckStatus =
    args.status ?? (sub === "ng" || overUtilized ? "ng" : sub === "warning" ? "warning" : "ok");

  const result: CheckResult = {
    id: args.id,
    title: args.title,
    ref: args.ref,
    status,
    trace: args.trace,
  };
  if (args.demand !== undefined) result.demand = args.demand;
  if (args.capacity !== undefined) result.capacity = args.capacity;
  if (args.utilization !== undefined) result.utilization = args.utilization;
  return result;
}

/** Throws on any violation of the no-black-box invariants. Used by tests. */
export function validateTrace(nodes: Traced<any>[]): void {
  for (const root of nodes) {
    const visited = new Set<Traced<any>>();
    const onPath = new Set<Traced<any>>();
    const ids = new Map<string, Traced<any>>();

    const walk = (node: Traced<any>, trail: string[]): void => {
      if (onPath.has(node)) {
        throw new Error(`trace cycle detected: ${[...trail, node.id].join(" -> ")}`);
      }
      if (visited.has(node)) return;
      onPath.add(node);

      const seen = ids.get(node.id);
      if (seen !== undefined && seen !== node) {
        throw new Error(`duplicate trace id "${node.id}" in graph rooted at "${root.id}"`);
      }
      ids.set(node.id, node);

      if (node.inputs.length === 0) {
        if (!INPUT_NODES.has(node) && !CONSTANT_NODES.has(node)) {
          throw new Error(
            `leaf "${node.id}" was not created by input() or constant() — every leaf must be a user input or a referenced code constant`,
          );
        }
        if (CONSTANT_NODES.has(node) && node.ref === undefined) {
          throw new Error(`constant "${node.id}" has no code reference`);
        }
      } else {
        if (!node.formula) throw new Error(`derived node "${node.id}" has no formula`);
        if (!node.substitution) throw new Error(`derived node "${node.id}" has no substitution`);
      }

      for (const child of node.inputs) walk(child, [...trail, node.id]);
      onPath.delete(node);
      visited.add(node);
    };

    walk(root, []);
  }
}

/** Dependency-first topological order; each node appears once. */
export function flattenTrace(root: Traced<any>): Traced<any>[] {
  const out: Traced<any>[] = [];
  const visited = new Set<Traced<any>>();
  const walk = (node: Traced<any>): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const child of node.inputs) walk(child);
    out.push(node);
  };
  walk(root);
  return out;
}

function reachable(roots: Traced<any>[]): Traced<any>[] {
  const out: Traced<any>[] = [];
  const visited = new Set<Traced<any>>();
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || visited.has(node)) continue;
    visited.add(node);
    out.push(node);
    stack.push(...node.inputs);
  }
  return out;
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "OK",
  ng: "NG",
  warning: "WARNING",
  na: "N/A",
};

export function traceToMarkdown(check: CheckResult): string {
  const lines: string[] = [];
  lines.push(`## ${check.title}`);
  lines.push("");
  lines.push(`${refText(check.ref)} — **${STATUS_LABEL[check.status]}**`);
  lines.push("");
  if (check.demand) lines.push(`- demand: ${valueText(check.demand)}`);
  if (check.capacity) lines.push(`- capacity: ${valueText(check.capacity)}`);
  if (check.utilization) lines.push(`- utilization: ${valueText(check.utilization)}`);
  if (check.demand || check.capacity || check.utilization) lines.push("");

  const rendered = new Set<Traced<any>>();
  for (const root of check.trace) renderNode(root, 0, lines, rendered);
  return lines.join("\n");
}

function renderNode(
  node: Traced<any>,
  depth: number,
  lines: string[],
  rendered: Set<Traced<any>>,
): void {
  const pad = "  ".repeat(depth);
  if (rendered.has(node)) {
    lines.push(`${pad}- ${node.symbol} = ${valueOnly(node)} (see above)`);
    return;
  }
  rendered.add(node);
  const bits = [`${pad}- **${node.symbol}** = ${valueOnly(node)}`, node.label];
  if (node.ref) bits.push(refText(node.ref));
  if (node.status) bits.push(STATUS_LABEL[node.status]);
  lines.push(bits.join(" — "));
  if (node.formula) lines.push(`${pad}  - formula: \`${node.formula}\``);
  if (node.substitution) lines.push(`${pad}  - subst: \`${node.substitution}\``);
  if (node.note) lines.push(`${pad}  - note: ${node.note}`);
  for (const child of node.inputs) renderNode(child, depth + 1, lines, rendered);
}

function valueOnly(node: Traced<any>): string {
  const v = typeof node.value === "number" ? fmt(node.value) : String(node.value);
  return node.unit === "1" ? v : `${v} ${node.unit}`;
}

function valueText(node: Traced<any>): string {
  return `${node.symbol} = ${valueOnly(node)}`;
}

function refText(ref: CodeRef): string {
  return ref.eq === undefined
    ? `${ref.standard} §${ref.section}`
    : `${ref.standard} §${ref.section} (Eq. ${ref.eq})`;
}
