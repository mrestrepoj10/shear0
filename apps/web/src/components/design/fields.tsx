"use client";

/**
 * Property-sheet field primitives for the inputs panel: a label column, a
 * control column, and nothing else. Numeric entry keeps a local draft string so
 * a half-typed number ("1.", "") never round-trips through the reducer, while
 * every complete number dispatches immediately — the calculation is live.
 */

import { useId, useState, type ReactNode } from "react";
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

export function FieldRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
      <Label htmlFor={htmlFor} className="block min-w-0 text-xs leading-tight font-normal">
        <span className="block truncate">{label}</span>
        {hint === undefined ? null : (
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        )}
      </Label>
      {children}
    </div>
  );
}

/** A read-only line of engine-derived arithmetic, shown where an engineer expects it. */
export function DerivedRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

export interface NumberFieldProps {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  unit?: string;
  /** Allow an empty field, dispatching `undefined` (optional demands). */
  optional?: boolean;
  min?: number;
  step?: number;
  id?: string;
  "aria-label"?: string;
}

export function NumberField({
  value,
  onValueChange,
  unit,
  optional = false,
  min,
  step,
  id,
  "aria-label": ariaLabel,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));

  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        type="number"
        min={min}
        step={step}
        value={shown}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") {
            if (optional) onValueChange(undefined);
            return;
          }
          const parsed = Number(text);
          if (Number.isFinite(parsed)) onValueChange(parsed);
        }}
        onBlur={() => setDraft(null)}
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
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-muted-foreground">
          {unit}
        </span>
      )}
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
  id,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SelectOption<T>[];
  id?: string;
  "aria-label"?: string;
}) {
  const fallbackId = useId();
  return (
    <Select
      value={value}
      onValueChange={(next: unknown) => {
        if (typeof next === "string") onValueChange(next as T);
      }}
    >
      <SelectTrigger id={id ?? fallbackId} aria-label={ariaLabel} className="w-full font-mono">
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
