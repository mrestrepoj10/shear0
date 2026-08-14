import { describe, expect, it } from "vitest";
import {
  convert,
  fmt,
  fmtTex,
  ftToIn,
  inToFt,
  kipFtToKipIn,
  kipInToKipFt,
  ksiToPsi,
  psiToKsi,
  sqrtFcPsi,
} from "../src/units";

describe("conversions", () => {
  it("round-trips length", () => {
    expect(ftToIn(28)).toBe(336);
    expect(inToFt(ftToIn(92))).toBeCloseTo(92, 12);
  });

  it("round-trips moment", () => {
    expect(kipFtToKipIn(18600)).toBe(223200);
    expect(kipInToKipFt(kipFtToKipIn(18600))).toBeCloseTo(18600, 9);
  });

  it("round-trips stress", () => {
    expect(psiToKsi(5000)).toBe(5);
    expect(ksiToPsi(psiToKsi(60000))).toBe(60000);
  });

  it("converts via the general helper", () => {
    expect(convert(28, "ft", "in")).toBe(336);
    expect(convert(336, "in", "ft")).toBe(28);
    expect(convert(18600, "kip-ft", "kip-in")).toBe(223200);
    expect(convert(5000, "psi", "ksi")).toBe(5);
    expect(convert(5, "ksi", "psi")).toBe(5000);
    expect(convert(0.0043, "1", "pct")).toBeCloseTo(0.43, 12);
    expect(convert(7, "kip", "kip")).toBe(7);
  });

  it("throws on an unsupported pair", () => {
    expect(() => convert(1, "in", "kip")).toThrow(/unsupported unit conversion/);
  });
});

describe("sqrtFcPsi", () => {
  it("returns sqrt of f'c in psi", () => {
    expect(sqrtFcPsi(5)).toBeCloseTo(70.71, 2);
    expect(sqrtFcPsi(4)).toBeCloseTo(63.246, 3);
  });

  it("rejects negative f'c", () => {
    expect(() => sqrtFcPsi(-1)).toThrow();
  });
});

describe("fmt", () => {
  it("formats with thousands separators", () => {
    expect(fmt(1711.2)).toBe("1,711");
    expect(fmt(4032)).toBe("4,032");
    expect(fmt(223200)).toBe("223,200");
  });

  it("honors explicit decimals", () => {
    expect(fmt(0.0043, { dp: 4 })).toBe("0.0043");
    expect(fmt(3.2857, { dp: 3 })).toBe("3.286");
    expect(fmt(570, { dp: 1 })).toBe("570.0");
  });

  it("picks sensible decimals automatically", () => {
    expect(fmt(0.0043)).toBe("0.0043");
    expect(fmt(0.85)).toBe("0.850");
    expect(fmt(3.2857)).toBe("3.29");
    expect(fmt(12.5)).toBe("12.5");
    expect(fmt(0)).toBe("0");
  });

  it("escapes the thousands separator for LaTeX", () => {
    expect(fmtTex(4032)).toBe("4{,}032");
    expect(fmtTex(0.8)).toBe("0.800");
  });

  it("handles negatives and non-finite values", () => {
    expect(fmt(-1711.2)).toBe("-1,711");
    expect(fmt(Number.NaN)).toBe("NaN");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
