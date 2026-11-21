import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", ".prisma/client", "sharp", "archiver"],
  async headers() {
    return [{ source: "/store/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
    },
  },
};

export default nextConfig;
