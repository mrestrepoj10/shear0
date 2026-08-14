/**
 * WallInput + WallReport → a json-render spec for `@json-render/react-pdf`.
 *
 * Same walk as `build-spec.ts`, different vocabulary: the PDF renders through
 * the react-pdf *standard* components (Document/Page/Heading/Text/Table/…), so
 * this file needs no registry of its own. The standard PDF fonts are WinAnsi —
 * no Greek, no math glyphs — so every engine symbol and formula goes through
 * `asciiMath` on the way in rather than shipping tofu boxes in a submittal.
 */

import type { Spec } from "@json-render/core";
import {
  barPositions,
  designCurve,
  interactionCurve,
  type CheckResult,
  type CheckStatus,
  type WallInput,
  type WallReport,
} from "@kern/engine";
import { demandTitle, flattenCheck, inputRows, valueText, type ReportMeta } from "./build-spec";

/** LaTeX commands and Unicode math the engine uses, to WinAnsi-safe ASCII. */
const LATEX: [RegExp, string][] = [
  [/\\rho/g, "rho"],
  [/\\ell/g, "l"],
  [/\\phi/g, "phi"],
  [/\\lambda/g, "lambda"],
  [/\\alpha/g, "alpha"],
  [/\\beta/g, "beta"],
  [/\\delta/g, "delta"],
  [/\\Delta/g, "Delta"],
  [/\\sigma/g, "sigma"],
  [/\\varepsilon/g, "eps"],
  [/\\epsilon/g, "eps"],
  [/\\omega/g, "omega"],
  [/\\sqrt/g, "sqrt"],
  [/\\[dt]?frac/g, ""],
  [/\\quad|\\qquad/g, " "],
  [/\\left|\\right/g, ""],
  [/\\cdot/g, " * "],
  [/\\times/g, " x "],
  [/\\le(?![a-z])/g, " <= "],
  [/\\ge(?![a-z])/g, " >= "],
  [/\\min/g, "min"],
  [/\\max/g, "max"],
  [/\\text/g, ""],
  [/\\mathrm/g, ""],
  [/\\,|\\;|\\!/g, " "],
];

const UNICODE: [RegExp, string][] = [
  [/ρ/g, "rho"],
  [/ℓ/g, "l"],
  [/φ/g, "phi"],
  [/λ/g, "lambda"],
  [/α/g, "alpha"],
  [/β/g, "beta"],
  [/δ/g, "delta"],
  [/Δ/g, "Delta"],
  [/σ/g, "sigma"],
  [/ε/g, "eps"],
  [/ω/g, "omega"],
  [/Ω/g, "Omega"],
  [/μ/g, "mu"],
  [/θ/g, "theta"],
  [/γ/g, "gamma"],
  [/τ/g, "tau"],
  [/ν/g, "nu"],
  [/χ/g, "chi"],
  [/ψ/g, "psi"],
  [/Ψ/g, "Psi"],
  [/Φ/g, "Phi"],
  [/Σ/g, "Sum"],
  [/π/g, "pi"],
  [/²/g, "^2"],
  [/³/g, "^3"],
  [/±/g, "+/-"],
  [/√/g, "sqrt"],
  [/·/g, " * "],
  [/×/g, " x "],
  [/≤/g, " <= "],
  [/≥/g, " >= "],
  [/≠/g, " != "],
  [/'/g, "'"],
  [/—|–/g, "-"],
  [/’|‘/g, "'"],
  [/“|”/g, '"'],
];

export function asciiMath(s: string): string {
  let out = s;
  for (const [re, to] of LATEX) out = out.replace(re, to);
  for (const [re, to] of UNICODE) out = out.replace(re, to);
  out = out.replace(/[{}]/g, "").replace(/\\/g, "");
  // Whatever survives the mappings must still be WinAnsi-encodable — the
  // standard PDF fonts cover Latin-1 only, and one stray glyph fails the
  // whole render. "?" over tofu, and over a 500.
  out = out.replace(/[^\x20-\xFF]/g, "?");
  return out.replace(/\s+/g, " ").trim();
}

const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: "OK",
  ng: "NG",
  warning: "WARNING",
  na: "N/A",
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  ok: "#111111",
  ng: "#b91c1c",
  warning: "#92400e",
  na: "#6b7280",
};

interface SpecElement {
  type: string;
  props: Record<string, unknown>;
  children: string[];
}

export function buildPdfSpec(input: WallInput, report: WallReport, meta: ReportMeta): Spec {
  const elements: Record<string, SpecElement> = {};
  let n = 0;
  const add = (
    type: string,
    props: Record<string, unknown>,
    children: string[] = [],
  ): string => {
    const id = `${type.toLowerCase()}-${++n}`;
    elements[id] = { type, props, children };
    return id;
  };

  const checkBlock = (check: CheckResult): string[] => {
    const refText = `ACI 318-19 Sec. ${check.ref.section}${check.ref.eq ? ` (Eq. ${check.ref.eq})` : ""}`;
    const rows: string[][] = flattenCheck(check).map(({ node, depth }) => [
      `${"  ".repeat(depth)}${asciiMath(node.symbol)}`,
      asciiMath(valueText(node)),
      node.formula === undefined ? (node.note ? asciiMath(node.note) : asciiMath(node.label)) : asciiMath(node.formula),
      node.ref ? node.ref.section : "",
    ]);
    return [
      add("Heading", { text: `${check.title} — ${STATUS_TEXT[check.status]}`, level: "h3" }),
      add("Text", {
        text: refText,
        fontSize: 8,
        color: "#6b7280",
      }),
      add("Table", {
        columns: [
          { header: "symbol", width: "22%" },
          { header: "value", width: "20%" },
          { header: "formula / note", width: "48%" },
          { header: "ref", width: "10%" },
        ],
        rows,
      }),
      add("Spacer", { height: 10 }),
    ];
  };

  const children: string[] = [
    add("Heading", { text: "shear wall calc sheet", level: "h1" }),
    add("Text", {
      text: `ACI 318-19 - overall result: ${STATUS_TEXT[report.status]}`,
      fontSize: 11,
      color: STATUS_COLOR[report.status],
    }),
    add("Text", { text: `generated ${meta.generatedAt} by kern`, fontSize: 8, color: "#6b7280" }),
    add("Link", { text: "open this design in kern", href: meta.link }),
    add("Divider", {}),
    add("Heading", { text: "design inputs", level: "h2" }),
    add("Table", {
      columns: [
        { header: "input", width: "38%" },
        { header: "value", width: "62%" },
      ],
      rows: inputRows(input).map(([k, v]) => [asciiMath(k), asciiMath(v)]),
    }),
    add("Spacer", { height: 12 }),
  ];

  // Figures: the wall itself, the P–M surface, and the utilization overview —
  // drawn as vectors by the custom components in `pdf-registry.tsx` from the
  // same engine data the on-screen charts plot.
  children.push(
    add("Heading", { text: "wall plan section", level: "h2" }),
    add("WallPlan", {
      lw: input.geometry.lw,
      h: input.geometry.h,
      stations: barPositions(input).map((st) => st.x),
      sbeLength: input.sbe?.length ?? null,
    }),
    add("Heading", { text: "P-M interaction (ACI 318-19 Sec. 22.2 / 22.4)", level: "h2" }),
    add("PmChart", {
      design: designCurve(input, { points: 120 }).map((p) => ({ x: p.phiMn, y: p.phiPn })),
      nominal: interactionCurve(input, { points: 120 }).map((p) => ({ x: p.Mn, y: p.Pn })),
      demands: input.demands.map((d) => {
        const check = report.perDemand
          .find((g) => g.demand.id === d.id)
          ?.checks.find((c) => c.id === "flexure.axial");
        return {
          x: Math.abs(d.Mu),
          y: d.Pu,
          label: d.label ?? d.id,
          ok: check?.status !== "ng",
        };
      }),
    }),
    add("Spacer", { height: 8 }),
  );

  const utilizationRows = [
    ...report.general.map((check) => ({ check, scope: "" })),
    ...report.perDemand.flatMap((group) =>
      group.checks.map((check) => ({
        check,
        scope: ` (${group.demand.label ?? group.demand.id})`,
      })),
    ),
  ]
    .filter(({ check }) => typeof check.utilization?.value === "number")
    .map(({ check, scope }) => ({
      label: asciiMath(`${check.title}${scope}`),
      value: check.utilization!.value as number,
      status: check.status,
    }));
  if (utilizationRows.length > 0) {
    children.push(
      add("Heading", { text: "utilization overview", level: "h2" }),
      add("UtilizationChart", { rows: utilizationRows }),
    );
  }

  if (report.general.length > 0) {
    children.push(add("Heading", { text: "geometry & detailing", level: "h2" }));
    for (const check of report.general) children.push(...checkBlock(check));
  }
  for (const group of report.perDemand) {
    children.push(add("Heading", { text: asciiMath(demandTitle(group.demand)), level: "h2" }));
    for (const check of group.checks) children.push(...checkBlock(check));
  }
  children.push(add("PageNumber", {}));

  const page = add("Page", { size: "LETTER" }, children);
  const doc = add("Document", { title: "kern shear wall calc sheet" }, [page]);
  return { root: doc, elements } as unknown as Spec;
}
