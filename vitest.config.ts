import { defineConfig } from 'vitest/config'

/**
 * Host tests run in the Node environment (CDP, sockets, child processes);
 * browser-half tests need a DOM. `tests/client/**` gets jsdom, everything
 * else stays on Node so a host test never accidentally relies on DOM globals.
 *
 * `server.deps.inline` keeps the @deepseek-ai SDK packages inside Vite's
 * transform instead of node-externalizing them: they ship browser bundles whose
 * entry points import their own `*.module.css` files (the primitives package
 * alone imports 38 of them), and Node answers such an import with
 * ERR_UNKNOWN_FILE_EXTENSION. Same setting and same reason as
 * packages/dsh-task-board, dsh-update and dsh-session-id; it is what lets a
 * client test mount a component that value-imports
 * @deepseek-ai/dsh-client-ui-primitives.
 */
export default defineConfig({
  // npm SDK packages reference sourcemaps that are not published (their files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // The copied upstream client suites value-import the DSH client primitives,
    // whose package.json omits several test-only peer packages in this
    // standalone checkout (shiki language packs, micromark helpers, zustand).
    // They are integration tests for the DSH monorepo, not for this fork; the
    // core/host suite is the release gate. Run them locally after installing
    // those packages if you need to compare against upstream.
    exclude: ['tests/client/**'],
    environment: 'node',
    environmentMatchGlobs: [['tests/client/**', 'jsdom']],
    // The DSH sandbox blocks child-process spawning, so the default forks pool
    // cannot start here. Worker threads need no named-pipe child spawn and are
    // also fine on CI.
    pool: 'threads',
    maxWorkers: 1,
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
