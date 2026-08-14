"use client";

/**
 * The single `WallInput` the whole /design page edits, in a reducer + context.
 *
 * Everything downstream (drawing, checks, charts, trace) is a pure function of
 * this object — the engine runs synchronously on every change, so there is no
 * derived state to keep in sync and nothing to debounce except the URL write
 * (see `url-state.ts`).
 *
 * The one branch that matters: `system` picks the check set. `checkOrdinaryWall`
 * (Ch. 11) and `checkSpecialWall` (Ch. 11 + §18.10) return the same report
 * shape, so nothing below `runChecks` knows which one ran.
 */

import {
  GRADE60,
  GRADE80,
  checkOrdinaryWall,
  checkSpecialWall,
  type Demands,
  type DistributedLayer,
  type EndZoneBars,
  type SbeProvided,
  type SeismicParams,
  type WallInput,
  type WallReport,
} from "@kern/engine";
import {
  createContext,
  useContext,
  useDeferredValue,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { EXAMPLE_1 } from "./presets";

export {
  BAR_SIZES,
  BLANK,
  EXAMPLE_1,
  EXAMPLE_2,
  K_VALUES,
  PRESETS,
  PRESET_LABELS,
  type PresetId,
} from "./presets";

/** Geometry fields that are plain lengths, in inches. */
export type GeometryField = "lw" | "h" | "hw" | "hwcs" | "lu" | "hu" | "cover";

/** Geometry lengths §18.10 adds, which are optional and may be cleared. */
const OPTIONAL_GEOMETRY: ReadonlySet<GeometryField> = new Set(["hwcs", "hu"]);

export type WallAction =
  | { type: "setGeometry"; field: GeometryField; value: number | undefined }
  | { type: "setK"; value: 0.8 | 1.0 | 2.0 }
  | { type: "setWallType"; value: WallInput["wallType"] }
  | { type: "setSystem"; value: WallInput["system"] }
  | { type: "setSeismic"; patch: Partial<SeismicParams> }
  | { type: "setSbe"; patch: Partial<SbeProvided> | null }
  | { type: "setPhiReading"; value: NonNullable<WallInput["phiSeismicReading"]> }
  | { type: "setConcrete"; patch: { fcPsi?: number; lambda?: number } }
  | { type: "setGrade"; fy: 60 | 80 }
  | {
      type: "setLayer";
      layer: "vertical" | "horizontal" | "both";
      patch: Partial<DistributedLayer>;
    }
  | { type: "setEndZone"; patch: Partial<EndZoneBars> | null }
  | { type: "setDemand"; id: string; patch: Partial<Omit<Demands, "id">> }
  | { type: "addDemand" }
  | { type: "removeDemand"; id: string }
  | { type: "reset" }
  | { type: "loadPreset"; input: WallInput };

function nextDemandId(demands: Demands[]): string {
  for (let i = demands.length + 1; ; i++) {
    const id = `load-${i}`;
    if (!demands.some((d) => d.id === id)) return id;
  }
}

/**
 * Merge a patch, dropping the keys it sets to `undefined` rather than storing
 * them — an optional engine field is *absent*, never `undefined`, so that a
 * cleared δ_e reads to the engine as "not supplied" and round-trips through the
 * URL unchanged.
 */
function mergeOptional<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base } as T;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key as keyof T];
    else next[key as keyof T] = value as T[keyof T];
  }
  return next;
}

/** A boundary element to start editing from — the web thickness, doubled up. */
function seedSbe(state: WallInput): SbeProvided {
  return {
    width: Math.max(state.geometry.h, 12),
    length: Math.max(2 * state.geometry.h, 24),
    longBar: state.vertical.bar,
    longCount: 8,
    hx: 10,
    tieBar: "4",
    tieSpacing: 4,
    tieLegsAcrossWidth: 3,
  };
}

export function wallReducer(state: WallInput, action: WallAction): WallInput {
  switch (action.type) {
    case "setGeometry": {
      if (action.value === undefined) {
        if (!OPTIONAL_GEOMETRY.has(action.field)) return state;
        const geometry = { ...state.geometry };
        delete geometry[action.field as "hwcs" | "hu"];
        return { ...state, geometry };
      }
      return { ...state, geometry: { ...state.geometry, [action.field]: action.value } };
    }
    case "setK":
      return { ...state, geometry: { ...state.geometry, k: action.value } };
    case "setWallType":
      return { ...state, wallType: action.value };
    case "setSystem": {
      if (action.value === state.system) return state;
      if (action.value === "ordinary") return { ...state, system: "ordinary" };
      // Switching to special needs at least an SDC for the seismic block to
      // exist; everything else stays optional and the engine warns for what it
      // cannot evaluate. Nothing is discarded switching back.
      return {
        ...state,
        system: "special",
        seismic: state.seismic ?? { sdc: "D" },
      };
    }
    case "setSeismic":
      return {
        ...state,
        seismic: mergeOptional<SeismicParams>(state.seismic ?? { sdc: "D" }, action.patch),
      };
    case "setSbe": {
      if (action.patch === null) {
        const rest = { ...state };
        delete rest.sbe;
        return rest;
      }
      return { ...state, sbe: { ...(state.sbe ?? seedSbe(state)), ...action.patch } };
    }
    case "setPhiReading":
      return { ...state, phiSeismicReading: action.value };
    case "setConcrete": {
      const fc = action.patch.fcPsi === undefined ? state.concrete.fc : action.patch.fcPsi / 1000;
      const lambda = action.patch.lambda ?? state.concrete.lambda;
      return { ...state, concrete: { fc, lambda } };
    }
    case "setGrade":
      return { ...state, grade: action.fy === 80 ? GRADE80 : GRADE60 };
    case "setLayer": {
      const next = { ...state };
      if (action.layer === "vertical" || action.layer === "both") {
        next.vertical = { ...state.vertical, ...action.patch };
      }
      if (action.layer === "horizontal" || action.layer === "both") {
        next.horizontal = { ...state.horizontal, ...action.patch };
      }
      return next;
    }
    case "setEndZone": {
      if (action.patch === null) {
        const rest = { ...state };
        delete rest.endZone;
        return rest;
      }
      const base: EndZoneBars = state.endZone ?? {
        bar: state.vertical.bar,
        count: 2,
        distanceToFirst: 3,
        spacing: 9,
      };
      return { ...state, endZone: { ...base, ...action.patch } };
    }
    case "setDemand":
      return {
        ...state,
        demands: state.demands.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      };
    case "addDemand": {
      const id = nextDemandId(state.demands);
      const last = state.demands[state.demands.length - 1];
      const created: Demands = {
        id,
        label: id,
        Pu: last?.Pu ?? 0,
        Mu: last?.Mu ?? 0,
        Vu: last?.Vu ?? 0,
      };
      return { ...state, demands: [...state.demands, created] };
    }
    case "removeDemand":
      return { ...state, demands: state.demands.filter((d) => d.id !== action.id) };
    case "reset":
      return EXAMPLE_1;
    case "loadPreset":
      return action.input;
  }
}

/** The engine run for the current input — or the thrown message, never a crash. */
export interface WallResult {
  report: WallReport | null;
  error: string | null;
}

export function runChecks(input: WallInput): WallResult {
  try {
    const report =
      input.system === "special" ? checkSpecialWall(input) : checkOrdinaryWall(input);
    return { report, error: null };
  } catch (err) {
    return { report: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * What the user is currently pointing at, anywhere in the workspace — hovering
 * or focusing a bar station in the plan section, later a row in the inputs
 * panel. Deliberately *not* part of `WallInput`: it is ephemeral UI state, it
 * must never reach the URL save file, and it must never re-run the engine.
 *
 * Both hooks fall back to a no-op outside a provider, so a drawing can be
 * rendered standalone (e.g. /learn with a one-off input) without a wall
 * context. Producers set it; consumers subscribe — neither knows the other.
 */
export type Selection =
  | { kind: "bar-station"; x: number }
  | { kind: "layer"; id: "vertical" | "horizontal" | "endZone" }
  | null;

const SelectionContext = createContext<Selection>(null);
const SetSelectionContext = createContext<(next: Selection) => void>(() => {});

export function useSelection(): Selection {
  return useContext(SelectionContext);
}

export function useSetSelection(): (next: Selection) => void {
  return useContext(SetSelectionContext);
}

/** A wall paired with the engine run for exactly that wall. */
interface WallView {
  input: WallInput;
  result: WallResult;
}

const WallInputContext = createContext<WallInput | null>(null);
const WallDispatchContext = createContext<Dispatch<WallAction> | null>(null);
const WallResultContext = createContext<WallResult | null>(null);
const DeferredWallContext = createContext<WallView | null>(null);

export function WallProvider({
  children,
  initial = EXAMPLE_1,
}: {
  children: ReactNode;
  initial?: WallInput;
}) {
  const [input, dispatch] = useReducer(wallReducer, initial);
  const [selection, setSelection] = useState<Selection>(null);
  // Synchronous on every keystroke — the full check set runs in ~1 ms.
  const result = useMemo(() => runChecks(input), [input]);

  // Deferred *rendering* only: the reducer and the engine still run on every
  // keystroke, but the expensive surfaces (drawings, charts) re-render at
  // transition priority off this copy, so a half-typed number no longer rebuilds
  // three drawings and two chart scenes before the next character lands. Input
  // and result travel as one object so a deferred drawing can never be paired
  // with a report from a different wall.
  const view = useMemo<WallView>(() => ({ input, result }), [input, result]);
  const deferred = useDeferredValue(view);

  return (
    <WallInputContext value={input}>
      <WallDispatchContext value={dispatch}>
        <WallResultContext value={result}>
          <DeferredWallContext value={deferred}>
            <SetSelectionContext value={setSelection}>
              <SelectionContext value={selection}>{children}</SelectionContext>
            </SetSelectionContext>
          </DeferredWallContext>
        </WallResultContext>
      </WallDispatchContext>
    </WallInputContext>
  );
}

export function useWallInput(): WallInput {
  const value = useContext(WallInputContext);
  if (value === null) throw new Error("useWallInput must be used inside <WallProvider>");
  return value;
}

export function useWallDispatch(): Dispatch<WallAction> {
  const value = useContext(WallDispatchContext);
  if (value === null) throw new Error("useWallDispatch must be used inside <WallProvider>");
  return value;
}

export function useWallResult(): WallResult {
  const value = useContext(WallResultContext);
  if (value === null) throw new Error("useWallResult must be used inside <WallProvider>");
  return value;
}

/**
 * The wall the heavy visual surfaces should draw: the same wall, allowed to lag
 * one render behind while the user is still typing. Only <WallCanvas>, the
 * interaction chart and the drift panel read this — the verdict, the summary and
 * the derived rows stay on `useWallInput`/`useWallResult` so the numbers an
 * engineer is watching never lag their keystroke.
 *
 * Falls back to the live wall whenever the deferred copy failed to evaluate, so
 * a momentarily invalid wall never blanks the drawings; returns null only when
 * the live wall itself cannot be evaluated (the caller renders the error panel).
 */
export function useDeferredWallView(): { input: WallInput; report: WallReport } | null {
  const input = useWallInput();
  const { report } = useWallResult();
  const deferred = useContext(DeferredWallContext);
  if (deferred === null) {
    throw new Error("useDeferredWallView must be used inside <WallProvider>");
  }
  if (deferred.result.report !== null) {
    return { input: deferred.input, report: deferred.result.report };
  }
  return report === null ? null : { input, report };
}
