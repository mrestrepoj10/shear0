import type { Metadata } from "next";
import { DesignWorkspace } from "@/components/design/design-workspace";
import { WALL_PARAM, decodeWallInput } from "@/lib/wall-codec";

export const metadata: Metadata = {
  title: "design",
  description:
    "Design a rectangular concrete shear wall per ACI 318-19 — live checks, in the browser.",
};

/**
 * `?w=` is decoded here, on the server, so a shared design is in the first HTML
 * — checks, drawings and trace included — rather than appearing after hydration.
 * A missing or mangled parameter falls through to the provider's default.
 */
export default async function DesignPage({ searchParams }: PageProps<"/design">) {
  const params = await searchParams;
  const raw = params[WALL_PARAM];
  const encoded = Array.isArray(raw) ? raw[0] : raw;
  const initial =
    typeof encoded === "string" && encoded.length > 0 ? decodeWallInput(encoded) : null;

  return <DesignWorkspace {...(initial === null ? {} : { initial })} />;
}
