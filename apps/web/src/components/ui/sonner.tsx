"use client";

/**
 * Toasts, headless.
 *
 * Sonner is here for its behaviour — positioning, stacking, swipe, the timer
 * that pauses on hover — not for its looks: every toast is `toast.custom()`
 * JSX built from the same tokens as `Card size="sm"`, so a toast is visibly the
 * same material as the panels behind it.
 *
 * Two rules the app's colour system imposes:
 *
 * - **Monochrome.** The app spends exactly one hue, `--status-ng`, and only on a
 *   failing check; passing is neutral and `--status-ok` is held in reserve. A
 *   green "copied" toast would be the loudest affirmative colour on the page.
 *   So: no `richColors`, no `toast.success`, no `toast.error` — the words carry
 *   the meaning.
 * - **A resolved theme, never `"system"`.** next-themes lets the user override
 *   the OS, and Sonner's own `"system"` does not know about that override, so
 *   the two would disagree. `undefined` (first paint, before the theme is
 *   known) coerces to light, which is what the SSR markup is.
 */

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster, toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Mounted once, in the root layout, inside the theme provider. */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      offset={16}
      mobileOffset={16}
      gap={8}
      visibleToasts={3}
      duration={4000}
      closeButton={false}
    />
  );
}

export interface NotifyAction {
  label: string;
  onClick: () => void;
}

export interface NotifyOptions {
  /** One line, lowercase like the rest of the chrome. */
  title: string;
  /** The sentence that explains what happened, or what to do instead. */
  description?: string;
  /** ms. 8000 for a failed decode, 6000 for an error or an undo, else 4000. */
  duration?: number;
  /**
   * A stable id makes a repeated toast *replace* itself rather than stack —
   * what you want for a failure the user can trigger nine times in a row.
   */
  id?: string;
  action?: NotifyAction;
}

/**
 * The one way this app raises a toast. Everything is monochrome and every call
 * site passes its own duration.
 */
export function notify({ title, description, duration, id, action }: NotifyOptions): void {
  toast.custom(
    (toastId) => (
      <div className="flex w-(--width) max-w-full items-start gap-3 rounded-xl bg-card px-3 py-2.5 text-card-foreground ring-1 ring-foreground/10">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-sm2 leading-snug">{title}</span>
          {description === undefined ? null : (
            <span className="font-mono text-xs2 leading-snug text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        {action === undefined ? null : (
          <Button
            size="xs"
            variant="outline"
            className="shrink-0 font-mono text-xs2"
            onClick={() => {
              action.onClick();
              toast.dismiss(toastId);
            }}
          >
            {action.label}
          </Button>
        )}
      </div>
    ),
    { ...(duration === undefined ? {} : { duration }), ...(id === undefined ? {} : { id }) },
  );
}
