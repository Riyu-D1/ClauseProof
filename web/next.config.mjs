import { fileURLToPath } from "node:url";

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  // the dev-tools badge is dev chrome — hide it so demos/screenshots stay clean
  devIndicators: false,
};

export default nextConfig;
