/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript — let Next transpile them.
  transpilePackages: ["@skyhaven/game-client", "@skyhaven/config"],
};

export default nextConfig;
