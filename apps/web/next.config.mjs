/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript — let Next transpile them.
  transpilePackages: ["@volari/game-client", "@volari/config"],
};

export default nextConfig;
