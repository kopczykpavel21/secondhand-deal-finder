/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sdf/types', '@sdf/core', '@sdf/scoring', '@sdf/source-adapters'],
  experimental: {
    // Playwright must NOT be bundled by webpack — it relies on native binaries
    // and dynamic requires. Mark it external so Next.js uses node_modules at runtime.
    serverComponentsExternalPackages: ['playwright', 'playwright-core'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.bazos.cz' },
      { protocol: 'https', hostname: '*.sbazar.cz' },
      { protocol: 'https', hostname: '*.vinted.net' },
      { protocol: 'https', hostname: '*.vinted.cz' },
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

module.exports = nextConfig;
