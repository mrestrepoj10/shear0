"use client";

/**
 * The wall definition, grouped the way a designer thinks about it:
 * geometry → materials → reinforcement → demands. Every edit dispatches into
 * the reducer and the whole check set re-runs before the next paint.
 */

import {
  Acv,
  BARS,
  Ec,
  amplifiedShear,
  beta1,
  fmt,
  hwOverLw,
  totalVerticalAs,
  type BarSize,
  type Demands,
  type DistributedLayer,
  type SeismicParams,
  type WallInput,
} from "@shear0/engine";
import { Plus, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  stationSourceAt,
  type StationSource,
} from "@/components/design/drawing/plan-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DerivedRow,
  FieldGroup,
  FieldRow,
  NumberField,
  SelectField,
  type SelectOption,
} from "@/components/design/fields";
import { encodeWallInput } from "@/lib/url-state";
import {
  BAR_SIZES,
  PRESETS,
  PRESET_LABELS,
  PRESET_ORDER,
  PRESET_SHORT,
  useSelection,
  useWallDispatch,
  useWallInput,
  type PresetId,
  type WallAction,
} from "@/lib/wall-state";
import { cn } from "@/lib/utils";

const BAR_OPTIONS: SelectOption<BarSize>[] = BAR_SIZES.map((size) => ({
  value: size,
  label: `#${size}`,
}));

/**
 * The control column is a fixed 8.5rem, which is ~11 mono characters once the
 * trigger's padding and chevron are paid for: "0.8 — restrained top & bottom"
 * rendered as "0.8 — restr…". The option carries the end condition in one word
 * and the hint below the label spells it out.
 */
const K_OPTIONS: SelectOption<"0.8" | "1" | "2">[] = [
  { value: "0.8", label: "0.8 fixed" },
  { value: "1", label: "1.0 pinned" },
  { value: "2", label: "2.0 free" },
];

/** Measured against the 208 px label column: 31 characters is the whole budget. */
const K_HINTS: Record<"0.8" | "1" | "2", string> = {
  "0.8": "11.5.3.1 · restrained both ends",
  "1": "11.5.3.1 · pinned both ends",
  "2": "11.5.3.1 · cantilever, free top",
};

const GRADE_OPTIONS: SelectOption<"60" | "80">[] = [
  { value: "60", label: "Grade 60" },
  { value: "80", label: "Grade 80" },
];

const WALL_TYPE_OPTIONS: SelectOption<"bearing" | "nonbearing">[] = [
  { value: "bearing", label: "bearing" },
  { value: "nonbearing", label: "nonbearing" },
];

const SDC_OPTIONS: SelectOption<SeismicParams["sdc"]>[] = (
  ["A", "B", "C", "D", "E", "F"] as const
).map((sdc) => ({ value: sdc, label: `SDC ${sdc}` }));

/** Same 11-character budget: the section number *is* the reading, and the
 *  paragraph under the group says what each one does. */
const PHI_READING_OPTIONS: SelectOption<"handbook-conservative" | "exempt-18.10.4.6">[] = [
  { value: "handbook-conservative", label: "21.2.4.1" },
  { value: "exempt-18.10.4.6", label: "18.10.4.6" },
];

/** How a preset is named in a sentence, for the undo toast. */
const PRESET_PHRASE: Record<PresetId, string> = {
  "example-1": "example 1",
  "example-2": "example 2",
  blank: "a blank wall",
};

/**
 * The undo toast for an action that throws a wall away. There is no history
 * entry to go back to — the URL sync uses `replaceState` — so this toast *is*
 * the recovery path, and it is monochrome like every other one.
 */
function undoToast(title: string, restore: () => void): void {
  notify({ title, duration: 6000, action: { label: "undo", onClick: restore } });
}

/**
 * The presets pre-encoded once, at module scope: the presets are constants, so
 * re-encoding all three on every keystroke was pure waste.
 */
const PRESET_CODES: { id: PresetId; code: string }[] = PRESET_ORDER.map((id) => ({
  id,
  code: encodeWallInput(PRESETS[id]),
}));

/** ρ = n_c·A_b/(s·h), the same expression the 11.6 check traces. */
function rho(layer: DistributedLayer, h: number): number {
  return (layer.curtains * BARS[layer.bar].Ab) / (layer.spacing * h);
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <CardTitle className="font-mono text-xs font-medium tracking-tight text-muted-foreground">
            {title}
          </CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

function GeometryCard({ input, dispatch }: PanelProps) {
  const { geometry } = input;
  const setLength = (field: "lw" | "h" | "hw" | "lu" | "cover") => (value: number | undefined) => {
    if (value !== undefined) dispatch({ type: "setGeometry", field, value });
  };

  return (
    <SectionCard title="geometry">
      <FieldGroup>
        <FieldRow label="wall length ℓw">
          <NumberField value={geometry.lw} onValueChange={setLength("lw")} unit="in" min={1} />
        </FieldRow>
        <FieldRow label="thickness h">
          <NumberField value={geometry.h} onValueChange={setLength("h")} unit="in" min={1} />
        </FieldRow>
        <FieldRow label="wall height hw">
          <NumberField value={geometry.hw} onValueChange={setLength("hw")} unit="in" min={1} />
        </FieldRow>
        <FieldRow label="unsupported height ℓu">
          <NumberField value={geometry.lu} onValueChange={setLength("lu")} unit="in" min={1} />
        </FieldRow>
        <FieldRow label="clear cover">
          <NumberField
            value={geometry.cover}
            onValueChange={setLength("cover")}
            unit="in"
            min={0}
            step={0.25}
          />
        </FieldRow>
        <FieldRow
          label="effective length factor k"
          hint={K_HINTS[geometry.k === 0.8 ? "0.8" : geometry.k === 2 ? "2" : "1"]}
        >
          <SelectField
            value={geometry.k === 0.8 ? "0.8" : geometry.k === 2 ? "2" : "1"}
            options={K_OPTIONS}
            onValueChange={(value) =>
              dispatch({ type: "setK", value: value === "0.8" ? 0.8 : value === "2" ? 2.0 : 1.0 })
            }
          />
        </FieldRow>
        <FieldRow label="wall type" hint="Table 11.3.1.1">
          <SelectField
            value={input.wallType}
            options={WALL_TYPE_OPTIONS}
            onValueChange={(value) => dispatch({ type: "setWallType", value })}
          />
        </FieldRow>
      </FieldGroup>
      <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
        <DerivedRow label="hw/ℓw" value={fmt(hwOverLw(input).value, { dp: 3 })} />
        <DerivedRow label="Acv" value={`${fmt(Acv(input).value)} in²`} />
      </div>
    </SectionCard>
  );
}

function MaterialsCard({ input, dispatch }: PanelProps) {
  const fcPsi = input.concrete.fc * 1000;
  return (
    <SectionCard title="materials">
      <FieldGroup>
        <FieldRow label="concrete f'c">
          <NumberField
            value={fcPsi}
            onValueChange={(value) => {
              if (value === undefined || value <= 0) return false;
              dispatch({ type: "setConcrete", patch: { fcPsi: value } });
              return true;
            }}
            unit="psi"
            min={1}
            step={500}
          />
        </FieldRow>
        <FieldRow label="lightweight factor λ" hint="19.2.4">
          <NumberField
            value={input.concrete.lambda}
            onValueChange={(value) => {
              if (value === undefined || value <= 0) return false;
              dispatch({ type: "setConcrete", patch: { lambda: value } });
              return true;
            }}
            min={0.75}
            step={0.05}
          />
        </FieldRow>
        <FieldRow label="reinforcement grade" hint="20.2.2">
          <SelectField
            value={input.grade.fy === 80 ? "80" : "60"}
            options={GRADE_OPTIONS}
            onValueChange={(value) => dispatch({ type: "setGrade", fy: value === "80" ? 80 : 60 })}
          />
        </FieldRow>
      </FieldGroup>
      <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
        <DerivedRow label="β₁" value={fmt(beta1(input.concrete).value, { dp: 3 })} />
        <DerivedRow label="Ec" value={`${fmt(Ec(input.concrete).value)} psi`} />
        <DerivedRow label="fy" value={`${fmt(input.grade.fy)} ksi`} />
      </div>
    </SectionCard>
  );
}

/**
 * The other half of the selection the plan section publishes.
 *
 * Hovering or tabbing a bar station in the drawing says "this bar, at this x";
 * the answer to "which row put it there" is these two fields, so they light up.
 * `stationSourceAt` is the plan section's own rule, exported rather than
 * re-derived — the bar positions are the engine's and the end-zone reach is
 * computed in exactly one place.
 */
function ReinforcementCard({ input, dispatch }: PanelProps) {
  const { endZone } = input;
  const curtains = Math.min(input.vertical.curtains, input.horizontal.curtains);
  const selection = useSelection();
  const lit =
    selection?.kind === "bar-station" ? stationSourceAt(input, selection.x) : null;
  /** the highlight itself: a tint, at the row's own rhythm, nothing that moves */
  const litRow = (source: StationSource) =>
    cn(
      "-mx-1 rounded-sm px-1 transition-colors duration-150",
      lit === source && "bg-muted/40",
    );

  return (
    <SectionCard
      title="reinforcement"
      action={
        <ToggleGroup
          value={[String(curtains)]}
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next === undefined) return;
            dispatch({
              type: "setLayer",
              layer: "both",
              patch: { curtains: next === "1" ? 1 : 2 },
            });
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="curtains of reinforcement"
        >
          <ToggleGroupItem value="1" size="sm" variant="outline" className="font-mono text-xs2">
            1 curtain
          </ToggleGroupItem>
          <ToggleGroupItem value="2" size="sm" variant="outline" className="font-mono text-xs2">
            2 curtains
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <FieldGroup>
        <div className={cn("flex flex-col gap-1.5", litRow("vertical"))}>
          <FieldRow label="vertical bar" hint="ρℓ, longitudinal">
            <SelectField
              value={input.vertical.bar}
              options={BAR_OPTIONS}
              onValueChange={(bar) =>
                dispatch({ type: "setLayer", layer: "vertical", patch: { bar } })
              }
            />
          </FieldRow>
          <FieldRow label="vertical spacing">
            <NumberField
              value={input.vertical.spacing}
              onValueChange={(value) => {
                if (value === undefined || value <= 0) return false;
                dispatch({ type: "setLayer", layer: "vertical", patch: { spacing: value } });
                return true;
              }}
              unit="in"
              min={1}
            />
          </FieldRow>
        </div>
        <FieldRow label="horizontal bar" hint="ρt, transverse">
          <SelectField
            value={input.horizontal.bar}
            options={BAR_OPTIONS}
            onValueChange={(bar) =>
              dispatch({ type: "setLayer", layer: "horizontal", patch: { bar } })
            }
          />
        </FieldRow>
        <FieldRow label="horizontal spacing">
          <NumberField
            value={input.horizontal.spacing}
            onValueChange={(value) => {
              if (value === undefined || value <= 0) return false;
              dispatch({ type: "setLayer", layer: "horizontal", patch: { spacing: value } });
              return true;
            }}
            unit="in"
            min={1}
          />
        </FieldRow>
      </FieldGroup>

      <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
        <span className="font-mono text-xs2 text-muted-foreground">end-zone bars</span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            dispatch({
              type: "setEndZone",
              patch: endZone === undefined ? {} : null,
            })
          }
        >
          {endZone === undefined ? "add" : "remove"}
        </Button>
      </div>

      {endZone === undefined ? null : (
        <FieldGroup className={litRow("endZone")}>
          <FieldRow label="end-zone bar">
            <SelectField
              value={endZone.bar}
              options={BAR_OPTIONS}
              onValueChange={(bar) => dispatch({ type: "setEndZone", patch: { bar } })}
            />
          </FieldRow>
          <FieldRow label="bars per end" hint="all curtains">
            <NumberField
              value={endZone.count}
              onValueChange={(value) => {
                if (value !== undefined) dispatch({ type: "setEndZone", patch: { count: value } });
              }}
              min={0}
              step={1}
            />
          </FieldRow>
          <FieldRow label="end to first bar">
            <NumberField
              value={endZone.distanceToFirst}
              onValueChange={(value) => {
                if (value !== undefined) {
                  dispatch({ type: "setEndZone", patch: { distanceToFirst: value } });
                }
              }}
              unit="in"
              min={0}
            />
          </FieldRow>
          <FieldRow label="end-zone spacing">
            <NumberField
              value={endZone.spacing}
              onValueChange={(value) => {
                if (value === undefined || value <= 0) return false;
                dispatch({ type: "setEndZone", patch: { spacing: value } });
                return true;
              }}
              unit="in"
              min={1}
            />
          </FieldRow>
        </FieldGroup>
      )}

      <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
        <DerivedRow label="ρℓ provided" value={fmt(rho(input.vertical, input.geometry.h))} />
        <DerivedRow label="ρt provided" value={fmt(rho(input.horizontal, input.geometry.h))} />
        <DerivedRow label="Ast total (vertical)" value={`${fmt(totalVerticalAs(input))} in²`} />
      </div>
    </SectionCard>
  );
}

/**
 * Ω_v, ω_v and V_e for the combination that produces the largest design shear —
 * the three numbers a designer wants on screen *while* typing story counts and
 * heights, not three panels away. Straight off `amplifiedShear`, which the
 * 18.10.4 check consumes; a combination whose P_u the section cannot equilibrate
 * is skipped rather than crashing the panel.
 */
function seismicPreview(input: WallInput) {
  let best: { OmegaV: number; omegaV: number; Ve: number; label: string } | null = null;
  for (const demand of input.demands) {
    try {
      const ve = amplifiedShear(input, demand);
      if (best === null || ve.Ve.value > best.Ve) {
        best = {
          OmegaV: ve.OmegaV.value,
          omegaV: ve.omegaV.value,
          Ve: ve.Ve.value,
          label: demand.label ?? demand.id,
        };
      }
    } catch {
      // no neutral axis for this P_u — the flexure check reports it properly
    }
  }
  return best;
}

/**
 * Which check set runs, and everything §18.10 needs to run it: the ASCE 7
 * displacement quantities behind 18.10.6.2(a), the story count behind ω_v, and
 * the 21.2.4.1 reading the engine exposes as a setting.
 */
function SystemCard({ input, dispatch }: PanelProps) {
  const special = input.system === "special";
  const seismic = input.seismic;
  const preview = special ? seismicPreview(input) : null;
  const setSeismic =
    (field: "deltaE" | "Cd" | "ns" | "hsx") => (value: number | undefined) => {
      dispatch({ type: "setSeismic", patch: { [field]: value } });
    };

  return (
    <SectionCard
      title="system"
      action={
        <ToggleGroup
          value={[input.system]}
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next !== "ordinary" && next !== "special") return;
            dispatch({ type: "setSystem", value: next });
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="structural system"
        >
          <ToggleGroupItem
            value="ordinary"
            size="sm"
            variant="outline"
            className="font-mono text-xs2"
          >
            ordinary
          </ToggleGroupItem>
          <ToggleGroupItem
            value="special"
            size="sm"
            variant="outline"
            className="font-mono text-xs2"
          >
            special
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <p className="text-xs2 text-muted-foreground">
        {special
          ? "chapter 11 plus §18.10: Ve amplification, seismic web reinforcement, boundary elements."
          : "chapter 11 only — cast-in-place wall, no seismic detailing."}
      </p>

      {!special ? null : (
        <>
          <FieldGroup>
            <FieldRow label="seismic design category" hint="18.2.1">
              <SelectField
                value={seismic?.sdc ?? "D"}
                options={SDC_OPTIONS}
                onValueChange={(sdc) => dispatch({ type: "setSeismic", patch: { sdc } })}
              />
            </FieldRow>
            <FieldRow label="elastic deflection δe" hint="top of wall">
              <NumberField
                value={seismic?.deltaE}
                onValueChange={setSeismic("deltaE")}
                optional
                unit="in"
                min={0}
                step={0.1}
              />
            </FieldRow>
            <FieldRow label="deflection amplification Cd" hint="ASCE 7">
              <NumberField
                value={seismic?.Cd}
                onValueChange={setSeismic("Cd")}
                optional
                min={0}
                step={0.5}
              />
            </FieldRow>
            <FieldRow label="stories ns" hint="above the critical section">
              <NumberField
                value={seismic?.ns}
                onValueChange={setSeismic("ns")}
                optional
                min={0}
                step={1}
              />
            </FieldRow>
            <FieldRow label="story height hsx" hint="first story, 21.2.4.1">
              <NumberField
                value={seismic?.hsx}
                onValueChange={setSeismic("hsx")}
                optional
                unit="in"
                min={0}
              />
            </FieldRow>
            <FieldRow label="height above crit. section hwcs" hint="18.10.3.1 — blank = hw">
              <NumberField
                value={input.geometry.hwcs}
                onValueChange={(value) =>
                  dispatch({ type: "setGeometry", field: "hwcs", value })
                }
                optional
                unit="in"
                min={0}
              />
            </FieldRow>
            <FieldRow label="unsupported height hu" hint="18.10.6.4(b) — blank = ℓu">
              <NumberField
                value={input.geometry.hu}
                onValueChange={(value) => dispatch({ type: "setGeometry", field: "hu", value })}
                optional
                unit="in"
                min={0}
              />
            </FieldRow>
            <FieldRow label="φ for seismic shear" hint="21.2.4.1 / 18.10.4.6">
              <SelectField
                value={input.phiSeismicReading ?? "handbook-conservative"}
                options={PHI_READING_OPTIONS}
                onValueChange={(value) => dispatch({ type: "setPhiReading", value })}
              />
            </FieldRow>
          </FieldGroup>
          <p className="text-xs2 text-muted-foreground">
            {(input.phiSeismicReading ?? "handbook-conservative") === "handbook-conservative"
              ? "φ drops to 0.60 when Vn < the shear at Mn, as MNL-17 Ex. 2 does even on the 18.10.6.2 path."
              : "18.10.4.6 read literally: walls designed by 18.10.6.2 keep φ = 0.75."}
          </p>

          <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
            {preview === null ? (
              <DerivedRow label="Ve" value="—" />
            ) : (
              <>
                <DerivedRow label="Ωv" value={fmt(preview.OmegaV, { dp: 2 })} />
                <DerivedRow label="ωv" value={fmt(preview.omegaV, { dp: 3 })} />
                <DerivedRow
                  label={`Ve · ${preview.label}`}
                  value={`${fmt(preview.Ve)} kip`}
                />
              </>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * The **provided** special boundary element (18.10.6.4). The engine never sizes
 * one — it verifies what is drawn here, so every field is a detailing decision
 * and "none provided" is a legitimate state (and an ng if 18.10.6.2(a) fires).
 */
function BoundaryElementCard({ input, dispatch }: PanelProps) {
  const sbe = input.sbe;
  const cover = input.geometry.cover;

  return (
    <SectionCard
      title="boundary element"
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            if (sbe === undefined) {
              dispatch({ type: "setSbe", patch: {} });
              return;
            }
            // Eight detailing decisions, gone on one click. `setSbe` with the
            // whole object back restores it exactly (every field is required).
            dispatch({ type: "setSbe", patch: null });
            undoToast("boundary element removed", () =>
              dispatch({ type: "setSbe", patch: sbe }),
            );
          }}
        >
          {sbe === undefined ? "add" : "remove"}
        </Button>
      }
    >
      {sbe === undefined ? (
        <p className="text-xs2 text-muted-foreground">
          none provided — if 18.10.6.2(a) requires one, the detailing check reports ng.
        </p>
      ) : (
        <>
          <FieldGroup>
            <FieldRow label="width b" hint="wall-thickness direction">
              <NumberField
                value={sbe.width}
                onValueChange={(value) => {
                  if (value === undefined || value <= 0) return false;
                  dispatch({ type: "setSbe", patch: { width: value } });
                  return true;
                }}
                unit="in"
                min={1}
              />
            </FieldRow>
            <FieldRow label="length ℓbe" hint="from the compression fiber">
              <NumberField
                value={sbe.length}
                onValueChange={(value) => {
                  if (value === undefined || value <= 0) return false;
                  dispatch({ type: "setSbe", patch: { length: value } });
                  return true;
                }}
                unit="in"
                min={1}
              />
            </FieldRow>
            <FieldRow label="longitudinal bar">
              <SelectField
                value={sbe.longBar}
                options={BAR_OPTIONS}
                onValueChange={(longBar) => dispatch({ type: "setSbe", patch: { longBar } })}
              />
            </FieldRow>
            <FieldRow label="bars per element" hint="all faces">
              <NumberField
                value={sbe.longCount}
                onValueChange={(value) => {
                  if (value === undefined || value < 0) return false;
                  dispatch({ type: "setSbe", patch: { longCount: value } });
                  return true;
                }}
                invalidMessage="must be zero or greater"
                min={0}
                step={1}
              />
            </FieldRow>
            <FieldRow label="bar spacing hx" hint="18.10.6.4(f)">
              <NumberField
                value={sbe.hx}
                onValueChange={(value) => {
                  if (value === undefined || value <= 0) return false;
                  dispatch({ type: "setSbe", patch: { hx: value } });
                  return true;
                }}
                unit="in"
                min={1}
              />
            </FieldRow>
            <FieldRow label="hoop / tie bar">
              <SelectField
                value={sbe.tieBar}
                options={BAR_OPTIONS}
                onValueChange={(tieBar) => dispatch({ type: "setSbe", patch: { tieBar } })}
              />
            </FieldRow>
            <FieldRow label="tie spacing s" hint="18.10.6.4(e)">
              <NumberField
                value={sbe.tieSpacing}
                onValueChange={(value) => {
                  if (value === undefined || value <= 0) return false;
                  dispatch({ type: "setSbe", patch: { tieSpacing: value } });
                  return true;
                }}
                unit="in"
                min={0.5}
                step={0.5}
              />
            </FieldRow>
            <FieldRow label="tie legs across b" hint="⊥ bc1, Table 18.10.6.4(g)">
              <NumberField
                value={sbe.tieLegsAcrossWidth}
                onValueChange={(value) => {
                  if (value === undefined || value < 0) return false;
                  dispatch({ type: "setSbe", patch: { tieLegsAcrossWidth: value } });
                  return true;
                }}
                invalidMessage="must be zero or greater"
                min={0}
                step={1}
              />
            </FieldRow>
          </FieldGroup>

          <div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
            <DerivedRow label="Ag,be = b·ℓbe" value={`${fmt(sbe.width * sbe.length)} in²`} />
            <DerivedRow
              label="Ach (core, to hoop outside)"
              value={`${fmt(Math.max(0, sbe.width - 2 * cover) * Math.max(0, sbe.length - 2 * cover))} in²`}
            />
            <DerivedRow
              label="Ash across bc1"
              value={`${fmt(sbe.tieLegsAcrossWidth * BARS[sbe.tieBar].Ab, { dp: 2 })} in²`}
            />
          </div>
        </>
      )}
    </SectionCard>
  );
}

function DemandCard({
  demand,
  index,
  removable,
  dispatch,
}: {
  demand: Demands;
  index: number;
  removable: boolean;
  dispatch: (action: WallAction) => void;
}) {
  const patch =
    (key: "Pu" | "Mu" | "Vu" | "MuOut" | "VuOut", optional = false) =>
    (value: number | undefined) => {
      if (value === undefined && !optional) return;
      const next: Partial<Omit<Demands, "id">> =
        key === "Pu"
          ? { Pu: value ?? 0 }
          : key === "Mu"
            ? { Mu: value ?? 0 }
            : key === "Vu"
              ? { Vu: value ?? 0 }
              : key === "MuOut"
                ? { MuOut: value }
                : { VuOut: value };
      dispatch({ type: "setDemand", id: demand.id, patch: next });
    };

  // Pu, Mu and Vu repeat in every case, so the case names the group: without
  // it "Pu" is five identical fields to anyone reading the page linearly.
  const caseName =
    demand.label === undefined || demand.label.trim() === ""
      ? `load case ${index + 1}`
      : demand.label;

  return (
    <div
      role="group"
      aria-label={caseName}
      // Concentric with the card that holds it: 14 px outer, 12 px of padding,
      // so the inner box wants ~6 px, not the 10 px it had.
      className="flex flex-col gap-2 rounded-sm border border-border p-2.5"
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="load case name"
          name={`${demand.id}-name`}
          autoComplete="off"
          spellCheck={false}
          value={demand.label ?? ""}
          placeholder="name this case"
          onChange={(event) =>
            dispatch({ type: "setDemand", id: demand.id, patch: { label: event.target.value } })
          }
          // Borderless at rest — it is a title, not a form field — but a title
          // you can type in, so it takes the same hover and the same focus ring
          // as every other input rather than the 1.03:1 tint it had.
          className="h-6 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 font-mono text-xs text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:bg-muted/60 focus-visible:border-ring focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {removable ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`remove load case ${demand.label ?? demand.id}`}
            onClick={() => {
              dispatch({ type: "removeDemand", id: demand.id });
              undoToast(`removed ${demand.label ?? demand.id}`, () =>
                dispatch({ type: "restoreDemand", index, demand }),
              );
            }}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <FieldGroup>
        <FieldRow label="Pu" hint="compression +" name={`${demand.id}-pu`}>
          <NumberField value={demand.Pu} onValueChange={patch("Pu")} unit="kip" />
        </FieldRow>
        <FieldRow label="Mu" hint="in-plane" name={`${demand.id}-mu`}>
          <NumberField value={demand.Mu} onValueChange={patch("Mu")} unit="kip-ft" />
        </FieldRow>
        <FieldRow label="Vu" hint="in-plane" name={`${demand.id}-vu`}>
          <NumberField value={demand.Vu} onValueChange={patch("Vu")} unit="kip" />
        </FieldRow>
        <FieldRow label="Mu,oop" hint="optional" name={`${demand.id}-mu-oop`}>
          <NumberField
            value={demand.MuOut}
            onValueChange={patch("MuOut", true)}
            optional
            unit="kip-ft"
          />
        </FieldRow>
        <FieldRow label="Vu,oop" hint="optional" name={`${demand.id}-vu-oop`}>
          <NumberField
            value={demand.VuOut}
            onValueChange={patch("VuOut", true)}
            optional
            unit="kip"
          />
        </FieldRow>
      </FieldGroup>
    </div>
  );
}

interface PanelProps {
  input: WallInput;
  dispatch: (action: WallAction) => void;
}

/** Which preset the current wall still *is*, by the same bytes the URL carries. */
function activePreset(input: WallInput): PresetId | null {
  const encoded = encodeWallInput(input);
  for (const { id, code } of PRESET_CODES) {
    if (code === encoded) return id;
  }
  return null;
}

/**
 * Where a design starts from, and how it is thrown away — the two controls that
 * act on the whole wall rather than on one column of it.
 *
 * It sits *above* the two-column grid, not inside the inputs column, which is
 * what makes the two columns' first cards share a top edge: as the inputs
 * column's own header it pushed the geometry card 43 px below the drawing plate
 * beside it, and two panels that begin at different heights read as two
 * unrelated pages.
 */
export function WallToolbar() {
  const input = useWallInput();
  const dispatch = useWallDispatch();
  const active = activePreset(input);

  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-mono text-xs tracking-tight text-muted-foreground">wall</h2>
      <div className="flex items-center gap-2">
        <ToggleGroup
          value={active === null ? [] : [active]}
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next === undefined) return;
            const id = next as PresetId;
            const preset = PRESETS[id];
            if (preset === undefined) return;
            const previous = input;
            dispatch({ type: "loadPreset", input: preset });
            // Only when there were edits to lose. Swapping between pristine
            // presets discards nothing, and the pressed toggle already said
            // what happened — a toast there would be pure noise.
            if (active === null) {
              undoToast(`loaded ${PRESET_PHRASE[id]}`, () =>
                dispatch({ type: "loadPreset", input: previous }),
              );
            }
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="starting point"
        >
          {/* `PRESET_LABELS` was built and never rendered, so the toggle
              shipped "ex 1 / ex 2 / blank" and nothing on the page said what
              either example was. The full label cannot fit three-across in
              this column, so it arrives as the accessible name and the
              tooltip while the abbreviation stays visible. */}
          {PRESET_ORDER.map((id) => (
            <ToggleGroupItem
              key={id}
              value={id}
              size="sm"
              variant="outline"
              title={PRESET_LABELS[id]}
              aria-label={PRESET_LABELS[id]}
              className="font-mono text-xs2"
            >
              {PRESET_SHORT[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const previous = input;
            dispatch({ type: "reset" });
            // Nothing was discarded if this already *was* example 1.
            if (active !== "example-1") {
              undoToast("wall reset to example 1", () =>
                dispatch({ type: "loadPreset", input: previous }),
              );
            }
          }}
        >
          <RotateCcw />
          reset
        </Button>
      </div>
    </div>
  );
}

export function InputsPanel() {
  const input = useWallInput();
  const dispatch = useWallDispatch();

  return (
    <div className="flex flex-col gap-3">
      <GeometryCard input={input} dispatch={dispatch} />
      <MaterialsCard input={input} dispatch={dispatch} />
      <SystemCard input={input} dispatch={dispatch} />
      <ReinforcementCard input={input} dispatch={dispatch} />
      {input.system === "special" ? (
        <BoundaryElementCard input={input} dispatch={dispatch} />
      ) : null}

      <SectionCard
        title="demands"
        action={
          <Button size="xs" variant="ghost" onClick={() => dispatch({ type: "addDemand" })}>
            <Plus />
            load case
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          {input.demands.map((demand, index) => (
            <DemandCard
              key={demand.id}
              demand={demand}
              index={index}
              removable={input.demands.length > 1}
              dispatch={dispatch}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
