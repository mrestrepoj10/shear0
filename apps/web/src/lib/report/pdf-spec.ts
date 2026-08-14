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
import type { CheckResult, CheckStatus, WallInput, WallReport } from "@kern/engine";
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
  [/\\frac/g, ""],
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
  [/π/g, "pi"],
  [/√/g, "sqrt"],
  [/·/g, " * "],
  [/×/g, " x "],
  [/≤/g, " <= "],
  [/≥/g, " >= "],
  [/≠/g, " != "],
  [/'/g, "'"],
  [/—/g, "-"],
];

export function asciiMath(s: string): string {
  let out = s;
  for (const [re, to] of LATEX) out = out.replace(re, to);
  for (const [re, to] of UNICODE) out = out.replace(re, to);
  out = out.replace(/[{}]/g, "").replace(/\\/g, "");
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
