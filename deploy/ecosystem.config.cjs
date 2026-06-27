// PM2 process definitions for the Volari VPS deploy.
//
// Phase 0: only the web shell is served (no game yet). The api + realtime
// services are wired but commented out until Phase 2 adds gameplay and the
// VPS has PostgreSQL + Redis provisioned.
//
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save
//
// Assumes the repo is checked out at /var/www/volari (adjust ROOT if not).
const ROOT = "/var/www/volari";

module.exports = {
  apps: [
    {
      name: "volari-web",
      cwd: `${ROOT}/apps/web`,
      // Run the Next.js production server directly with node so PM2 doesn't
      // depend on pnpm/next being on the daemon's PATH.
      script: "node_modules/next/dist/bin/next",
      interpreter: "node",
      args: "start -p 3000",
      env: { NODE_ENV: "production", WEB_PORT: "3000" },
      autorestart: true,
      max_restarts: 10,
      time: true,
    },

    // ── Enable from Phase 2 (needs PostgreSQL + Redis on the box) ──
    // The shared @volari/* packages ship raw TypeScript, so run these with
    // tsx in production (or add a bundling step) — plain `node dist/index.js`
    // won't resolve the workspace TS entrypoints.
    //
    // {
    //   name: "volari-api",
    //   cwd: `${ROOT}/apps/api`,
    //   script: "node_modules/.bin/tsx",
    //   interpreter: "node",
    //   args: "src/index.ts",
    //   env: { NODE_ENV: "production", API_PORT: "4000" },
    // },
    // {
    //   name: "volari-realtime",
    //   cwd: `${ROOT}/apps/realtime`,
    //   script: "node_modules/.bin/tsx",
    //   interpreter: "node",
    //   args: "src/index.ts",
    //   env: { NODE_ENV: "production", REALTIME_PORT: "2567" },
    // },
  ],
};
