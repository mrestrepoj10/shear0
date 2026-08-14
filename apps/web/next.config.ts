import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @kern/engine ships TypeScript source (no build step) — compile it with the app.
  transpilePackages: ["@kern/engine"],
};

export default nextConfig;
