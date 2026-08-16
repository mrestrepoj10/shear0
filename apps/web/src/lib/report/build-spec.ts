/**
 * WallInput + WallReport → a json-render spec against `reportCatalog`.
 *
 * The engine's trace DAG already carries everything a calc sheet needs; this
 * module only decides reading order. One spec drives the on-screen report view
 * (`report-view.tsx`); `pdf-spec.ts` walks the same wall with the same helpers
 * into the react-pdf standard components.
 */

import type { Spec } from "@json-render/core";
import {
  fmt,
  type CheckResult,
  type CheckStatus,
  type Demands,
  type Traced,
  type WallInput,
  type WallReport,
} from "@shear0/engine";

export interface ReportMeta {
  /** canonical share link for this wall */
  link: string;
  /** human-readable generation timestamp */
  generatedAt: string;
}

interface SpecElement {
  type: string;
  props: Record<string, unknown>;
  children: string[];
}

class SpecBuilder {
  elements: Record<string, SpecElement> = {};
  private n = 0;

  add(type: string, props: Record<string, unknown>, children: string[] = []): string {
    const id = `${type.toLowerCase()}-${++this.n}`;
    this.elements[id] = { type, props, children };
    return id;
  }
}

/** `fmt` plus the unit, with "1" (dimensionless) omitted — mirrors trace.ts. */
export function valueText(node: Traced<unknown>): string {
  const v = typeof node.value === "number" ? fmt(node.value) : String(node.value);
  return node.unit === "1" ? v : `${v} ${node.unit}`;
}

export function demandTitle(demand: Demands): string {
  const name = demand.label ?? demand.id;
  return `${name} — Pu = ${fmt(demand.Pu)} kip · Mu = ${fmt(demand.Mu)} kip-ft · Vu = ${fmt(demand.Vu)} kip`;
}

/**
 * Every node reachable from the check, dependency-first, each exactly once —
 * the order a reviewer reads a hand calc in. Depth is the node's distance from
 * its root, for indentation only.
 */
export function flattenCheck(check: CheckResult): { node: Traced<unknown>; depth: number }[] {
  const out: { node: Traced<unknown>; depth: number }[] = [];
  const visited = new Set<Traced<unknown>>();
  const walk = (node: Traced<unknown>, depth: number): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const child of node.inputs) walk(child, depth + 1);
    out.push({ node, depth });
  };
  const roots = [check.demand, check.capacity, check.utilization, ...check.trace].filter(
    (n): n is Traced<unknown> => n !== undefined,
  );
  for (const root of roots) walk(root, 0);
  return out;
}

export function inputRows(input: WallInput): [string, string][] {
  const g = input.geometry;
  const rows: [string, string][] = [
    ["system", input.system === "special" ? "special structural wall (§18.10)" : "ordinary wall (Ch. 11)"],
    ["wall type", input.wallType],
    ["length ℓw", `${fmt(g.lw)} in`],
    ["thickness h", `${fmt(g.h)} in`],
    ["height hw", `${fmt(g.hw)} in`],
    ["unsupported length ℓu", `${fmt(g.lu)} in`],
    ["effective length factor k", fmt(g.k)],
    ["cover", `${fmt(g.cover)} in`],
    ["f'c", `${fmt(input.concrete.fc * 1000)} psi`],
    ["λ", fmt(input.concrete.lambda)],
    ["fy", `${fmt(input.grade.fy)} ksi`],
    [
      "vertical steel",
      `#${input.vertical.bar} @ ${fmt(input.vertical.spacing)} in, ${input.vertical.curtains} curtain(s)`,
    ],
    [
      "horizontal steel",
      `#${input.horizontal.bar} @ ${fmt(input.horizontal.spacing)} in, ${input.horizontal.curtains} curtain(s)`,
    ],
  ];
  if (g.hu !== undefined) rows.splice(6, 0, ["story height hu", `${fmt(g.hu)} in`]);
  if (g.hwcs !== undefined) rows.splice(6, 0, ["hwcs", `${fmt(g.hwcs)} in`]);
  if (input.endZone) {
    rows.push([
      "end-zone bars",
      `${input.endZone.count} × #${input.endZone.bar}, first @ ${fmt(input.endZone.distanceToFirst)} in, spacing ${fmt(input.endZone.spacing)} in`,
    ]);
  }
  if (input.seismic) {
    const s = input.seismic;
    const bits = [`SDC ${s.sdc}`];
    if (s.deltaE !== undefined) bits.push(`δe = ${fmt(s.deltaE)} in`);
    if (s.Cd !== undefined) bits.push(`Cd = ${fmt(s.Cd)}`);
    if (s.ns !== undefined) bits.push(`ns = ${fmt(s.ns)}`);
    if (s.hsx !== undefined) bits.push(`hsx = ${fmt(s.hsx)} in`);
    rows.push(["seismic", bits.join(" · ")]);
  }
  if (input.sbe) {
    const b = input.sbe;
    rows.push([
      "provided SBE",
      `${fmt(b.width)} × ${fmt(b.length)} in, ${b.longCount} × #${b.longBar}, ties #${b.tieBar} @ ${fmt(b.tieSpacing)} in`,
    ]);
  }
  return rows;
}

const STATUS_SENTENCE: Record<CheckStatus, string> = {
  ok: "all checks pass",
  ng: "one or more checks fail",
  warning: "passes with warnings",
  na: "nothing to check",
};

export function buildReportSpec(input: WallInput, report: WallReport, meta: ReportMeta): Spec {
  const b = new SpecBuilder();

  const addCheck = (check: CheckResult): string => {
    const children: string[] = [];
    if (check.utilization && typeof check.utilization.value === "number") {
      children.push(
        b.add("Utilization", { value: check.utilization.value, status: check.status }),
      );
    }
    for (const { node, depth } of flattenCheck(check)) {
      children.push(
        b.add("Quantity", {
          symbol: node.symbol,
          label: node.label,
          value: valueText(node),
          note: node.note ?? null,
          status: node.status ?? null,
          depth,
        }),
      );
      if (node.formula !== undefined && node.substitution !== undefined) {
        children.push(
          b.add("Formula", { formula: node.formula, substitution: node.substitution, depth }),
        );
      }
    }
    return b.add(
      "CheckBlock",
      {
        title: check.title,
        section: `${check.ref.standard} §${check.ref.section}`,
        eq: check.ref.eq ?? null,
        status: check.status,
      },
      children,
    );
  };

  const children: string[] = [
    b.add("ReportHeader", {
      title: "shear wall calc sheet",
      subtitle: `ACI 318-19 — ${STATUS_SENTENCE[report.status]}`,
      status: report.status,
      generatedAt: meta.generatedAt,
      link: meta.link,
    }),
    b.add("Section", { title: "design inputs" }, [
      b.add("KeyValueGrid", { rows: inputRows(input) }),
    ]),
  ];

  if (report.general.length > 0) {
    children.push(
      b.add("Section", { title: "geometry & detailing" }, report.general.map(addCheck)),
    );
  }
  for (const group of report.perDemand) {
    children.push(
      b.add("Section", { title: demandTitle(group.demand) }, group.checks.map(addCheck)),
    );
  }

  const root = b.add("Report", {}, children);
  return { root, elements: b.elements } as unknown as Spec;
}
