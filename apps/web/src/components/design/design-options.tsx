"use client";

/**
 * Pinned design options — "A vs B", in one view instead of two browser tabs.
 *
 * A design is already a value in this app (the URL codec), so an *option* is
 * just a pinned payload with a letter. Pin the current wall, change anything,
 * pin again: every pinned option re-runs the engine here and the panel shows
 * the comparison a reviewer actually asks for — the P–M surfaces overlaid,
 * the worst utilization per check side by side, and the vertical steel each
 * option spends to get there. Pins live in `sessionStorage`: they survive
 * edits and reloads in this tab, and vanish with it — deliberately short of
 * "saved projects", which PLAN.md keeps out of scope.
 *
 * Follow-up noted while building this (out of scope here): a Pareto scatter
 * of steel weight vs governing utilization over the whole candidate grid —
 * pinned options and the current design plotted on it — to answer "is there
 * a cheaper wall that still passes?".
 */

import {
  checkOrdinaryWall,
  checkSpecialWall,
  designCurve,
  fmt,
  totalVerticalAs,
  type CheckResult,
  type CheckStatus,
  type WallInput,
  type WallReport,
} from "@shear0/engine";
import { memo, useMemo, useSyncExternalStore } from "react";
import { XyChart, type XySeries } from "@/components/charts/xy-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, num, statusText } from "@/components/design/status";
import { normalizedStatus } from "@/components/design/results-summary";
import { viewOf, type UnitsView } from "@/lib/units-view";
import { decodeWallInput, encodeWallInput } from "@/lib/wall-codec";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "shear0.pinned-options.v1";
/**
 * The key this store used before the project was renamed. `sessionStorage`
 * survives a reload, so a tab that was open across the deploy still holds its
 * pins under the old name — and the URL cannot recover them, it carries only
 * the current wall. Read it as a fallback so nobody's comparison silently
 * empties itself; the next pin writes under the new key and the old one is
 * never read again. Safe to delete once the rename is a release or two old.
 */
const LEGACY_STORAGE_KEY = "kern.pinned-options.v1";
const MAX_OPTIONS = 3;
const OPTION_LETTERS = ["A", "B", "C"] as const;
const CURVE_POINTS = 80;

/**
 * One dash pattern per option letter, so three same-token curves stay
 * tellable apart even where they cross — the legend repeats the pattern next
 * to each letter. Monochrome stays monochrome; identity rides on texture.
 */
const OPTION_DASH: Record<(typeof OPTION_LETTERS)[number], string> = {
  A: "7 3",
  B: "2 3",
  C: "8 2 2 2",
};

/**
 * Steel weight per vertical foot of wall, kip/ft: As (in²) × 490 pcf / 144 /
 * 1000. Held in kip rather than lb so the SI column can be reached through the
 * engine's own kip → kN conversion; the 490 pcf density is a material property,
 * not a unit conversion, and is the same steel in either edition.
 */
const STEEL_KIP_PER_FT_PER_IN2 = 490 / 144 / 1000;

interface EvaluatedOption {
  letter: string;
  encoded: string;
  input: WallInput;
  report: WallReport;
}

/**
 * The pins as a tiny external store over `sessionStorage`, read through
 * `useSyncExternalStore`: the server snapshot is always empty (storage is
 * browser-only), the client hydrates to the same and then re-renders once
 * with the real pins — no setState-in-effect, no hydration mismatch.
 */
const EMPTY_PINS: string[] = [];
let pinsCache: string[] = EMPTY_PINS;
let pinsLoaded = false;
const pinListeners = new Set<() => void>();

function readPins(): string[] {
  if (!pinsLoaded) {
    pinsLoaded = true;
    try {
      // Read-only fallback, never a write: this runs inside the
      // `useSyncExternalStore` snapshot, which must stay free of side effects.
      const raw =
        sessionStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(LEGACY_STORAGE_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (Array.isArray(parsed)) {
        pinsCache = parsed.filter((p): p is string => typeof p === "string");
      }
    } catch {
      pinsCache = EMPTY_PINS;
    }
  }
  return pinsCache;
}

function writePins(next: string[]): void {
  pinsCache = next;
  pinsLoaded = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked — the in-memory pins still work this session
  }
  for (const listener of pinListeners) listener();
}

function subscribePins(listener: () => void): () => void {
  pinListeners.add(listener);
  return () => pinListeners.delete(listener);
}

function runChecks(input: WallInput): WallReport | null {
  try {
    return input.system === "special" ? checkSpecialWall(input) : checkOrdinaryWall(input);
  } catch {
    return null;
  }
}

/** Worst utilization per check id across load cases; pass/fail checks report status only. */
function utilizationById(report: WallReport): Map<string, { title: string; u: number | null; status: CheckStatus }> {
  const out = new Map<string, { title: string; u: number | null; status: CheckStatus }>();
  const consider = (check: CheckResult) => {
    const u = check.utilization?.value;
    const finite = typeof u === "number" && Number.isFinite(u) ? u : null;
    const prev = out.get(check.id);
    if (
      prev === undefined ||
      (finite !== null && (prev.u === null || finite > prev.u)) ||
      (check.status === "ng" && prev.status !== "ng")
    ) {
      out.set(check.id, {
        title: check.title,
        u: finite !== null && prev?.u !== undefined && prev.u !== null ? Math.max(finite, prev.u) : (finite ?? prev?.u ?? null),
        status: check.status === "ng" || prev?.status === "ng" ? "ng" : check.status,
      });
    }
  };
  for (const check of report.general) consider(check);
  for (const group of report.perDemand) for (const check of group.checks) consider(check);
  return out;
}

export const DesignOptions = memo(function DesignOptions({
  input,
  report,
}: {
  input: WallInput;
  report: WallReport;
}) {
  const pins = useSyncExternalStore(subscribePins, readPins, () => EMPTY_PINS);
  const persist = writePins;
  const U = viewOf(input);

  const currentEncoded = useMemo(() => encodeWallInput(input), [input]);

  const options = useMemo(() => {
    const out: EvaluatedOption[] = [];
    pins.forEach((encoded, index) => {
      const decoded = decodeWallInput(encoded);
      if (decoded === null) return;
      const optionReport = runChecks(decoded);
      if (optionReport === null) return;
      out.push({
        letter: OPTION_LETTERS[index] ?? "?",
        encoded,
        input: decoded,
        report: optionReport,
      });
    });
    return out;
  }, [pins]);

  const overlay = useMemo(() => {
    const series: XySeries[] = [];
    // `designCurve` reports in each wall's *own* system, and a pinned option
    // may have been saved in the other one. Everything is replotted on the
    // current view's axes — through the option's own view, so the round trip
    // is the engine's conversion in both directions and never a factor here.
    const onCurrentAxes = (option: WallInput) => {
      const V = viewOf(option);
      return designCurve(option, { points: CURVE_POINTS }).map((p) => ({
        x: U.moment(V.toKipFt(p.phiMn)),
        y: U.force(V.toKip(p.phiPn)),
      }));
    };
    try {
      series.push({
        id: "current",
        label: "current",
        token: "line",
        width: 2,
        points: onCurrentAxes(input),
      });
    } catch {
      return [];
    }
    for (const option of options) {
      try {
        series.push({
          id: `option-${option.letter}`,
          label: `option ${option.letter}`,
          token: "muted",
          dash: OPTION_DASH[option.letter as keyof typeof OPTION_DASH] ?? "4 3",
          width: 1.4,
          points: onCurrentAxes(option.input),
        });
      } catch {
        // an option the engine cannot curve still shows in the table
      }
    }
    return series;
  }, [input, options, U]);

  // Union of check ids, in the order the current design reports them.
  const rows = useMemo(() => {
    const current = utilizationById(report);
    const perOption = options.map((option) => utilizationById(option.report));
    const ids = new Map<string, string>();
    for (const [id, entry] of current) ids.set(id, entry.title);
    for (const byId of perOption) {
      for (const [id, entry] of byId) if (!ids.has(id)) ids.set(id, entry.title);
    }
    return { current, perOption, ids: [...ids.entries()] };
  }, [report, options]);

  const alreadyPinned = pins.includes(currentEncoded);

  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle
            render={<h2 />}
            className="font-mono text-xs font-medium tracking-tight text-muted-foreground"
          >
            design options
          </CardTitle>
          <Button
            variant="outline"
            size="xs"
            className="font-mono text-2xs"
            disabled={alreadyPinned || pins.length >= MAX_OPTIONS}
            onClick={() => persist([...pins, currentEncoded])}
          >
            {alreadyPinned
              ? "current design is pinned"
              : pins.length >= MAX_OPTIONS
                ? `${MAX_OPTIONS} options max`
                : "pin current design"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {options.length === 0 ? (
          <p className="py-2 font-mono text-xs2 text-muted-foreground">
            pin the current design, change anything, and pin again — the options compare here,
            P–M surfaces overlaid and utilizations side by side
          </p>
        ) : (
          <>
            <XyChart
              ariaLabel="Design interaction surfaces of the current design and each pinned option"
              ariaDescription="The current design surface is solid; each pinned option has its own dash pattern, named in the legend."
              series={overlay}
              height={240}
              x={{ label: `M  (${U.momentUnit})`, format: (v) => fmt(v, { dp: 0 }), include: [0] }}
              y={{ label: `P  (${U.forceUnit})`, format: (v) => fmt(v, { dp: 0 }), include: [0] }}
              focus="nearest"
              tooltip={(point) =>
                `${point.label}\nφMn ${num(point.x)} ${U.momentUnit} · φPn ${num(point.y)} ${U.forceUnit}`
              }
            />

            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs2">
                <caption className="sr-only">
                  Worst utilization per check for the current design and each pinned option
                </caption>
                <thead>
                  <tr className="text-left text-2xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-normal">
                      check
                    </th>
                    <th scope="col" className="py-1 pr-3 text-right font-normal">
                      current
                    </th>
                    {options.map((option) => (
                      <th
                        key={option.letter}
                        scope="col"
                        className="py-1 pr-3 text-right font-normal"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          option {option.letter}
                          <button
                            type="button"
                            aria-label={`remove option ${option.letter}`}
                            className="text-muted-foreground/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                            onClick={() => persist(pins.filter((p) => p !== option.encoded))}
                          >
                            ×
                          </button>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.ids.map(([id, title]) => {
                    const cell = (entry: { u: number | null; status: CheckStatus } | undefined) =>
                      entry === undefined ? (
                        <span className="text-muted-foreground/50">—</span>
                      ) : (
                        <span className={cn(statusText(entry.status), "tabular-nums")}>
                          {entry.u === null ? (entry.status === "ng" ? "ng" : "ok") : num(entry.u, 2)}
                        </span>
                      );
                    return (
                      <tr key={id} className="border-t border-border/60">
                        <th scope="row" className="max-w-56 truncate py-1 pr-3 text-left font-normal text-muted-foreground">
                          {title}
                        </th>
                        <td className="py-1 pr-3 text-right">{cell(rows.current.get(id))}</td>
                        {rows.perOption.map((byId, i) => (
                          <td key={i} className="py-1 pr-3 text-right">
                            {cell(byId.get(id))}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
                      vertical steel ({U.si ? "kN/m" : "lb/ft"})
                    </th>
                    <SteelCell input={input} U={U} />
                    {options.map((option) => (
                      <SteelCell key={option.letter} input={option.input} U={U} />
                    ))}
                  </tr>
                  <tr className="border-t border-border/60">
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
                      overall
                    </th>
                    {/* Normalized like the verdict strip: an all-zero load set
                        is an unasked question, not a pass — the comparison must
                        never contradict the page-level verdict. */}
                    <td className="py-1 pr-3 text-right">
                      <StatusBadge status={normalizedStatus(report)} />
                    </td>
                    {options.map((option) => (
                      <td key={option.letter} className="py-1 pr-3 text-right">
                        <StatusBadge status={normalizedStatus(option.report)} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <DashSwatch dash={null} />
                current
              </span>
              {options.map((option) => (
                <span key={option.letter} className="flex items-center gap-1.5">
                  <DashSwatch
                    dash={OPTION_DASH[option.letter as keyof typeof OPTION_DASH] ?? "4 3"}
                  />
                  option {option.letter}
                </span>
              ))}
              <span>utilizations are the worst across load cases</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});

/** The legend's line sample: solid for the current design, the option's own dash otherwise. */
function DashSwatch({ dash }: { dash: string | null }) {
  return (
    <svg width={18} height={6} aria-hidden="true">
      <line
        x1="0"
        y1="3"
        x2="18"
        y2="3"
        stroke="currentColor"
        strokeWidth={dash === null ? 2 : 1.4}
        strokeDasharray={dash ?? undefined}
        className={dash === null ? "text-foreground" : "text-muted-foreground"}
      />
    </svg>
  );
}

/**
 * Vertical steel spend, in the *current* view's unit even for a pinned option
 * that was saved in the other system — the column has one header, so it must
 * have one unit.
 *
 * lb/ft in-lb, kN/m in SI: kN/m is the honest metric reading of a weight per
 * length. kg/m would need a mass density the trace has no `Unit` tag for, and
 * inventing 7850 here would be exactly the hardcoded factor this feature
 * exists to avoid. The kip → kN step is the engine's; the per-foot → per-metre
 * step is the display length of one foot, so no factor is written down either.
 */
function steelText(input: WallInput, U: UnitsView): string {
  const kipPerFt = totalVerticalAs(input) * STEEL_KIP_PER_FT_PER_IN2;
  if (!U.si) return fmt(kipPerFt * 1000, { dp: 1 });
  return fmt((U.scheme.frc(kipPerFt) * 1000) / U.scheme.len(12), { dp: 2 });
}

function SteelCell({ input, U }: { input: WallInput; U: UnitsView }) {
  let text = "—";
  try {
    text = steelText(input, U);
  } catch {
    // leave the dash
  }
  return <td className="py-1 pr-3 text-right tabular-nums">{text}</td>;
}
