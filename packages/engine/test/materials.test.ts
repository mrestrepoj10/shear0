import { describe, expect, it } from "vitest";
import { BARS, Ec, GRADE60, GRADE80, bar, beta1, concrete } from "../src/materials";
import { validateTrace } from "../src/trace";

describe("concrete", () => {
  it("stores f'c in ksi", () => {
    expect(concrete(5000).fc).toBe(5);
    expect(concrete(5000).lambda).toBe(1);
    expect(concrete(4000, 0.75).lambda).toBe(0.75);
  });

  it("rejects non-positive f'c", () => {
    expect(() => concrete(0)).toThrow();
  });
});

describe("beta1 (Table 22.2.2.4.3)", () => {
  it("is 0.85 at and below 4000 psi", () => {
    expect(beta1(concrete(3000)).value).toBeCloseTo(0.85, 12);
    expect(beta1(concrete(4000)).value).toBeCloseTo(0.85, 12);
  });

  it("interpolates between 4000 and 8000 psi", () => {
    expect(beta1(concrete(5000)).value).toBeCloseTo(0.8, 12);
    expect(beta1(concrete(6000)).value).toBeCloseTo(0.75, 12);
    expect(beta1(concrete(7900)).value).toBeCloseTo(0.655, 12);
  });

  it("is 0.65 at and above 8000 psi", () => {
    expect(beta1(concrete(8000)).value).toBeCloseTo(0.65, 12);
    expect(beta1(concrete(9000)).value).toBeCloseTo(0.65, 12);
  });

  it("carries a valid trace with the table reference", () => {
    const b = beta1(concrete(5000));
    expect(b.ref?.section).toBe("22.2.2.4.3");
    expect(() => validateTrace([b])).not.toThrow();
  });
});

describe("Ec (19.2.2.1b)", () => {
  it("is 57000 sqrt(f'c) in psi", () => {
    const e = Ec(concrete(5000));
    expect(e.value).toBeCloseTo(4030508.65, 1);
    expect(e.unit).toBe("psi");
    expect(() => validateTrace([e])).not.toThrow();
  });
});

describe("shared leaves", () => {
  it("reuses one f'c node across checks so merged graphs stay valid", () => {
    const c = concrete(5000);
    const b = beta1(c);
    const e = Ec(c);
    expect(b.inputs[0]).toBe(e.inputs[0]);
    expect(() => validateTrace([b, e])).not.toThrow();
  });
});

describe("rebar", () => {
  it("defines Grade 60 and Grade 80", () => {
    expect(GRADE60).toEqual({ fy: 60, Es: 29000, ety: 0.002 });
    expect(GRADE80.fy).toBe(80);
    expect(GRADE80.ety).toBeCloseTo(80 / 29000, 12);
  });

  it("has the US bar table #3-#11", () => {
    expect(Object.keys(BARS)).toEqual(["3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(bar("5")).toEqual({ db: 0.625, Ab: 0.31 });
    expect(bar("8")).toEqual({ db: 1.0, Ab: 0.79 });
    expect(bar("11")).toEqual({ db: 1.41, Ab: 1.56 });
    // #9 and up: Ab within 1% of the nominal 1.00/1.27/1.56 in2 values
    expect(bar("9").Ab).toBeCloseTo(1.0, 6);
    expect(bar("3").db).toBe(0.375);
  });
});
