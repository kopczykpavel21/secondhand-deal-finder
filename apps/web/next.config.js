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
    // TS packages use ESM-style .js-extension relative imports; map them back
    // to their .ts sources for webpack resolution.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
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
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

module.exports = nextConfig;
