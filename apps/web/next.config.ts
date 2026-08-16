import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @shear0/engine ships TypeScript source (no build step) — compile it with the app.
  transpilePackages: ["@shear0/engine"],
  // The PDF route renders through @react-pdf/renderer, which needs the full
  // client React (createContext) at require time. Bundled into a route handler
  // it would resolve the react-server build instead — external, node resolves
  // plain react and the renderer works.
  serverExternalPackages: ["@json-render/react-pdf", "@react-pdf/renderer"],
};

export default nextConfig;
