import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? 3147)

/**
 * Smoke tests run at iPad viewports against a production build in local mode (mock adapter,
 * persona quick-switch on). Chromium emulates the iPad viewport and touch input; swiftshader gives it WebGL.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "ipad-landscape",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: "ipad-portrait",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/msl`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_APP_ENV: "local", NEXT_PUBLIC_DATA_ADAPTER: "mock" },
  },
})
