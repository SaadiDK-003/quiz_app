import type { NextConfig } from "next";
import path from "node:path";
const backend = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  devIndicators: false,
  transpilePackages: ["@little-quest/api-client"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/sanctum/:path*", destination: `${backend}/sanctum/:path*` },
      { source: "/storage/:path*", destination: `${backend}/storage/:path*` },
    ];
  },
};
export default config;
