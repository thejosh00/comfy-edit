import { defineConfig } from '@playwright/test'

const LIVE = !!process.env.COMFY_LIVE
const FAKE_PORT = 8199
const APP_PORT = 5174

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
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
      },
    },
  ],
})
