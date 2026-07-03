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
      { protocol: 'https', hostname: '*.vinted.net' },
      { protocol: 'https', hostname: '*.vinted.de' },
      { protocol: 'https', hostname: 'img.willhaben.at' },
      { protocol: 'https', hostname: '*.willhaben.at' },
      { protocol: 'https', hostname: 'm1.secondhandapp.at' },
      { protocol: 'https', hostname: '*.shpock.com' },
      { protocol: 'https', hostname: 'd46-a.sdn.cz' },
      { protocol: 'https', hostname: '*.sdn.cz' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

module.exports = nextConfig;
