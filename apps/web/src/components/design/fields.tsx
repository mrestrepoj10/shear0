"use client";

/**
 * Property-sheet field primitives for the inputs panel: a label column, a
 * control column, and nothing else. Numeric entry keeps a local draft string so
 * a half-typed number ("1.", "") never round-trips through the reducer, while
 * every complete number dispatches immediately — the calculation is live.
 */

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

/**
 * What a row tells its control: the id the row's `<Label>` points at, the id of
 * the row's hint so the control can be described by it, and a form-control name
 * derived from the visible label. The control reads this instead of repeating
 * the label as an `aria-label` — the visible text *is* the accessible name.
 */
interface FieldContextValue {
  id: string;
  hintId?: string;
  name?: string;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** A control's identity, self-generated when it is used outside a `FieldRow`. */
function useField(): FieldContextValue {
  const fallbackId = useId();
  return useContext(FieldContext) ?? { id: fallbackId };
}

/** `wall length ℓw` → `wall-length-lw`: a stable name for a nameless form. */
function fieldName(label: ReactNode): string | undefined {
  if (typeof label !== "string") return undefined;
  const slug = label
    .toLowerCase()
    .replaceAll("ℓ", "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? undefined : slug;
}

export function FieldRow({
  label,
  hint,
  name,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Overrides the name derived from `label` — load cases repeat their labels. */
  name?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const field = useMemo<FieldContextValue>(
    () => ({
      id,
      hintId: hint === undefined ? undefined : hintId,
      name: name ?? fieldName(label),
    }),
    [id, hintId, hint, name, label],
  );

  return (
    <FieldContext value={field}>
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
        <div className="min-w-0">
          {/* The hint sits outside the label: it describes the field, it does
              not name it, and a name of "wall type Table 11.3.1.1" helps nobody. */}
          <Label htmlFor={id} className="block min-w-0 text-xs leading-tight font-normal">
            {/* "height above crit. section hwcs" clips at 1280 px; the tooltip
                is the only way back to the whole label. */}
            <span className="block truncate" title={typeof label === "string" ? label : undefined}>
              {label}
            </span>
          </Label>
          {hint === undefined ? null : (
            <span id={hintId} className="block truncate text-xs2 text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
        {children}
      </div>
    </FieldContext>
  );
}

/** A read-only line of engine-derived arithmetic, shown where an engineer expects it. */
export function DerivedRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs2 text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

export interface NumberFieldProps {
  value: number | undefined;
  /**
   * Return `false` to reject a complete number the model will not take (the
   * `value > 0` guards in the panel). The field keeps the old value, as it
   * always has, but now says so instead of swallowing the entry.
   */
  onValueChange: (value: number | undefined) => void | boolean;
  unit?: string;
  /** Allow an empty field, dispatching `undefined` (optional demands). */
  optional?: boolean;
  min?: number;
  step?: number;
  /** Why a rejected value was rejected. */
  invalidMessage?: string;
}

export function NumberField({
  value,
  onValueChange,
  unit,
  optional = false,
  min,
  step,
  invalidMessage = "must be greater than zero",
}: NumberFieldProps) {
  const { id, hintId, name } = useField();
  const [draft, setDraft] = useState<string | null>(null);
  // `rejected` is what the last commit did; `invalid` is what the field shows.
  // They are separate so the message waits for blur — nobody wants an error
  // while they are still typing "12" and have got as far as "1".
  const [rejected, setRejected] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const messageId = `${id}-error`;
  const shown = draft ?? (value === undefined ? "" : String(value));
  const describedBy =
    [hintId, invalid ? messageId : undefined].filter((part) => part !== undefined).join(" ") ||
    undefined;

  const commit = (accepted: void | boolean) => {
    if (accepted === false) {
      setRejected(true);
      return;
    }
    setRejected(false);
    setInvalid(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          id={id}
          name={name}
          autoComplete="off"
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          inputMode="decimal"
          type="number"
          min={min}
          step={step}
          value={shown}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            if (text.trim() === "") {
              if (optional) commit(onValueChange(undefined));
              return;
            }
            const parsed = Number(text);
            if (Number.isFinite(parsed)) commit(onValueChange(parsed));
          }}
          onBlur={() => {
            setDraft(null);
            setInvalid(rejected);
          }}
          // A wheel tick over a focused number input silently increments it —
          // scrolling the 24-field panel would edit the design. Drop focus so the
          // page scrolls instead; the value only ever changes by typing.
          onWheel={(event) => event.currentTarget.blur()}
          className={cn(
            "font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            unit === undefined ? undefined : "pr-9",
          )}
        />
        {unit === undefined ? null : (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs2 text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {invalid ? (
        <p id={messageId} className="text-xs2 leading-tight text-destructive">
          {invalidMessage}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function SelectField<T extends string>({
  value,
  onValueChange,
  options,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
}) {
  const { id, hintId } = useField();
  return (
    <Select
      value={value}
      onValueChange={(next: unknown) => {
        if (typeof next === "string") onValueChange(next as T);
      }}
    >
      <SelectTrigger id={id} aria-describedby={hintId} className="w-full font-mono">
        <SelectValue>
          {(current: unknown) =>
            options.find((option) => option.value === current)?.label ?? String(current ?? "")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="font-mono">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
