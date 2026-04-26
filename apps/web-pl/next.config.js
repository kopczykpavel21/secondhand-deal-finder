/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@sdf/types', '@sdf/core', '@sdf/platform', '@sdf/scoring', '@sdf/source-adapters'],
  experimental: {
    serverComponentsExternalPackages: [
      'playwright',
      'playwright-core',
      'generic-pool',
      'pg',
      'redis',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from bundling playwright and its dependencies —
      // they rely on native binaries and must stay as node_modules at runtime.
      const playwrightModules = [
        'playwright',
        'playwright-core',
        /^playwright\/.*/,
        /^playwright-core\/.*/,
      ];
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (playwrightModules.some((m) =>
            typeof m === 'string' ? request === m : m.test(request)
          )) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.bazos.cz' },
      { protocol: 'https', hostname: '*.sbazar.cz' },
      { protocol: 'https', hostname: '*.vinted.net' },
      { protocol: 'https', hostname: '*.vinted.cz' },
      { protocol: 'https', hostname: '*.vinted.pl' },
      { protocol: 'https', hostname: '*.olxcdn.com' },
      { protocol: 'https', hostname: '*.olx.pl' },
      { protocol: 'https', hostname: '*.allegroimg.com' },
      { protocol: 'https', hostname: '*.allegrolokalnie.pl' },
      { protocol: 'https', hostname: '*.allegrostatic.com' },
      { protocol: 'https', hostname: '*.sprzedajemy.pl' },
      { protocol: 'https', hostname: 'sprzedajemy.pl' },
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

module.exports = nextConfig;
