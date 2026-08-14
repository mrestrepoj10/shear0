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
  /** the element whose first `<svg>` is the exported picture */
  containerRef: RefObject<HTMLElement | null>;
  filename: string;
}) {
  const withSvg = async (run: (svg: SVGSVGElement) => Promise<void> | void, done: string) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      await run(svg);
      notify({ id: `export-${filename}`, title: done });
    } catch {
      // Clipboard images are still refused by some browsers — the download
      // path answers the same intent without a permissions fight.
      try {
        await downloadPng(svg, filename);
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
        onClick={() => void withSvg(copyPng, "png copied")}
      >
        copy png
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-2xs text-muted-foreground"
        onClick={() => void withSvg(copySvg, "svg copied")}
      >
        copy svg
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="font-mono text-2xs text-muted-foreground"
        onClick={() => void withSvg((svg) => downloadSvg(svg, filename), "svg saved")}
      >
        save
      </Button>
    </span>
  );
}
