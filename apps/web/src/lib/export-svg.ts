/**
 * Copy / download a rendered chart as SVG or PNG.
 *
 * Every chart and drawing in the app is inline SVG styled by CSS custom
 * properties and Tailwind classes — which do not survive outside the page. So
 * the exporter clones the node and *inlines the computed styles* onto every
 * element, producing a self-contained SVG that pastes into a doc, a slide or an
 * email exactly as it looked on screen. PNG goes through the same string via a
 * canvas at 2× so a pasted screenshot stays crisp.
 */

const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
  "visibility",
] as const;

const PNG_SCALE = 2;

/** The page background behind the chart, for opaque PNG export. */
function backgroundBehind(el: Element): string {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
  }
  return "#ffffff";
}

export function serializeSvg(svg: SVGSVGElement): { xml: string; width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  for (let i = 0; i < src.length; i++) {
    const from = src[i];
    const to = dst[i];
    if (from === undefined || to === undefined) continue;
    const computed = getComputedStyle(from);
    const style = STYLE_PROPS.map((p) => {
      const v = computed.getPropertyValue(p);
      return v === "" ? null : `${p}:${v}`;
    })
      .filter((s): s is string => s !== null)
      .join(";");
    to.setAttribute("style", style);
    // `currentColor` resolves against the *export* file once inlined.
    to.removeAttribute("class");
  }

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  return { xml: new XMLSerializer().serializeToString(clone), width, height };
}

export function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const { xml, width, height } = serializeSvg(svg);
  const background = backgroundBehind(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));

  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = width * PNG_SCALE;
      canvas.height = height * PNG_SCALE;
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        reject(new Error("canvas 2d context unavailable"));
        return;
      }
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob !== null ? resolve(blob) : reject(new Error("png encode failed"))),
        "image/png",
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg rasterize failed"));
    };
    image.src = url;
  });
}

export async function copySvg(svg: SVGSVGElement): Promise<void> {
  await navigator.clipboard.writeText(serializeSvg(svg).xml);
}

export async function copyPng(svg: SVGSVGElement): Promise<void> {
  // Safari requires the promise form: the ClipboardItem must exist inside the
  // user gesture, the blob may arrive after it.
  const item = new ClipboardItem({ "image/png": svgToPngBlob(svg) });
  await navigator.clipboard.write([item]);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  download(
    new Blob([serializeSvg(svg).xml], { type: "image/svg+xml;charset=utf-8" }),
    `${filename}.svg`,
  );
}

export async function downloadPng(svg: SVGSVGElement, filename: string): Promise<void> {
  download(await svgToPngBlob(svg), `${filename}.png`);
}
