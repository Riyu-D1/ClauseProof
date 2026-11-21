import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // the dev-tools badge is dev chrome — hide it so demos/screenshots stay clean
  devIndicators: false,
};

export default nextConfig;
