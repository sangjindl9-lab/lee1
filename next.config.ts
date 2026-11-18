import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'yauzl'],
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  poweredByHeader: false,
};
export default config;
