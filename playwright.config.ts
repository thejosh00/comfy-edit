import { defineConfig } from '@playwright/test'

const LIVE = !!process.env.COMFY_LIVE
const FAKE_PORT = 8199
const APP_PORT = 5174

export default defineConfig({
  testDir: 'tests/e2e',
  // One worker, deliberately. There is a single fake ComfyUI holding uploads, the
  // queue and history, and each spec resets it in beforeEach — parallel workers
  // would wipe each other's state mid-test. The whole suite runs in ~30s, so a
  // second worker buys nothing worth a shared-state race.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    // The fake stands in for ComfyUI offline. Skipped entirely for @live runs.
    ...(LIVE
      ? []
      : [
          {
            command: `node tests/fake-comfy/server.mjs --port ${FAKE_PORT}`,
            url: `http://127.0.0.1:${FAKE_PORT}/system_stats`,
            reuseExistingServer: false,
            stdout: 'pipe' as const,
            stderr: 'pipe' as const,
          },
        ]),
    {
      // --host 127.0.0.1 is required: Vite otherwise binds ::1 only, and the
      // readiness probe below (and Chromium's baseURL) would never connect.
      command: `npm run dev -- --port ${APP_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      env: {
        COMFY_URL: LIVE
          ? (process.env.COMFY_URL ?? 'http://127.0.0.1:8188')
          : `http://127.0.0.1:${FAKE_PORT}`,
        // Configuration, not test-only app surface: the same knob a user could set.
        // Keeps the FR-026 timeout case fast without a 5-minute wait.
        ...(LIVE ? {} : { VITE_RUN_TIMEOUT_MS: '8000' }),
      },
    },
  ],
})
