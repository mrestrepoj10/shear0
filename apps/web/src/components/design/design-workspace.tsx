"use client";

/**
 * The /design workspace: inputs left, results right, verdict pinned on top.
 * Everything below the provider is a pure function of `WallInput`.
 */

import type { WallInput } from "@kern/engine";
import { useEffect, useRef } from "react";
import { notify } from "@/components/ui/sonner";
import { InputsPanel } from "@/components/design/inputs-panel";
import { ResultsPanels } from "@/components/design/results-panels";
import { ResultsSummary, VerdictStrip } from "@/components/design/results-summary";
import { WallCanvas } from "@/components/design/wall-canvas";
import { useWallUrlSync } from "@/lib/url-state";
import {
  WallProvider,
  useDeferredWallView,
  useWallDispatch,
  useWallInput,
  useWallResult,
} from "@/lib/wall-state";

function Workspace({ linkFailed }: { linkFailed: boolean }) {
  const input = useWallInput();
  const dispatch = useWallDispatch();
  const { report, error } = useWallResult();
  // The drawings and the charts render from this one; everything else below
  // renders from `input`/`report` directly. See `useDeferredWallView`.
  const deferred = useDeferredWallView();
  useWallUrlSync(input, dispatch, { skipFirstWrite: linkFailed });

  // Said once, on mount, and only for a `?w=` that would not decode at all —
  // the codec's per-field fallbacks (a bad bar size, a missing v1 field) stay
  // silent by design. The stable id makes a re-mount replace, not stack.
  const announced = useRef(false);
  useEffect(() => {
    if (!linkFailed || announced.current) return;
    announced.current = true;
    notify({
      id: "link-failed",
      title: "that link couldn't be read",
      description:
        "the ?w= payload was invalid or from an incompatible version — loaded example 1 instead",
      duration: 8000,
    });
  }, [linkFailed]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      {/* The page's one h1. The workspace is all chrome — every visible title
          belongs to a panel — so the document needs a name of its own before
          the h2s underneath it mean anything. */}
      <h1 className="sr-only">shear wall design</h1>

      {report === null ? (
        <div className="sticky top-12 z-30 -mx-4 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur">
          {/* `--destructive`, not `--status-ng`: the wall did not fail a check,
              the app failed to check it. Reserving the status hue for check
              outcomes keeps "ng" meaning one thing. */}
          <span role="status" aria-live="polite" className="text-sm text-destructive">
            cannot evaluate this wall
          </span>
        </div>
      ) : (
        <VerdictStrip report={report} />
      )}

      <div className="grid grid-cols-1 gap-6 pt-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <InputsPanel />
        </aside>

        <section className="flex min-w-0 flex-col gap-3">
          {report === null || deferred === null ? (
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm text-destructive">the engine could not run on these inputs</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">{error}</p>
            </div>
          ) : (
            <>
              <WallCanvas input={deferred.input} report={deferred.report} />
              <ResultsSummary report={report} />
              <ResultsPanels input={input} report={report} deferred={deferred} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * `initial` is the wall the server already decoded from `?w=` — passing it in
 * means a shared link renders its own design in the first HTML instead of
 * flashing the default example. The client hook still reads the URL, and finds
 * nothing to do.
 *
 * `linkFailed` is the other half: a `?w=` was asked for and could not be read,
 * so this is *not* the shared design and the workspace has to say so.
 */
export function DesignWorkspace({
  initial,
  linkFailed = false,
}: {
  initial?: WallInput;
  linkFailed?: boolean;
}) {
  return (
    <WallProvider {...(initial === undefined ? {} : { initial })}>
      <Workspace linkFailed={linkFailed} />
    </WallProvider>
  );
}
