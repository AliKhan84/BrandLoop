/**
 * Every route module must load.
 *
 * WHY THIS EXISTS
 *   A relative import that resolves one directory too high throws
 *   ERR_MODULE_NOT_FOUND at import time. Nothing catches that earlier than the
 *   process that imports it — and the API imports every router at boot, so the
 *   symptom is a server that will not start.
 *
 *   That happened: a new service under `src/services/auth/` imported
 *   `../utils/ApiError.js`, which resolves to `src/services/utils/`. All 230
 *   tests passed, because not one of them loaded a router, and the failure was
 *   found by a hand-typed `node -e "import(...)"`. This is that check, kept.
 *
 * It is deliberately shallow. Loading a module does not prove it works; it
 * proves it exists, which is the class of mistake a type checker cannot see in
 * plain JavaScript and a test suite that never imports the entry points misses.
 *
 * DOES NOT OWN: behaviour. The suites beside this file test that.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

const ROUTES_DIR = new URL('../src/routes/', import.meta.url);
const SERVICES_DIR = new URL('../src/services/', import.meta.url);

/** Every `.js` file directly inside a directory. */
function moduleFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

test('every route module imports', async (t) => {
  const files = moduleFiles(ROUTES_DIR);
  assert.ok(files.length > 0, 'no route modules found — has src/routes moved?');

  for (const file of files) {
    await t.test(file, async () => {
      await import(new URL(file, ROUTES_DIR).href);
    });
  }
});

test('every service module imports', async (t) => {
  const files = moduleFiles(SERVICES_DIR);

  for (const file of files) {
    await t.test(file, async () => {
      await import(new URL(file, SERVICES_DIR).href);
    });
  }
});
