import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@symphoneer/contracts", "@symphoneer/i18n", "@symphoneer/runtime"],
};

export default nextConfig;
