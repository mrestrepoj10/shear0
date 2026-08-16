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
import { viewOf, type UnitsView } from "@/lib/units-view";

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

/**
 * `Demands` is storage, so it is canonical kip/kip-ft in both editions — unlike
 * every traced node under it, which the engine already reports in the wall's
 * own system. The section heading has to be moved across explicitly or a metric
 * calc sheet would announce its load case in kip and then work it in kN.
 */
export function demandTitle(demand: Demands, U: UnitsView): string {
  const name = demand.label ?? demand.id;
  return (
    `${name} — Pu = ${fmt(U.force(demand.Pu))} ${U.forceUnit}` +
    ` · Mu = ${fmt(U.moment(demand.Mu))} ${U.momentUnit}` +
    ` · Vu = ${fmt(U.force(demand.Vu))} ${U.forceUnit}`
  );
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
  const U = viewOf(input);
  // Every input is stored canonically, so each row is a conversion; bar
  // designations are the one exception — #3–#11 in both editions, a known
  // limitation rather than a unit to convert.
  const L = (inches: number) => `${fmt(U.len(inches))} ${U.lengthUnit}`;
  const rows: [string, string][] = [
    ["system", input.system === "special" ? "special structural wall (§18.10)" : "ordinary wall (Ch. 11)"],
    ["wall type", input.wallType],
    ["length ℓw", L(g.lw)],
    ["thickness h", L(g.h)],
    ["height hw", L(g.hw)],
    ["unsupported length ℓu", L(g.lu)],
    ["effective length factor k", fmt(g.k)],
    ["cover", L(g.cover)],
    ["f'c", `${fmt(U.stress(input.concrete.fc))} ${U.stressUnit}`],
    ["λ", fmt(input.concrete.lambda)],
    // ACI 318M-19 Ch. 20 names the grades by their MPa value, and the engine
    // traces f_y in MPa in SI; the in-lb sheet keeps the ksi it has always used
    // rather than the psi `U.stress` would give.
    ["fy", U.si ? `${fmt(U.stress(input.grade.fy))} MPa` : `${fmt(input.grade.fy)} ksi`],
    [
      "vertical steel",
      `#${input.vertical.bar} @ ${L(input.vertical.spacing)}, ${input.vertical.curtains} curtain(s)`,
    ],
    [
      "horizontal steel",
      `#${input.horizontal.bar} @ ${L(input.horizontal.spacing)}, ${input.horizontal.curtains} curtain(s)`,
    ],
  ];
  if (g.hu !== undefined) rows.splice(6, 0, ["story height hu", L(g.hu)]);
  if (g.hwcs !== undefined) rows.splice(6, 0, ["hwcs", L(g.hwcs)]);
  if (input.endZone) {
    rows.push([
      "end-zone bars",
      `${input.endZone.count} × #${input.endZone.bar}, first @ ${L(input.endZone.distanceToFirst)}, spacing ${L(input.endZone.spacing)}`,
    ]);
  }
  if (input.seismic) {
    const s = input.seismic;
    const bits = [`SDC ${s.sdc}`];
    if (s.deltaE !== undefined) bits.push(`δe = ${L(s.deltaE)}`);
    if (s.Cd !== undefined) bits.push(`Cd = ${fmt(s.Cd)}`);
    if (s.ns !== undefined) bits.push(`ns = ${fmt(s.ns)}`);
    if (s.hsx !== undefined) bits.push(`hsx = ${L(s.hsx)}`);
    rows.push(["seismic", bits.join(" · ")]);
  }
  if (input.sbe) {
    const b = input.sbe;
    rows.push([
      "provided SBE",
      `${fmt(U.len(b.width))} × ${L(b.length)}, ${b.longCount} × #${b.longBar}, ties #${b.tieBar} @ ${L(b.tieSpacing)}`,
    ]);
  }
  return rows;
}

/** The edition the wall is being evaluated against, as it is printed. */
export function standardName(input: WallInput): string {
  return viewOf(input).si ? "ACI 318M-19" : "ACI 318-19";
}

const STATUS_SENTENCE: Record<CheckStatus, string> = {
  ok: "all checks pass",
  ng: "one or more checks fail",
  warning: "passes with warnings",
  na: "nothing to check",
};

export function buildReportSpec(input: WallInput, report: WallReport, meta: ReportMeta): Spec {
  const b = new SpecBuilder();
  const U = viewOf(input);

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
        // `ref.standard` is a literal "ACI 318-19" in the engine's trace types;
        // the section numbers are shared between the two editions, so the
        // edition name is the wall's, not the ref's.
        section: `${standardName(input)} §${check.ref.section}`,
        eq: check.ref.eq ?? null,
        status: check.status,
      },
      children,
    );
  };

  const children: string[] = [
    b.add("ReportHeader", {
      title: "shear wall calc sheet",
      subtitle: `${standardName(input)} — ${STATUS_SENTENCE[report.status]}`,
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
      b.add("Section", { title: demandTitle(group.demand, U) }, group.checks.map(addCheck)),
    );
  }

  const root = b.add("Report", {}, children);
  return { root, elements: b.elements } as unknown as Spec;
}
