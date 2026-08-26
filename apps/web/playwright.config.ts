import { defineConfig, devices } from "@playwright/test";

// Golden-path smoke test (Phase F6): register -> connect a demo platform ->
// feed loads -> compose + publish -> history shows it. Runs against the
// real demo connector stack (zero third-party credentials needed), driving
// both the API and web dev servers directly rather than a mocked backend,
// so it actually exercises the same code path a user hits.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // the whole point is one real end-to-end walk; no need for parallel workers
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional local-only override for environments with a pre-cached
        // browser at a nonstandard path (see this repo's own dev sandbox
        // notes); unset in CI and for a normal `npx playwright install`.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      name: "api",
      command: "npm run dev",
      cwd: "../api",
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      name: "web",
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
