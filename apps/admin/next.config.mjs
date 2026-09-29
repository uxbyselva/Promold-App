/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@promold/shared', '@promold/app-kit'],

  webpack(config) {
    /*
     * The workspace packages are TypeScript source with `.js` import
     * specifiers — correct for Node's ESM resolver, which is what the test
     * runner uses. Webpack does not make that substitution on its own, so a
     * client component importing @promold/shared fails to resolve
     * `./domain/costing.js`. This tells it to try `.ts`/`.tsx` for a `.js`
     * specifier, which is the same rule TypeScript itself applies.
     */
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
