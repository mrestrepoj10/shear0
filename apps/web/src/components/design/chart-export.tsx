"use client";

/**
 * The copy/save row a chart header carries: after a calculation the thing an
 * engineer wants next is the picture *in their doc*, not another URL. Copy
 * goes to the clipboard (PNG for docs and chat, SVG for CAD/vector tools);
 * save falls back to a download for browsers whose clipboard refuses images.
 */

import { type RefObject } from "react";
import { copyPng, copySvg, downloadPng, downloadSvg } from "@/lib/export-svg";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

export function ChartExportButtons({
  containerRef,
  filename,
}: {
  /** the element hosting the chart — the library finds its `svg.ts-chart` */
  containerRef: RefObject<HTMLElement | null>;
  filename: string;
}) {
  const withChart = async (run: (target: Element) => Promise<void> | void, done: string) => {
    const target = containerRef.current;
    if (!target) return;
    try {
      await run(target);
      notify({ id: `export-${filename}`, title: done });
    } catch {
      // Clipboard images are still refused by some browsers — the download
      // path answers the same intent without a permissions fight.
      try {
        await downloadPng(target, filename);
        notify({ id: `export-${filename}`, title: "copy unavailable — saved a png instead" });
      } catch {
        notify({ id: `export-${filename}`, title: "export failed" });
      }
    }
  };

  return (
    <span className="flex items-center gap-1 print:hidden">
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-2xs text-muted-foreground"
        onClick={() => void withChart(copyPng, "png copied")}
      >
        copy png
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-2xs text-muted-foreground"
        onClick={() => void withChart(copySvg, "svg copied")}
      >
        copy svg
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-2xs text-muted-foreground"
        onClick={() => void withChart((el) => downloadSvg(el, filename), "svg saved")}
      >
        save
      </Button>
    </span>
  );
}
