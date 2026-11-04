import { defineConfig, devices } from "@playwright/test"
import { FUNCTIONAL_PROJECTS, VIEWPORTS } from "./e2e/support/viewports"

const PORT = Number(process.env.E2E_PORT ?? 3147)

/**
 * One project per viewport in the responsive matrix (e2e/support/viewports.ts): desktop from a 13-inch MacBook up,
 * and iPad Air and larger in portrait and landscape. Every project runs e2e/responsive.spec.ts over the screen
 * registry (e2e/support/screens.ts) and e2e/motion-matrix.spec.ts (landing screens in both styles and all modes). The two iPad Air 11 projects also run the functional specs. Tests run against a
 * production build in local mode (mock adapter, persona quick-switch on); Chromium emulates the viewport, and
 * touch input on the tablet sizes, and swiftshader gives it WebGL.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The globe renders in software WebGL; too many parallel pages starve it and taps time out. Override with --workers.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: VIEWPORTS.map((v) => ({
    name: v.name,
    testMatch: FUNCTIONAL_PROJECTS.includes(v.name) ? /.*\.spec\.ts$/ : /(responsive|motion-matrix|appearance-matrix)\.spec\.ts$/,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: v.width, height: v.height },
      hasTouch: v.touch,
      // Real iPads report a coarse pointer and no hover; this switches on the app's pointer-coarse sizing.
      isMobile: v.touch,
      deviceScaleFactor: v.touch ? 2 : 1,
    },
  })),
  webServer: {
    command: `pnpm build && pnpm exec next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/msl`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_APP_ENV: "local", NEXT_PUBLIC_DATA_ADAPTER: "mock" },
  },
})
