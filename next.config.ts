import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  experimental: {
    serverActions: {
      // 납품 파일 업로드는 서버 액션 본문 크기 제한을 따른다.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
