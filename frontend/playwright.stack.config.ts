import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_STACK_PORT ?? 3211)

/**
 * Smoke tests against the real local stack (floci: Cognito -> AppSync -> BE Lambda -> RLS Postgres).
 * Start it first with `backend/infra/scripts/up.sh`, which writes the `.env.local` this server reads.
 */
export default defineConfig({
  testDir: "./e2e-stack",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: true,
    env: { NEXT_PUBLIC_APP_ENV: "local", NEXT_PUBLIC_DATA_ADAPTER: "appsync" },
  },
})
