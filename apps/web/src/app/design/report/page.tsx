import type { Metadata } from "next";
import { headers } from "next/headers";
import { checkOrdinaryWall, checkSpecialWall, type WallInput } from "@shear0/engine";
import { ReportView } from "@/components/report/report-view";
import { buildReportSpec } from "@/lib/report/build-spec";
import { WALL_PARAM, decodeWallInput, encodeWallInput } from "@/lib/wall-codec";
import { EXAMPLE_1 } from "@/lib/presets";

export const metadata: Metadata = {
  title: "calc sheet",
  // Static metadata, so it names both editions rather than the one this
  // particular `?w=` selects — the sheet itself says which is in force.
  description: "Printable shear wall calculation report per ACI 318-19 / 318M-19.",
};

/**
 * The calc sheet route: the same `?w=` save file as `/design`, rendered as a
 * document instead of a workspace. Decoding and the engine run happen here on
 * the server, and the whole report — a json-render spec — is in the first HTML,
 * so the link is shareable to someone who will only ever print it.
 */
export default async function ReportPage({ searchParams }: PageProps<"/design/report">) {
  const params = await searchParams;
  const raw = params[WALL_PARAM];
  const encodedParam = Array.isArray(raw) ? raw[0] : raw;
  const input: WallInput =
    (typeof encodedParam === "string" && encodedParam.length > 0
      ? decodeWallInput(encodedParam)
      : null) ?? EXAMPLE_1;
  // Canonical re-encode: a mangled or v1 payload still yields a working
  // pdf/back-link pair, pointing at the wall that was actually rendered.
  const encoded = encodeWallInput(input);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  let spec;
  try {
    const report = input.system === "special" ? checkSpecialWall(input) : checkOrdinaryWall(input);
    spec = buildReportSpec(input, report, {
      link: `${proto}://${host}/design?w=${encoded}`,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    });
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-10">
        <p className="text-sm text-destructive">
          the engine could not run on these inputs — open the design workspace and check them, then
          come back to the calc sheet
        </p>
      </div>
    );
  }

  return <ReportView spec={spec} encoded={encoded} />;
}
