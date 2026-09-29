import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@jjd/shared'],
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  allowedDevOrigins: ['192.168.1.27', '*.trycloudflare.com', '*.loca.lt'],
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';
    return [
      { source: '/jjd-api/:path*', destination: `${api}/:path*` },
      { source: '/uploads/:path*', destination: `${api}/uploads/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
