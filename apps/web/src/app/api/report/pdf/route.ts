/**
 * GET /api/report/pdf?w=<payload> — the calc sheet as a real PDF.
 *
 * Same save file as every other route, rendered through the json-render
 * react-pdf adapter: decode `?w=`, run the engine, build the PDF spec, stream
 * the bytes. Stateless like the rest of the app — the URL *is* the design.
 */

import { renderToBuffer } from "@json-render/react-pdf";
import { checkOrdinaryWall, checkSpecialWall, type WallInput } from "@kern/engine";
import type { NextRequest } from "next/server";
import { EXAMPLE_1 } from "@/lib/presets";
import { registry } from "@/lib/report/pdf-registry";
import { buildPdfSpec } from "@/lib/report/pdf-spec";
import { WALL_PARAM, decodeWallInput, encodeWallInput } from "@/lib/wall-codec";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const encodedParam = request.nextUrl.searchParams.get(WALL_PARAM);
  const input: WallInput =
    (encodedParam !== null && encodedParam.length > 0 ? decodeWallInput(encodedParam) : null) ??
    EXAMPLE_1;
  const encoded = encodeWallInput(input);

  let buffer: Uint8Array;
  try {
    const report = input.system === "special" ? checkSpecialWall(input) : checkOrdinaryWall(input);
    const spec = buildPdfSpec(input, report, {
      link: `${request.nextUrl.origin}/design?w=${encoded}`,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    });
    buffer = await renderToBuffer(spec, { registry });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `could not build the report: ${message}` }, { status: 422 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="kern-calc-sheet.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
