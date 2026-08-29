/** @type {import('next').NextConfig} */
const nextConfig = {
  // @geo/core ships TypeScript source rather than a build step, so Next compiles it as
  // part of the app. This keeps `pnpm run dev` to a single process with no watch-build
  // to keep in sync.
  transpilePackages: ['@geo/core'],

  webpack: (config) => {
    // @geo/core uses NodeNext-style `./physics.js` specifiers that resolve to .ts files
    // on disk. Webpack does not apply that mapping by default, so teach it here.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
