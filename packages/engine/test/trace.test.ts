import { describe, expect, it } from "vitest";
import {
  aci,
  checkResult,
  constant,
  derive,
  flattenTrace,
  input,
  traceToMarkdown,
  validateTrace,
} from "../src/trace";
import type { Traced } from "../src/trace";

function tinyTrace(): Traced {
  const h = input("wall.h", "h", "wall thickness", 12, "in");
  const lw = input("wall.lw", "ℓ_w", "wall length", 336, "in");
  return derive({
    id: "wall.Acv",
    symbol: "A_cv",
    label: "gross area resisting shear",
    value: 4032,
    unit: "in2",
    formula: "A_{cv} = h\\,\\ell_w",
    substitution: "A_{cv} = 12 \\times 336 = 4032\\ \\text{in}^2",
    ref: aci("11.5.4"),
    inputs: [h, lw],
  });
}

describe("validateTrace", () => {
  it("accepts a well-formed graph", () => {
    expect(() => validateTrace([tinyTrace()])).not.toThrow();
  });

  it("accepts constants with a code reference", () => {
    const phi = constant("shear.phi", "φ", "strength reduction factor", 0.75, "1", aci("21.2.1"));
    const node = derive({
      id: "shear.phiVn",
      symbol: "φV_n",
      label: "design shear strength",
      value: 428,
      unit: "kip",
      formula: "\\phi V_n",
      substitution: "0.75 \\times 570 = 428",
      inputs: [phi, input("shear.Vn", "V_n", "nominal shear strength", 570, "kip")],
    });
    expect(() => validateTrace([node])).not.toThrow();
  });

  it("catches a cycle", () => {
    const seed = input("seed", "s", "s", 1, "1");
    const a = derive({
      id: "a",
      symbol: "a",
      label: "a",
      value: 1,
      unit: "1",
      formula: "a = s",
      substitution: "a = 1",
      inputs: [seed],
    });
    const b = derive({
      id: "b",
      symbol: "b",
      label: "b",
      value: 2,
      unit: "1",
      formula: "b = 2a",
      substitution: "b = 2(1)",
      inputs: [a],
    });
    a.inputs.push(b);
    expect(() => validateTrace([b])).toThrow(/cycle/);
  });

  it("catches a bare-object leaf", () => {
    const bare: Traced = { id: "bare", symbol: "x", label: "smuggled number", value: 1, unit: "1", inputs: [] };
    const node = derive({
      id: "root",
      symbol: "y",
      label: "y",
      value: 2,
      unit: "1",
      formula: "y = 2x",
      substitution: "y = 2(1)",
      inputs: [bare],
    });
    expect(() => validateTrace([node])).toThrow(/not created by input\(\) or constant\(\)/);
  });

  it("catches a derived node without a substitution", () => {
    expect(() =>
      derive({
        id: "root",
        symbol: "y",
        label: "y",
        value: 2,
        unit: "1",
        formula: "y = 2x",
        substitution: "",
        inputs: [input("x", "x", "x", 1, "1")],
      }),
    ).toThrow(/substitution is required/);

    const sneaky: Traced = {
      id: "root",
      symbol: "y",
      label: "y",
      value: 2,
      unit: "1",
      formula: "y = 2x",
      inputs: [input("x", "x", "x", 1, "1")],
    };
    expect(() => validateTrace([sneaky])).toThrow(/no substitution/);
  });

  it("catches a duplicate id in one graph", () => {
    const a = input("dup", "a", "a", 1, "1");
    const b = input("dup", "b", "b", 2, "1");
    const node = derive({
      id: "root",
      symbol: "c",
      label: "c",
      value: 3,
      unit: "1",
      formula: "c = a + b",
      substitution: "c = 1 + 2",
      inputs: [a, b],
    });
    expect(() => validateTrace([node])).toThrow(/duplicate trace id/);
  });

  it("allows the same node object to be shared by two parents", () => {
    const shared = input("shared", "s", "s", 1, "1");
    const left = derive({
      id: "left",
      symbol: "L",
      label: "L",
      value: 1,
      unit: "1",
      formula: "L = s",
      substitution: "L = 1",
      inputs: [shared],
    });
    const right = derive({
      id: "right",
      symbol: "R",
      label: "R",
      value: 1,
      unit: "1",
      formula: "R = s",
      substitution: "R = 1",
      inputs: [shared],
    });
    const root = derive({
      id: "root",
      symbol: "T",
      label: "T",
      value: 2,
      unit: "1",
      formula: "T = L + R",
      substitution: "T = 1 + 1",
      inputs: [left, right],
    });
    expect(() => validateTrace([root])).not.toThrow();
  });
});

describe("flattenTrace", () => {
  it("returns dependencies before dependents, once each", () => {
    const root = tinyTrace();
    const flat = flattenTrace(root);
    expect(flat.map((n) => n.id)).toEqual(["wall.h", "wall.lw", "wall.Acv"]);
  });

  it("dedupes shared nodes", () => {
    const shared = input("shared", "s", "s", 1, "1");
    const mk = (id: string) =>
      derive({
        id,
        symbol: id,
        label: id,
        value: 1,
        unit: "1",
        formula: "f",
        substitution: "f",
        inputs: [shared],
      });
    const root = derive({
      id: "root",
      symbol: "r",
      label: "r",
      value: 2,
      unit: "1",
      formula: "f",
      substitution: "f",
      inputs: [mk("a"), mk("b")],
    });
    expect(flattenTrace(root).map((n) => n.id)).toEqual(["shared", "a", "b", "root"]);
  });
});

describe("checkResult", () => {
  const mkUtil = (value: number) =>
    derive({
      id: "u",
      symbol: "V_u/φV_n",
      label: "utilization",
      value,
      unit: "1",
      formula: "V_u/\\phi V_n",
      substitution: `${value}`,
      inputs: [input("vu", "V_u", "demand", 235, "kip")],
    });

  it("is ok below capacity", () => {
    const r = checkResult({
      id: "shear",
      title: "In-plane shear",
      ref: aci("11.5.4"),
      utilization: mkUtil(0.55),
      trace: [tinyTrace()],
    });
    expect(r.status).toBe("ok");
  });

  it("is ng above capacity", () => {
    const r = checkResult({
      id: "shear",
      title: "In-plane shear",
      ref: aci("11.5.4"),
      utilization: mkUtil(1.01),
      trace: [tinyTrace()],
    });
    expect(r.status).toBe("ng");
  });

  it("is ok exactly at capacity", () => {
    const r = checkResult({
      id: "shear",
      title: "In-plane shear",
      ref: aci("11.5.4"),
      utilization: mkUtil(1),
      trace: [tinyTrace()],
    });
    expect(r.status).toBe("ok");
  });

  it("propagates a warning from a trace node", () => {
    const warned = derive({
      id: "w",
      symbol: "w",
      label: "w",
      value: 1,
      unit: "1",
      formula: "f",
      substitution: "f",
      inputs: [input("x", "x", "x", 1, "1")],
      status: "warning",
    });
    const r = checkResult({
      id: "shear",
      title: "In-plane shear",
      ref: aci("11.5.4"),
      utilization: mkUtil(0.4),
      trace: [warned],
    });
    expect(r.status).toBe("warning");
  });

  it("propagates ng from a trace node over a passing utilization", () => {
    const failed = derive({
      id: "w",
      symbol: "w",
      label: "w",
      value: 1,
      unit: "1",
      formula: "f",
      substitution: "f",
      inputs: [input("x", "x", "x", 1, "1")],
      status: "ng",
    });
    const r = checkResult({
      id: "shear",
      title: "In-plane shear",
      ref: aci("11.5.4"),
      utilization: mkUtil(0.4),
      trace: [failed],
    });
    expect(r.status).toBe("ng");
  });
});

describe("traceToMarkdown", () => {
  it("renders a readable report", () => {
    const check = checkResult({
      id: "acv",
      title: "Gross shear area",
      ref: aci("11.5.4"),
      utilization: undefined,
      trace: [tinyTrace()],
    });
    expect(traceToMarkdown(check)).toMatchInlineSnapshot(`
      "## Gross shear area

      ACI 318-19 §11.5.4 — **OK**

      - **A_cv** = 4,032 in2 — gross area resisting shear — ACI 318-19 §11.5.4
        - formula: \`A_{cv} = h\\,\\ell_w\`
        - subst: \`A_{cv} = 12 \\times 336 = 4032\\ \\text{in}^2\`
        - **h** = 12.0 in — wall thickness
        - **ℓ_w** = 336 in — wall length"
    `);
  });
});
