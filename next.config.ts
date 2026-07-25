import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone — a self-contained server bundling only the traced
  // runtime deps, so the Docker image never installs node_modules. See
  // deploy/Dockerfile, which copies public/ and .next/static/ in alongside it
  // (the standalone server does not include those itself).
  output: "standalone",
};

export default nextConfig;
