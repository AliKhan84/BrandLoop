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
 *
 * `output: 'standalone'` exists for the Docker image. A normal production build
 * expects the entire `node_modules` tree to be present at run time; standalone
 * traces the imports and emits a server with only the modules it actually uses,
 * which is what makes a ~150 MB image possible instead of a ~1 GB one. It has no
 * effect on `next dev` or on `next start` run from the repo.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  output: 'standalone',
};

export default nextConfig;
