import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CANRUSH_DESKTOP_TEST_PORT ?? 1421);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${npmCommand} run dev`,
    url: `http://127.0.0.1:${port}`,
    env: {
      CANRUSH_DESKTOP_PORT: String(port),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
