/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript — let Next transpile them.
  transpilePackages: ["@volari/game-client", "@volari/config", "@volari/world"],
  webpack: (config) => {
    // Shared packages use explicit `.js` import extensions (required by the
    // NodeNext server builds). Teach webpack to resolve those to `.ts` sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
