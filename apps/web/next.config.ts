import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ajis/shared", "@ajis/db"],
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
};

export default nextConfig;
