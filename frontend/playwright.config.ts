import { defineConfig } from "@playwright/test";

const frontendBaseUrl = process.env.E2E_FRONTEND_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20 * 60_000,
  expect: {
    timeout: 15_000
  },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: frontendBaseUrl,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  outputDir: "test-results"
});
