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
import { decodeWallInput, encodeWallInput } from "@/lib/wall-codec";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "shear0.pinned-options.v1";
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

/** Steel weight per vertical foot of wall, lb/ft: As (in²) × 490 pcf / 144. */
const STEEL_LB_PER_FT_PER_IN2 = 490 / 144;

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
      const raw = sessionStorage.getItem(STORAGE_KEY);
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
    try {
      series.push({
        id: "current",
        label: "current",
        token: "line",
        width: 2,
        points: designCurve(input, { points: CURVE_POINTS }).map((p) => ({ x: p.phiMn, y: p.phiPn })),
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
          points: designCurve(option.input, { points: CURVE_POINTS }).map((p) => ({
            x: p.phiMn,
            y: p.phiPn,
          })),
        });
      } catch {
        // an option the engine cannot curve still shows in the table
      }
    }
    return series;
  }, [input, options]);

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
              x={{ label: "M  (kip-ft)", format: (v) => fmt(v, { dp: 0 }), include: [0] }}
              y={{ label: "P  (kip)", format: (v) => fmt(v, { dp: 0 }), include: [0] }}
              focus="nearest"
              tooltip={(point) =>
                `${point.label}\nφMn ${num(point.x)} kip-ft · φPn ${num(point.y)} kip`
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
                      vertical steel (lb/ft)
                    </th>
                    <SteelCell input={input} />
                    {options.map((option) => (
                      <SteelCell key={option.letter} input={option.input} />
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

function SteelCell({ input }: { input: WallInput }) {
  let text = "—";
  try {
    const As = totalVerticalAs(input);
    text = `${fmt(As * STEEL_LB_PER_FT_PER_IN2, { dp: 1 })}`;
  } catch {
    // leave the dash
  }
  return <td className="py-1 pr-3 text-right tabular-nums">{text}</td>;
}
