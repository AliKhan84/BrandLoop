import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Dashboard build configuration.
 *
 * `turbopack.root` is set because this dashboard lives inside the API's
 * repository and both have a `package-lock.json`. Without it, Next walks up,
 * finds the outer lockfile, infers the wrong workspace root, and warns on every
 * build. Pinning the root to the dashboard directory keeps module resolution and
 * file watching scoped to the app that is actually being built.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
