/**
 * Copy / download a rendered chart as SVG or PNG.
 *
 * This used to hand-serialize the chart: clone the `<svg>`, walk every node
 * inlining its computed styles, rasterize through a canvas. `@tanstack/charts`
 * now ships that whole pipeline as `@tanstack/charts/export`, and its
 * serializer knows things ours could not — it strips the focus/hover layer
 * from the output and reads the true chart size from the `viewBox` instead of
 * the responsive `width="100%"` box — so we delegate and keep only what the
 * library leaves to us: the clipboard, and the opaque page background.
 *
 * Two caveats found in its implementation (`dist/export.js`), which shape the
 * API here:
 *
 * - `target` is the chart *host* element (it querySelectors `svg.ts-chart`
 *   underneath), or a bare `<svg>` passed directly. It is NOT a generic
 *   exporter: handed an arbitrary container it only finds TanStack-rendered
 *   charts, which is why these functions take the plot container rather than
 *   `querySelector("svg")`-ing for the first svg — the container may also
 *   hold legend-swatch svgs that must not win.
 *
 * - Style inlining is *conditional*: a property is resolved to its computed
 *   value only when the authored attribute/inline style contains `var(` or
 *   `currentColor` (font-family is always inlined). That is exactly enough
 *   for our charts — `xy-chart.tsx` hands the renderer `var(--token)` paints
 *   which land in the DOM as presentation attributes and inline styles, so
 *   no unresolved `var(--…)` survives into the file — but it would silently
 *   drop styling applied purely through CSS classes. Don't point this module
 *   at hand-drawn svgs styled by Tailwind; those need the old
 *   computed-style-walk approach (see git history).
 */

import {
  downloadChartImage,
  downloadChartSvg,
  renderChartImage,
  serializeChartSvg,
} from "@tanstack/charts/export";

const PNG_SCALE = 2;

/**
 * The page background behind the chart, for opaque PNG export. The library
 * only fills a background when handed one, and it must be a literal colour —
 * a `var(--background)` token would paint nothing on the export canvas — so
 * we resolve the nearest painted ancestor's computed backgroundColor.
 */
function backgroundBehind(el: Element): string {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
  }
  return "#ffffff";
}

function pngBlob(target: Element): Promise<Blob> {
  return renderChartImage(target, {
    scale: PNG_SCALE,
    background: backgroundBehind(target),
    type: "image/png",
  });
}

export async function copySvg(target: Element): Promise<void> {
  await navigator.clipboard.writeText(serializeChartSvg(target));
}

export async function copyPng(target: Element): Promise<void> {
  // Safari requires the promise form: the ClipboardItem must exist inside the
  // user gesture, the blob may arrive after it.
  const item = new ClipboardItem({ "image/png": pngBlob(target) });
  await navigator.clipboard.write([item]);
}

export function downloadSvg(target: Element, filename: string): void {
  downloadChartSvg(target, `${filename}.svg`);
}

export async function downloadPng(target: Element, filename: string): Promise<void> {
  await downloadChartImage(target, `${filename}.png`, {
    scale: PNG_SCALE,
    background: backgroundBehind(target),
    type: "image/png",
  });
}
